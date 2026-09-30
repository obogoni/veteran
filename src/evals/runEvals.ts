import { ask, assertAskable, type AskDeps } from "../agent/ask.ts";
import type { Profile } from "../profile/loadProfile.ts";
import { loadEvalSet, type EvalCase } from "./cases.ts";
import { judgeAnswer, RUBRIC_ITEMS, type Verdict } from "./rubricJudge.ts";

export interface CaseOutcome {
  id: string;
  accurate: boolean;
  verdict?: Verdict;
  failure?: string;
  costUsd: number;
  durationMs: number;
}

export interface EvalSummary {
  outcomes: CaseOutcome[];
  skipped: number;
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
  if (!outcome.verdict) return `${outcome.id}  FAILED: ${outcome.failure}  ${money}  ${seconds}`;
  // Every item prints pass/fail (criterion 17); `byBranch` only decides accuracy when the case has expected branches.
  const items = RUBRIC_ITEMS.map((name) => `${name}=${outcome.verdict![name].pass ? "pass" : "fail"}`);
  return `${outcome.id}  ${items.join(" ")}  ${money}  ${seconds}  ${outcome.accurate ? "ACCURATE" : "NOT ACCURATE"}`;
}

export function formatSummary(summary: EvalSummary): string {
  const total = summary.outcomes.length;
  const passed = summary.outcomes.filter((outcome) => outcome.accurate).length;
  const percent = total === 0 ? "n/a" : `${Math.round((passed / total) * 100)}%`;
  const cost = summary.outcomes.reduce((sum, outcome) => sum + outcome.costUsd, 0);
  const durations = summary.outcomes.map((outcome) => outcome.durationMs);
  const seconds = (ms: number | undefined) => (ms === undefined ? "n/a" : `${(ms / 1000).toFixed(1)}s`);
  return `accuracy ${passed}/${total} (${percent}) · cost $${cost.toFixed(4)} · p50 ${seconds(nearestRank(durations, 50))} · p95 ${seconds(nearestRank(durations, 95))} · ${summary.skipped} adversarial skipped`;
}

/**
 * Runs every real case through `ask`, one at a time, and grades each answer with the rubric judge.
 * Adversarial cases are counted and skipped (leak scoring is block 4). A failing case never stops the run.
 */
export async function runEvals(profile: Profile, deps: AskDeps, writeLine: (line: string) => void): Promise<EvalSummary> {
  const { cases, rubric } = loadEvalSet(profile.dir);
  assertAskable(profile);
  const outcomes: CaseOutcome[] = [];
  let skipped = 0;
  for (const evalCase of cases) {
    if (evalCase.adversarial) {
      skipped++;
      continue;
    }
    const outcome = await runCase(profile, evalCase, rubric, deps);
    outcomes.push(outcome);
    writeLine(formatCaseLine(outcome));
  }
  const summary = { outcomes, skipped };
  writeLine(formatSummary(summary));
  return summary;
}

async function runCase(profile: Profile, evalCase: EvalCase, rubric: string, deps: AskDeps): Promise<CaseOutcome> {
  let answered;
  try {
    answered = await ask(profile, evalCase.question, deps);
  } catch (error) {
    return { id: evalCase.id, accurate: false, failure: (error as Error).message, costUsd: 0, durationMs: 0 };
  }
  const base = { id: evalCase.id, costUsd: answered.costUsd, durationMs: answered.durationMs };
  if (!answered.ok || !answered.answer) {
    return { ...base, accurate: false, failure: (answered.error ?? "no answer").split("\n")[0] };
  }
  const judged = await judgeAnswer(evalCase, answered.answer, rubric, { query: deps.query, env: deps.env });
  const costUsd = base.costUsd + judged.costUsd;
  if (!judged.verdict) return { ...base, costUsd, accurate: false, failure: judged.error };
  return { ...base, costUsd, verdict: judged.verdict, accurate: isAccurate(evalCase, judged.verdict) };
}
