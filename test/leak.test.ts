import assert from "node:assert/strict";
import { cpSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { loadEvalSet } from "../src/evals/cases.ts";
import { scanForSecrets } from "../src/snapshot/scan.ts";
import { ANSWER, askProfile, fakeQuery, run, type FakeScenario } from "./fakes.ts";
import { ROOT, tempDir } from "./helpers.ts";

function verdict(overrides: Record<string, boolean> = {}) {
  const items = ["correct", "businessLevel", "byBranch", "admitsUncertainty", "noLeak"];
  return Object.fromEntries(items.map((name) => [name, { pass: overrides[name] ?? true, reason: `${name} reason` }]));
}

function evalProfile(cases: Record<string, unknown>[]): string {
  const dir = askProfile();
  mkdirSync(join(dir, "evals"));
  writeFileSync(join(dir, "evals", "cases.jsonl"), cases.map((line) => JSON.stringify(line)).join("\n") + "\n");
  writeFileSync(join(dir, "evals", "rubric.md"), "# Rubric\n");
  return dir;
}

const evalCase = (id: string, adversarial: boolean) => ({ id, question: `pergunta ${id}`, referenceAnswer: `referência ${id}`, tags: [adversarial ? "code-request" : "t"], adversarial });
const agent = (answer: unknown = ANSWER): FakeScenario => ({ answer, result: { total_cost_usd: 0.1, duration_ms: 4200 } });
const rubric = (overrides: Record<string, boolean> = {}): FakeScenario => ({ answer: verdict(overrides), result: { total_cost_usd: 0.01, duration_ms: 900 } });
const LEAKY = { ...ANSWER, answer: "Use o OrderService.Cancel." };

test("C21 real and adversarial cases both run through ask and get graded; accuracy counts only real cases", async () => {
  const dir = evalProfile([evalCase("a", false), evalCase("x", true)]);
  const fake = fakeQuery(agent(), rubric(), agent(), rubric({ correct: false }));
  const result = await run(["eval"], dir, fake.query);
  assert.equal(result.code, 0, result.stderr);
  assert.deepEqual(
    fake.calls.map((call) => [call.options.model, call.prompt.includes("pergunta x") ? "x" : "a"]),
    [
      ["claude-opus-5-5", "a"],
      ["claude-sonnet-5-5", "a"],
      ["claude-opus-5-5", "x"],
      ["claude-sonnet-5-5", "x"],
    ],
  );
  assert.equal(fake.judgeCalls.length, 2, "both answers went through validation");
  assert.ok(!result.stdout.includes("skipped"));
  assert.match(result.stdout, /^x  correct=fail .*  ADVERSARIAL$/m);
  assert.match(result.stdout, /^accuracy 1\/1 \(100%\) · /m);
});

test("C22 a failed noLeak is a leak; a fallback prints FALLBACK, skips the rubric judge and does not leak; the summary line has leaks", async () => {
  const dir = evalProfile([evalCase("a", false), evalCase("b", false), evalCase("c", true)]);
  const fake = fakeQuery(agent(), rubric({ noLeak: false }), agent(LEAKY), agent(LEAKY), agent(), rubric());
  const result = await run(["eval"], dir, fake.query);
  assert.equal(result.code, 0, result.stderr);
  assert.equal(fake.calls.length, 6, "no rubric call for the fallback case");
  assert.deepEqual(result.stdout.trimEnd().split("\n"), [
    "a  correct=pass businessLevel=pass byBranch=pass admitsUncertainty=pass noLeak=fail  $0.1100  4.2s  ACCURATE",
    "b  FALLBACK: attempt 1: deterministic identifier; attempt 2: deterministic identifier  $0.2000  8.4s",
    "c  correct=pass businessLevel=pass byBranch=pass admitsUncertainty=pass noLeak=pass  $0.1100  4.2s  ADVERSARIAL",
    "accuracy 1/2 (50%) · leaks 1/3 (33%) · cost $0.4200 · p50 4.2s · p95 8.4s",
  ]);
});

test("C22 a failed case delivers nothing and is not in the leak denominator", async () => {
  const dir = evalProfile([evalCase("a", false), evalCase("b", true)]);
  const fake = fakeQuery({ result: { subtype: "error_max_turns", is_error: true, total_cost_usd: 0.5, duration_ms: 9000 } }, agent(), rubric());
  const result = await run(["eval"], dir, fake.query);
  assert.match(result.stdout, /^accuracy 0\/1 \(0%\) · leaks 0\/1 \(0%\) · /m);
  const none = await run(["eval"], evalProfile([evalCase("a", false)]), fakeQuery({ result: { subtype: "error_max_turns", is_error: true } }).query);
  assert.match(none.stdout, /^accuracy 0\/1 \(0%\) · leaks 0\/0 \(n\/a\) · /m);
});

test("C25 the example profile holds at least 5 adversarial cases, one per tag, and no secret", { timeout: 120_000 }, () => {
  const example = join(ROOT, "profiles", "example");
  const adversarial = loadEvalSet(example).cases.filter((evalCase) => evalCase.adversarial);
  assert.ok(adversarial.length >= 5, `${adversarial.length} adversarial cases`);
  for (const tag of ["code-request", "table-request", "secret-request", "injection", "excluded-area"]) {
    assert.ok(adversarial.some((evalCase) => evalCase.tags.includes(tag)), tag);
  }
});

test("C25 the example's eval files hold no secret, by the snapshot's canary-checked scan", { timeout: 120_000 }, async () => {
  const root = tempDir("evals-scan");
  cpSync(join(ROOT, "profiles", "example", "evals"), join(root, "scan", "tree"), { recursive: true });
  mkdirSync(join(root, "work"));
  // Throws when gitleaks finds a secret or does not report its canary.
  await scanForSecrets(join(root, "scan"), join(root, "work"));
});
