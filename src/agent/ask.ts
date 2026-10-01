import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { existsSync, statSync } from "node:fs";
import { join } from "node:path";
import type { Profile } from "../profile/loadProfile.ts";
import type { Scanner } from "../snapshot/scan.ts";
import { openTranscript, type Transcript } from "../transcripts/writeTranscript.ts";
import { runPipeline, type PipelineOutcome } from "../validate/pipeline.ts";
import { ANSWER_SCHEMA, answerProblems, type VeteranAnswer } from "./answerSchema.ts";
import { boundaryHook, READ_TOOLS, STRUCTURED_OUTPUT_TOOL, type Denial } from "./boundary.ts";
import { consume, hardenedOptions, initProblems, isInit, LOGIN_HINT, looksLikeAuthFailure, type QueryFn } from "./sdk.ts";
import { buildSystemPrompt } from "./systemPrompt.ts";

export const AGENT_MODEL = "claude-opus-5-5";
export const MAX_TURNS = 40;
export const MAX_BUDGET_USD = 1.0;
export const TIMEOUT_MS = 300_000;
export const DISALLOWED_TOOLS = ["Bash", "Write", "Edit", "WebFetch", "WebSearch"];
export const SUPPORTED_LANGUAGES = ["pt-BR"];

export class AskError extends Error {
  override name = "AskError";
}

export interface AskDeps {
  query: QueryFn;
  env?: NodeJS.ProcessEnv;
  timeoutMs?: number;
  now?: () => Date;
  /** The gitleaks binary the secret check runs; tests stand a stub in. */
  scanner?: Scanner;
}

export interface AskResult {
  ok: boolean;
  /** Only an answer whose own attempt passed validation; `null` on every other path. */
  answer: VeteranAnswer | null;
  /** Why the run failed; absent when `ok`. */
  error?: string;
  /** Set when the failure looks like a missing Claude Code login. */
  authFailure?: boolean;
  /** Validation failed twice or reached no verdict: the caller shows the fallback. */
  fallback: boolean;
  /** Stage and rule ids per attempt, without matched text; set on fallback. */
  rejection?: string;
  transcriptPath: string;
  costUsd: number;
  durationMs: number;
}

export function snapshotDir(profile: Profile): string {
  return join(profile.dir, "snapshot");
}

/** Checks that must pass before any agent starts; throws `AskError` with the reason. */
export function assertAskable(profile: Profile): void {
  if (!SUPPORTED_LANGUAGES.includes(profile.language)) {
    throw new AskError(`profile language ${JSON.stringify(profile.language)} is not supported yet; supported: ${SUPPORTED_LANGUAGES.join(", ")}`);
  }
  const snapshot = snapshotDir(profile);
  if (!existsSync(snapshot) || !statSync(snapshot).isDirectory()) {
    throw new AskError(`no snapshot at ${snapshot}; run \`veteran snapshot\` first`);
  }
}

interface AgentRun {
  answer: VeteranAnswer | null;
  error?: string;
  authFailure: boolean;
  sessionId: string | null;
  subtype: string | null;
  numTurns: number | null;
  costUsd: number;
  durationMs: number;
}

/** One agent run over the snapshot: attempt 1, or a regeneration that resumes attempt 1's session. */
async function runAgent(profile: Profile, prompt: string, deps: AskDeps, transcript: Transcript, denials: Denial[], resume?: string): Promise<AgentRun> {
  const snapshot = snapshotDir(profile);
  const now = deps.now ?? (() => new Date());
  const startedAt = now().getTime();
  const controller = new AbortController();
  const timeoutMs = deps.timeoutMs ?? TIMEOUT_MS;

  let sessionId: string | null = null;
  let result: Extract<SDKMessage, { type: "result" }> | undefined;
  let answer: VeteranAnswer | null = null;
  let error: string | undefined;
  const retryErrors: string[] = [];

  const consumed = await consume(
    deps.query({
      prompt,
      options: {
        ...hardenedOptions(deps.env ?? process.env),
        model: AGENT_MODEL,
        cwd: snapshot,
        tools: [...READ_TOOLS],
        allowedTools: [...READ_TOOLS],
        disallowedTools: [...DISALLOWED_TOOLS],
        systemPrompt: buildSystemPrompt(profile),
        maxTurns: MAX_TURNS,
        maxBudgetUsd: MAX_BUDGET_USD,
        outputFormat: { type: "json_schema", schema: ANSWER_SCHEMA },
        abortController: controller,
        hooks: { PreToolUse: [{ hooks: [boundaryHook(snapshot, denials)] }] },
        ...(resume ? { resume } : {}),
      },
    }),
    controller,
    timeoutMs,
    (message) => {
      transcript.write(message);
      if (isInit(message)) {
        sessionId = message.session_id;
        const problems = initProblems(message, {
          tools: [...READ_TOOLS, STRUCTURED_OUTPUT_TOOL],
          cwd: snapshot,
          model: AGENT_MODEL,
          permissionMode: "dontAsk",
        });
        if (problems.length > 0) {
          error = `the agent session is not isolated: ${problems.join("; ")}; run aborted`;
          return "stop";
        }
      } else if (message.type === "system" && (message as { subtype?: string }).subtype === "api_retry") {
        retryErrors.push(String((message as { error?: unknown }).error ?? ""));
      } else if (message.type === "result") {
        result = message;
        // The result carries the answer; waiting for the stream to close only adds latency.
        return "stop";
      }
    },
  );

  const final = result as Extract<SDKMessage, { type: "result" }> | undefined;
  if (!error) {
    if (!final) {
      if (consumed.timedOut) error = `timed out after ${Math.round(timeoutMs / 1000)} s`;
      else if (consumed.thrown !== undefined) error = `the agent failed: ${consumed.thrown instanceof Error ? consumed.thrown.message : String(consumed.thrown)}`;
      else error = "the agent ended without a result";
    } else if (final.subtype !== "success") {
      error = `the agent stopped: ${final.subtype}${final.errors?.length ? ` (${final.errors.join("; ")})` : ""}`;
    } else if (final.is_error) {
      const status = (final as { api_error_status?: number | null }).api_error_status;
      error = `API error${status ? ` ${status}` : ""}: ${final.result}`;
    } else {
      const problems = answerProblems(final.structured_output);
      if (problems.length > 0) error = `the answer did not match the expected schema (${problems.join("; ")})`;
      else answer = final.structured_output as VeteranAnswer;
    }
  }

  const status = (final as { api_error_status?: number | null } | undefined)?.api_error_status;
  const authFailure = error !== undefined && looksLikeAuthFailure(status, error, retryErrors);
  if (authFailure) error = `${error}\n${LOGIN_HINT}`;
  return {
    answer,
    error,
    authFailure,
    sessionId: sessionId ?? final?.session_id ?? null,
    subtype: final?.subtype ?? (consumed.timedOut ? "aborted" : null),
    numTurns: final?.num_turns ?? null,
    costUsd: final?.total_cost_usd ?? 0,
    durationMs: final?.duration_ms ?? now().getTime() - startedAt,
  };
}

/**
 * Runs one question through the read-only agent over the profile's snapshot, validates the answer
 * (regenerating once with feedback) and records the transcript. Only a validated answer is returned.
 */
export async function ask(profile: Profile, question: string, deps: AskDeps): Promise<AskResult> {
  assertAskable(profile);
  const now = deps.now ?? (() => new Date());
  const transcript = openTranscript(profile.dir, now());
  const denials: Denial[] = [];

  const first = await runAgent(profile, question, deps, transcript, denials);
  let costUsd = first.costUsd;
  let durationMs = first.durationMs;
  let outcome: PipelineOutcome | undefined;
  if (first.answer) {
    outcome = await runPipeline(
      first.answer,
      { question, denyTerms: profile.denyTerms, query: deps.query, env: deps.env, scanner: deps.scanner, timeoutMs: deps.timeoutMs },
      async (prompt) => {
        const second = await runAgent(profile, prompt, deps, transcript, denials, first.sessionId ?? undefined);
        costUsd += second.costUsd;
        durationMs += second.durationMs;
        return { answer: second.answer, error: second.error };
      },
    );
    costUsd += outcome.validation.reduce((sum, entry) => sum + entry.costUsd, 0);
    durationMs += outcome.judgeDurationMs;
  }

  const answer = outcome?.answer ?? null;
  const fallback = outcome?.fallback ?? false;
  const error = first.error ?? (fallback ? `the answer was withheld (${outcome!.rejection})` : undefined);
  transcript.write({
    type: "summary",
    question,
    sessionId: first.sessionId,
    subtype: first.subtype,
    total_cost_usd: costUsd,
    duration_ms: durationMs,
    num_turns: first.numTurns,
    maxTurns: MAX_TURNS,
    maxBudgetUsd: MAX_BUDGET_USD,
    answer,
    attempts: outcome?.attempts ?? 1,
    fallback,
    validation: outcome?.validation ?? [],
    hookDenials: denials,
    error: error ?? null,
  });

  return {
    ok: answer !== null,
    answer,
    error,
    authFailure: first.authFailure,
    fallback,
    rejection: outcome?.rejection,
    transcriptPath: transcript.path,
    costUsd,
    durationMs,
  };
}
