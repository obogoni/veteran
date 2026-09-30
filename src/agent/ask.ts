import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { existsSync, statSync } from "node:fs";
import { join } from "node:path";
import type { Profile } from "../profile/loadProfile.ts";
import { openTranscript } from "../transcripts/writeTranscript.ts";
import { ANSWER_SCHEMA, answerProblems, type VeteranAnswer } from "./answerSchema.ts";
import { boundaryHook, READ_TOOLS, STRUCTURED_OUTPUT_TOOL, type Denial } from "./boundary.ts";
import { hardenedOptions, initProblems, isInit, LOGIN_HINT, looksLikeAuthFailure, type QueryFn } from "./sdk.ts";
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
}

export interface AskResult {
  ok: boolean;
  answer: VeteranAnswer | null;
  /** Why the run failed; absent when `ok`. */
  error?: string;
  /** Set when the failure looks like a missing Claude Code login. */
  authFailure?: boolean;
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

/** Runs one question through the read-only agent over the profile's snapshot and records the transcript. */
export async function ask(profile: Profile, question: string, deps: AskDeps): Promise<AskResult> {
  assertAskable(profile);
  const snapshot = snapshotDir(profile);
  const now = deps.now ?? (() => new Date());
  const startedAt = now().getTime();
  const transcript = openTranscript(profile.dir, now());
  const denials: Denial[] = [];
  const controller = new AbortController();
  const timeoutMs = deps.timeoutMs ?? TIMEOUT_MS;
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let sessionId: string | null = null;
  let result: Extract<SDKMessage, { type: "result" }> | undefined;
  let answer: VeteranAnswer | null = null;
  let error: string | undefined;
  const retryErrors: string[] = [];

  let timedOut = false;
  const deadline = new Promise<"deadline">((resolve) =>
    controller.signal.addEventListener("abort", () => resolve("deadline"), { once: true }),
  );
  let iterator: AsyncIterator<SDKMessage> | undefined;
  let finished = false;

  try {
    const messages = deps.query({
      prompt: question,
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
      },
    });
    iterator = messages[Symbol.asyncIterator]();
    // Racing every step against the deadline stops the run even if the SDK ignores the abort.
    for (;;) {
      const next = await Promise.race([iterator.next(), deadline]);
      if (next === "deadline") {
        timedOut = !error;
        break;
      }
      if (next.done) {
        finished = true;
        break;
      }
      const message = next.value;
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
          break;
        }
      } else if (message.type === "system" && (message as { subtype?: string }).subtype === "api_retry") {
        retryErrors.push(String((message as { error?: unknown }).error ?? ""));
      } else if (message.type === "result") {
        result = message;
      }
    }
  } catch (caught) {
    if (!error && !result) {
      if (controller.signal.aborted) timedOut = true;
      else error = `the agent failed: ${caught instanceof Error ? caught.message : String(caught)}`;
    }
  } finally {
    clearTimeout(timer);
    if (!finished) {
      controller.abort();
      void iterator?.return?.().catch(() => undefined);
    }
  }

  const timeoutMessage = `timed out after ${Math.round(timeoutMs / 1000)} s`;
  if (!error) {
    if (!result) {
      error = timedOut ? timeoutMessage : "the agent ended without a result";
    } else if (result.subtype !== "success") {
      error = `the agent stopped: ${result.subtype}${result.errors?.length ? ` (${result.errors.join("; ")})` : ""}`;
    } else if (result.is_error) {
      const status = (result as { api_error_status?: number | null }).api_error_status;
      error = `API error${status ? ` ${status}` : ""}: ${result.result}`;
    } else {
      const problems = answerProblems(result.structured_output);
      if (problems.length > 0) error = `the answer did not match the expected schema (${problems.join("; ")})`;
      else answer = result.structured_output as VeteranAnswer;
    }
  }

  const status = (result as { api_error_status?: number | null } | undefined)?.api_error_status;
  const authFailure = error !== undefined && looksLikeAuthFailure(status, error, retryErrors);
  if (authFailure) error = `${error}\n${LOGIN_HINT}`;

  const costUsd = result?.total_cost_usd ?? 0;
  const durationMs = result?.duration_ms ?? now().getTime() - startedAt;
  transcript.write({
    type: "summary",
    question,
    sessionId: sessionId ?? result?.session_id ?? null,
    subtype: result?.subtype ?? (timedOut ? "aborted" : null),
    total_cost_usd: costUsd,
    duration_ms: durationMs,
    num_turns: result?.num_turns ?? null,
    maxTurns: MAX_TURNS,
    maxBudgetUsd: MAX_BUDGET_USD,
    answer,
    validation: [],
    hookDenials: denials,
    error: error ?? null,
  });

  return { ok: error === undefined, answer, error, authFailure, transcriptPath: transcript.path, costUsd, durationMs };
}
