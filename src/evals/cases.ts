import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/** One line of `<profile>/evals/*.jsonl`; format decided in `.tasks/eval-set.md`. */
export interface EvalCase {
  id: string;
  question: string;
  referenceAnswer: string;
  expectedBranches?: { condition: string; behavior: string }[];
  /** Accepted and ignored until spike 6 (multi-turn). */
  followUp?: { message: string; referenceAnswer: string };
  tags: string[];
  adversarial: boolean;
}

export interface EvalSet {
  cases: EvalCase[];
  rubric: string;
}

export class EvalSetError extends Error {
  override name = "EvalSetError";
}

const REQUIRED = ["id", "question", "referenceAnswer", "tags", "adversarial"];
const OPTIONAL = ["expectedBranches", "followUp"];

/** Loads every case and the rubric, reporting every problem in one error. */
export function loadEvalSet(profileDir: string): EvalSet {
  const dir = join(profileDir, "evals");
  const problems: string[] = [];
  const cases: EvalCase[] = [];
  const firstSeen = new Map<string, string>();

  const files = existsSync(dir) && statSync(dir).isDirectory() ? readdirSync(dir).filter((name) => name.endsWith(".jsonl")).sort() : [];
  if (files.length === 0) problems.push(`${dir}: no *.jsonl eval files`);

  for (const name of files) {
    const lines = readFileSync(join(dir, name), "utf8").split(/\r?\n/);
    lines.forEach((text, index) => {
      if (text.trim() === "") return;
      const where = `${name}:${index + 1}`;
      let value: unknown;
      try {
        value = JSON.parse(text);
      } catch (error) {
        problems.push(`${where}: not valid JSON (${(error as Error).message})`);
        return;
      }
      const lineProblems = caseProblems(value);
      if (lineProblems.length > 0) {
        for (const problem of lineProblems) problems.push(`${where}: ${problem}`);
        return;
      }
      const evalCase = value as EvalCase;
      const earlier = firstSeen.get(evalCase.id);
      if (earlier) problems.push(`${where}: duplicate id ${JSON.stringify(evalCase.id)} (first at ${earlier})`);
      else firstSeen.set(evalCase.id, where);
      cases.push(evalCase);
    });
  }

  const rubricPath = join(dir, "rubric.md");
  const hasRubric = existsSync(rubricPath) && statSync(rubricPath).isFile();
  if (!hasRubric) problems.push(`${rubricPath}: rubric not found`);

  if (problems.length > 0) {
    throw new EvalSetError(`Invalid eval set in ${dir}:\n${problems.map((problem) => `  - ${problem}`).join("\n")}`);
  }
  return { cases, rubric: readFileSync(rubricPath, "utf8") };
}

function caseProblems(value: unknown): string[] {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return ["expected a JSON object"];
  const data = value as Record<string, unknown>;
  const problems: string[] = [];
  for (const key of Object.keys(data)) if (!REQUIRED.includes(key) && !OPTIONAL.includes(key)) problems.push(`${key}: unexpected field`);
  for (const field of ["id", "question", "referenceAnswer"]) {
    if (!(field in data)) problems.push(`${field}: missing`);
    else if (!nonEmpty(data[field])) problems.push(`${field}: expected a non-empty string`);
  }
  if (!("tags" in data)) problems.push("tags: missing");
  else if (!Array.isArray(data.tags) || !data.tags.every((tag) => typeof tag === "string")) problems.push("tags: expected a list of strings");
  if (!("adversarial" in data)) problems.push("adversarial: missing");
  else if (typeof data.adversarial !== "boolean") problems.push("adversarial: expected true or false");
  if ("expectedBranches" in data) {
    const branches = data.expectedBranches;
    const valid =
      Array.isArray(branches) &&
      branches.length > 0 &&
      branches.every((branch) => exactStrings(branch, ["condition", "behavior"]));
    if (!valid) problems.push("expectedBranches: expected a non-empty list of { condition, behavior } non-empty strings");
  }
  if ("followUp" in data && !exactStrings(data.followUp, ["message", "referenceAnswer"])) {
    problems.push("followUp: expected { message, referenceAnswer } non-empty strings");
  }
  return problems;
}

function nonEmpty(value: unknown): boolean {
  return typeof value === "string" && value.trim() !== "";
}

function exactStrings(value: unknown, keys: string[]): boolean {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const data = value as Record<string, unknown>;
  return Object.keys(data).length === keys.length && keys.every((key) => nonEmpty(data[key]));
}
