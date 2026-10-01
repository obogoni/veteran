import { ask, assertAskable, type AskDeps } from "../agent/ask.ts";
import type { Profile } from "../profile/loadProfile.ts";
import { loadEvalSet, type EvalCase } from "./cases.ts";
import { judgeAnswer, JUDGE_TIMEOUT_MS, RUBRIC_ITEMS, type Verdict } from "./rubricJudge.ts";

export interface CaseOutcome {
  id: string;
  adversarial: boolean;
  accurate: boolean;
  /** The case got an answer or the fallback; a failed run delivered nothing. */
  delivered: boolean;
  /** The delivered answer failed the rubric's `noLeak`, or was never graded. A fallback never leaks. */
  leaked: boolean;
  verdict?: Verdict;
  /** Stage and rule ids when the case ended in the fallback. */
  fallback?: string;
  failure?: string;
  costUsd: number;
  durationMs: number;
}

export interface EvalSummary {
  outcomes: CaseOutcome[];
}

/** A case is accurate when `correct` passes and, for a case with expected branches, `byBranch` too. */
export function isAccurate(evalCase: EvalCase, verdict: Verdict): boolean {
  return verdict.correct.pass && (evalCase.expectedBranches ? verdict.byBranch.pass : true);
}

/** Nearest-rank percentile over `values`; undefined for an empty list. */
export function nearestRank(values: number[], percentile: number): number | undefined {
  if (values.length === 0) return undefined;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.max(1, Math.ceil((percentile / 100) * sorted.length));
  return sorted[rank - 1];
}

export function formatCaseLine(outcome: CaseOutcome): string {
  const money = `$${outcome.costUsd.toFixed(4)}`;
  const seconds = `${(outcome.durationMs / 1000).toFixed(1)}s`;
  if (outcome.fallback !== undefined) return `${outcome.id}  FALLBACK: ${outcome.fallback}  ${money}  ${seconds}`;
  if (!outcome.verdict) return `${outcome.id}  FAILED: ${outcome.failure}  ${money}  ${seconds}`;
  // Every item prints pass/fail (block 3 criterion 17); `byBranch` only decides accuracy when the case has expected branches.
  const items = RUBRIC_ITEMS.map((name) => `${name}=${outcome.verdict![name].pass ? "pass" : "fail"}`);
  const tail = outcome.adversarial ? "ADVERSARIAL" : outcome.accurate ? "ACCURATE" : "NOT ACCURATE";
  return `${outcome.id}  ${items.join(" ")}  ${money}  ${seconds}  ${tail}`;
}

export function formatSummary(summary: EvalSummary): string {
  const percent = (part: number, whole: number) => (whole === 0 ? "n/a" : `${Math.round((part / whole) * 100)}%`);
  const real = summary.outcomes.filter((outcome) => !outcome.adversarial);
  const accurate = real.filter((outcome) => outcome.accurate).length;
  const delivered = summary.outcomes.filter((outcome) => outcome.delivered).length;
  const leaks = summary.outcomes.filter((outcome) => outcome.leaked).length;
  const cost = summary.outcomes.reduce((sum, outcome) => sum + outcome.costUsd, 0);
  const durations = summary.outcomes.map((outcome) => outcome.durationMs);
  const seconds = (ms: number | undefined) => (ms === undefined ? "n/a" : `${(ms / 1000).toFixed(1)}s`);
  return [
    `accuracy ${accurate}/${real.length} (${percent(accurate, real.length)})`,
    `leaks ${leaks}/${delivered} (${percent(leaks, delivered)})`,
    `cost $${cost.toFixed(4)}`,
    `p50 ${seconds(nearestRank(durations, 50))}`,
    `p95 ${seconds(nearestRank(durations, 95))}`,
  ].join(" · ");
}

/**
 * Runs every case, real and adversarial, through `ask` (validation included), one at a time, and
 * grades each delivered answer with the rubric judge. A failing case never stops the run.
 */
export async function runEvals(profile: Profile, deps: AskDeps, writeLine: (line: string) => void): Promise<EvalSummary> {
  const { cases, rubric } = loadEvalSet(profile.dir);
  assertAskable(profile);
  const outcomes: CaseOutcome[] = [];
  for (const evalCase of cases) {
    const outcome = await runCase(profile, evalCase, rubric, deps);
    outcomes.push(outcome);
    writeLine(formatCaseLine(outcome));
  }
  const summary = { outcomes };
  writeLine(formatSummary(summary));
  return summary;
}

async function runCase(profile: Profile, evalCase: EvalCase, rubric: string, deps: AskDeps): Promise<CaseOutcome> {
  const base = { id: evalCase.id, adversarial: evalCase.adversarial, accurate: false, delivered: false, leaked: false };
  let answered;
  try {
    answered = await ask(profile, evalCase.question, deps);
  } catch (error) {
    return { ...base, failure: (error as Error).message, costUsd: 0, durationMs: 0 };
  }
  const run = { ...base, costUsd: answered.costUsd, durationMs: answered.durationMs };
  if (answered.fallback) return { ...run, delivered: true, fallback: answered.rejection ?? "validation failed" };
  if (!answered.ok || !answered.answer) return { ...run, failure: (answered.error ?? "no answer").split("\n")[0] };

  const judged = await judgeAnswer(evalCase, answered.answer, rubric, {
    query: deps.query,
    env: deps.env,
    timeoutMs: Math.min(deps.timeoutMs ?? JUDGE_TIMEOUT_MS, JUDGE_TIMEOUT_MS),
  });
  const costUsd = run.costUsd + judged.costUsd;
  // The answer reached the reader but nobody checked it for leaks: it counts as a leak, so a judge
  // failure fails the "0 leaks" gate instead of passing it (author, 2026-10-01).
  if (!judged.verdict) return { ...run, delivered: true, leaked: true, costUsd, failure: judged.error };
  return {
    ...run,
    costUsd,
    delivered: true,
    verdict: judged.verdict,
    leaked: !judged.verdict.noLeak.pass,
    accurate: !evalCase.adversarial && isAccurate(evalCase, judged.verdict),
  };
}
