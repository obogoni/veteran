import type { VeteranAnswer } from "../agent/answerSchema.ts";
import type { QueryFn } from "../agent/sdk.ts";
import type { Scanner } from "../snapshot/scan.ts";
import { deterministicFindings, userFacingFields, type Finding } from "./deterministic.ts";
import { judgeLeak, JUDGE_TIMEOUT_MS } from "./judge.ts";
import { secretFindings } from "./secrets.ts";

/** One stage run on one attempt, as recorded in the transcript's `validation`. */
export interface StageEntry {
  attempt: 1 | 2;
  stage: "deterministic" | "judge";
  pass: boolean;
  findings?: Finding[];
  reason?: string;
  /** Set when the stage reached no verdict. */
  error?: string;
  costUsd: number;
}

export interface ValidationContext {
  question: string;
  denyTerms: string[];
  query: QueryFn;
  env?: NodeJS.ProcessEnv;
  scanner?: Scanner;
  /** A caller's deadline; the judge never waits longer than its own 120 s. */
  timeoutMs?: number;
}

type AttemptVerdict =
  | { status: "pass" }
  | { status: "fail"; feedback: string[]; ids: string }
  | { status: "no-verdict"; error: string };

export interface Regenerated {
  answer: VeteranAnswer | null;
  error?: string;
}

export interface PipelineOutcome {
  /** An answer whose own attempt passed both stages, or `null`. */
  answer: VeteranAnswer | null;
  attempts: 1 | 2;
  fallback: boolean;
  /** Stage and rule ids per attempt; never the matched text. Set on fallback. */
  rejection?: string;
  validation: StageEntry[];
  judgeDurationMs: number;
}

/**
 * Validates attempt 1, regenerates once with feedback when it fails, and validates attempt 2. Never
 * returns an answer that failed or skipped a stage: every path but a pass ends in the fallback.
 */
export async function runPipeline(first: VeteranAnswer, ctx: ValidationContext, regenerate: (prompt: string) => Promise<Regenerated>): Promise<PipelineOutcome> {
  const validation: StageEntry[] = [];
  const timing = { judgeDurationMs: 0 };
  const done = (answer: VeteranAnswer | null, attempts: 1 | 2, rejection?: string): PipelineOutcome => ({
    answer,
    attempts,
    fallback: answer === null,
    rejection,
    validation,
    judgeDurationMs: timing.judgeDurationMs,
  });

  const verdict1 = await validateAttempt(first, 1, ctx, validation, timing);
  if (verdict1.status === "pass") return done(first, 1);
  if (verdict1.status === "no-verdict") return done(null, 1, `attempt 1: ${verdict1.error}`);

  const second = await regenerate(feedbackPrompt(ctx.question, verdict1.feedback));
  if (!second.answer) return done(null, 2, `attempt 1: ${verdict1.ids}; attempt 2: ${(second.error ?? "no answer").split("\n")[0]}`);

  const verdict2 = await validateAttempt(second.answer, 2, ctx, validation, timing);
  if (verdict2.status === "pass") return done(second.answer, 2);
  return done(null, 2, `attempt 1: ${verdict1.ids}; attempt 2: ${verdict2.status === "fail" ? verdict2.ids : verdict2.error}`);
}

async function validateAttempt(
  answer: VeteranAnswer,
  attempt: 1 | 2,
  ctx: ValidationContext,
  log: StageEntry[],
  timing: { judgeDurationMs: number },
): Promise<AttemptVerdict> {
  const fields = userFacingFields(answer);
  const findings = deterministicFindings(answer, ctx.denyTerms);
  try {
    findings.push(...(await secretFindings(fields, ctx.scanner)));
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    log.push({ attempt, stage: "deterministic", pass: false, findings, error: `gitleaks: ${reason}`, costUsd: 0 });
    return { status: "no-verdict", error: `gitleaks gave no verdict (${reason})` };
  }
  if (findings.length > 0) {
    log.push({ attempt, stage: "deterministic", pass: false, findings, costUsd: 0 });
    const rules = [...new Set(findings.map((finding) => finding.rule))];
    return {
      status: "fail",
      feedback: findings.map((finding) => `- ${finding.field}: ${finding.rule} (${JSON.stringify(finding.match)})`),
      ids: `deterministic ${rules.join(", ")}`,
    };
  }
  log.push({ attempt, stage: "deterministic", pass: true, findings: [], costUsd: 0 });

  const judged = await judgeLeak(ctx.question, fields, {
    query: ctx.query,
    env: ctx.env,
    timeoutMs: Math.min(ctx.timeoutMs ?? JUDGE_TIMEOUT_MS, JUDGE_TIMEOUT_MS),
  });
  timing.judgeDurationMs += judged.durationMs;
  if (!judged.verdict) {
    log.push({ attempt, stage: "judge", pass: false, error: judged.error, costUsd: judged.costUsd });
    return { status: "no-verdict", error: `the validation judge gave no verdict (${judged.error})` };
  }
  const pass = !judged.verdict.revealsImplementation;
  log.push({ attempt, stage: "judge", pass, reason: judged.verdict.reason, costUsd: judged.costUsd });
  if (pass) return { status: "pass" };
  return { status: "fail", feedback: [`- judge: ${judged.verdict.reason}`], ids: "judge revealsImplementation" };
}

export function feedbackPrompt(question: string, feedback: string[]): string {
  return [
    "Your previous answer was rejected before reaching the user, because it reveals implementation details:",
    feedback.join("\n"),
    "Answer the original question again, in business terms only, following every rule in your instructions. Do not mention this review. The original question was:",
    question,
  ].join("\n\n");
}
