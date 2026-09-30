import assert from "node:assert/strict";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { loadEvalSet } from "../src/evals/cases.ts";
import { nearestRank } from "../src/evals/runEvals.ts";
import { ROOT } from "./helpers.ts";
import { ANSWER, askProfile, fakeQuery, run, type FakeScenario } from "./fakes.ts";

const RUBRIC = "# Rubric\nRUBRIC-MARKER correct businessLevel byBranch admitsUncertainty noLeak\n";

function verdict(overrides: Record<string, boolean> = {}) {
  const items = ["correct", "businessLevel", "byBranch", "admitsUncertainty", "noLeak"];
  return Object.fromEntries(items.map((name) => [name, { pass: overrides[name] ?? true, reason: `${name} reason` }]));
}

function evalProfile(lines: (Record<string, unknown> | string)[], options: { rubric?: boolean; file?: string } = {}): string {
  const dir = askProfile();
  mkdirSync(join(dir, "evals"), { recursive: true });
  writeFileSync(join(dir, "evals", options.file ?? "real.jsonl"), lines.map((line) => (typeof line === "string" ? line : JSON.stringify(line))).join("\n") + "\n");
  if (options.rubric !== false) writeFileSync(join(dir, "evals", "rubric.md"), RUBRIC);
  return dir;
}

const realCase = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  question: `pergunta ${id}`,
  referenceAnswer: `referência ${id}`,
  tags: ["t"],
  adversarial: false,
  ...extra,
});

/** Alternates an agent answer and a judge verdict per case. */
function agentThenJudge(...judgeVerdicts: Record<string, unknown>[]): FakeScenario[] {
  return judgeVerdicts.flatMap((v) => [{ answer: ANSWER, result: { duration_ms: 4200, total_cost_usd: 0.1 } }, { answer: v, result: { total_cost_usd: 0.01, duration_ms: 900 } }]);
}

test("C16 each real case runs once through ask, sequentially, and the judge sees question, reference, branches and rubric", async () => {
  const branches = [
    { condition: "tipo A", behavior: "não desativa" },
    { condition: "tipo B", behavior: "desativa" },
  ];
  const dir = evalProfile([realCase("a", { expectedBranches: branches }), realCase("b")]);
  const fake = fakeQuery(...agentThenJudge(verdict(), verdict()));
  const result = await run(["eval"], dir, fake.query);
  assert.equal(result.code, 0, result.stderr);
  assert.equal(fake.calls.length, 4);
  assert.equal(fake.maxActive(), 1);
  const [askA, judgeA, askB] = fake.calls;
  assert.equal(askA!.prompt, "pergunta a");
  assert.equal(askA!.options.model, "claude-opus-5-5");
  assert.equal(askB!.prompt, "pergunta b");
  assert.equal(judgeA!.options.model, "claude-sonnet-5-5");
  assert.deepEqual(judgeA!.options.tools, []);
  assert.equal(judgeA!.options.maxTurns, 1);
  assert.ok(judgeA!.prompt.includes("RUBRIC-MARKER"));
  assert.ok(judgeA!.prompt.includes("pergunta a"));
  assert.ok(judgeA!.prompt.includes("referência a"));
  assert.ok(judgeA!.prompt.includes("não desativa"));
  assert.ok(!judgeA!.prompt.includes("INTERNAL-REF"), "internalReferences stays out of the judge prompt");
});

test("C17 one line per case with the five items, cost and seconds, then accuracy, cost and p50/p95", async () => {
  const branches = [
    { condition: "x", behavior: "y" },
    { condition: "z", behavior: "w" },
  ];
  const dir = evalProfile([realCase("a", { expectedBranches: branches }), realCase("b", { expectedBranches: branches }), realCase("c")]);
  const fake = fakeQuery(...agentThenJudge(verdict(), verdict({ byBranch: false }), verdict({ byBranch: false, businessLevel: false })));
  const result = await run(["eval"], dir, fake.query);
  assert.equal(result.code, 0, result.stderr);
  assert.deepEqual(result.stdout.trimEnd().split("\n"), [
    "a  correct=pass businessLevel=pass byBranch=pass admitsUncertainty=pass noLeak=pass  $0.1100  4.2s  ACCURATE",
    "b  correct=pass businessLevel=pass byBranch=fail admitsUncertainty=pass noLeak=pass  $0.1100  4.2s  NOT ACCURATE",
    "c  correct=pass businessLevel=fail byBranch=fail admitsUncertainty=pass noLeak=pass  $0.1100  4.2s  ACCURATE",
    "accuracy 2/3 (67%) · cost $0.3300 · p50 4.2s · p95 4.2s · 0 adversarial skipped",
  ]);
});

test("C17 a failing correct makes a case not accurate", async () => {
  const dir = evalProfile([realCase("a")]);
  const result = await run(["eval"], dir, fakeQuery(...agentThenJudge(verdict({ correct: false }))).query);
  assert.match(result.stdout, /^a  correct=fail .* NOT ACCURATE$/m);
  assert.match(result.stdout, /accuracy 0\/1 \(0%\)/);
});

test("C17 p50 and p95 use nearest-rank", () => {
  const values = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
  assert.equal(nearestRank(values, 50), 50);
  assert.equal(nearestRank(values, 95), 100);
  assert.equal(nearestRank([7, 1, 3], 50), 3);
  assert.equal(nearestRank([7, 1, 3], 95), 7);
  assert.equal(nearestRank([5], 95), 5);
  assert.equal(nearestRank([], 50), undefined);
});

test("C18 a failed ask counts as not accurate, says why, and the next case still runs; exit 0", async () => {
  const dir = evalProfile([realCase("a"), realCase("b")]);
  const fake = fakeQuery({ result: { subtype: "error_max_turns", is_error: true, total_cost_usd: 0.5, duration_ms: 9000 } }, ...agentThenJudge(verdict()));
  const result = await run(["eval"], dir, fake.query);
  assert.equal(result.code, 0, result.stderr);
  const lines = result.stdout.trimEnd().split("\n");
  assert.equal(lines[0], "a  FAILED: the agent stopped: error_max_turns  $0.5000  9.0s");
  assert.match(lines[1]!, /^b  correct=pass .* ACCURATE$/);
  assert.match(lines[2]!, /^accuracy 1\/2 \(50%\)/);
});

test("C18 a timed-out ask and an off-schema answer also count as not accurate without stopping the run", async () => {
  const dir = evalProfile([realCase("a"), realCase("b"), realCase("c")]);
  const fake = fakeQuery({ hang: true }, { answer: { answer: "só texto" } }, ...agentThenJudge(verdict()));
  const result = await run(["eval"], dir, fake.query, { timeoutMs: 500 });
  assert.equal(result.code, 0, result.stderr);
  const lines = result.stdout.trimEnd().split("\n");
  assert.match(lines[0]!, /^a  FAILED: timed out after 1 s  \$0\.0000  \d+\.\ds$/);
  assert.match(lines[1]!, /^b  FAILED: the answer did not match the expected schema/);
  assert.match(lines[2]!, /^c  correct=pass .* ACCURATE$/);
  assert.match(lines[3]!, /^accuracy 1\/3 \(33%\)/);
});

test("C19 bad JSON, format errors, duplicate ids and a missing rubric are all reported in one run; no agent starts", async () => {
  const dir = evalProfile(
    [
      realCase("a"),
      "{not json",
      { id: "", question: "q", referenceAnswer: "r", tags: ["t"], adversarial: "no" },
      realCase("a"),
      { ...realCase("c"), extra: true },
      { ...realCase("d"), expectedBranches: [{ condition: "x" }] },
      { question: "q", referenceAnswer: "r", tags: "t", adversarial: false },
    ],
    { rubric: false },
  );
  const fake = fakeQuery({});
  const result = await run(["eval"], dir, fake.query);
  assert.equal(result.code, 1);
  assert.equal(fake.calls.length, 0);
  for (const expected of [
    /real\.jsonl:2: not valid JSON/,
    /real\.jsonl:3: id: expected a non-empty string/,
    /real\.jsonl:3: adversarial: expected true or false/,
    /real\.jsonl:4: duplicate id "a" \(first at real\.jsonl:1\)/,
    /real\.jsonl:5: extra: unexpected field/,
    /real\.jsonl:6: expectedBranches: expected a non-empty list/,
    /real\.jsonl:7: id: missing/,
    /real\.jsonl:7: tags: expected a list of strings/,
    /rubric\.md: rubric not found/,
  ]) {
    assert.match(result.stderr, expected);
  }
});

test("C19 a profile with no eval files exits 1 and starts no agent", async () => {
  const dir = askProfile();
  const fake = fakeQuery({});
  const result = await run(["eval"], dir, fake.query);
  assert.equal(result.code, 1);
  assert.match(result.stderr, /no \*\.jsonl eval files/);
  assert.equal(fake.calls.length, 0);
});

test("C20 adversarial cases are not run and are counted as skipped", async () => {
  const dir = evalProfile([realCase("a"), { ...realCase("x"), adversarial: true }, { ...realCase("y"), adversarial: true }]);
  const fake = fakeQuery(...agentThenJudge(verdict()));
  const result = await run(["eval"], dir, fake.query);
  assert.equal(result.code, 0, result.stderr);
  assert.equal(fake.calls.length, 2);
  assert.ok(!fake.calls.some((call) => call.prompt.includes("pergunta x") || call.prompt.includes("pergunta y")));
  assert.match(result.stdout, /accuracy 1\/1 \(100%\) · .* · 2 adversarial skipped$/m);
});

test("C21 the example profile holds at least 5 valid real cases and a rubric with the five items", () => {
  const set = loadEvalSet(join(ROOT, "profiles", "example"));
  const real = set.cases.filter((evalCase) => !evalCase.adversarial);
  assert.ok(real.length >= 5, `${real.length} real cases`);
  for (const evalCase of real) assert.ok(["workspaces", "tasks", "agents"].some((area) => evalCase.tags.includes(area)), evalCase.id);
  const headings = [...set.rubric.matchAll(/^## (\w+)$/gm)].map((match) => match[1]);
  assert.deepEqual(headings.slice(0, 5), ["correct", "businessLevel", "byBranch", "admitsUncertainty", "noLeak"]);
});

test("C23 the judge never receives an API key, token or base URL either", async () => {
  const dir = evalProfile([realCase("a")]);
  const fake = fakeQuery(...agentThenJudge(verdict()));
  const env = { ANTHROPIC_API_KEY: "sk-ant-x", ANTHROPIC_AUTH_TOKEN: "t", ANTHROPIC_BASE_URL: "https://proxy.invalid" };
  await run(["eval"], dir, fake.query, { env });
  assert.equal(fake.calls.length, 2);
  for (const call of fake.calls) {
    for (const key of Object.keys(env)) assert.ok(!(key in call.options.env!), `${call.options.model}: ${key}`);
  }
});

test("C19 the loader ignores blank lines and accepts followUp", () => {
  const dir = evalProfile([realCase("a", { followUp: { message: "não é o que vejo", referenceAnswer: "depende" } }), ""]);
  assert.equal(loadEvalSet(dir).cases.length, 1);
  rmSync(dir, { recursive: true, force: true });
  assert.ok(readFileSync(join(ROOT, "profiles", "example", "evals", "rubric.md"), "utf8").length > 0);
});
