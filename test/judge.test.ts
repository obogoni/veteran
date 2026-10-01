import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { judgeAnswer, JUDGE_MAX_BUDGET_USD, JUDGE_TIMEOUT_MS } from "../src/evals/rubricJudge.ts";
import { judgeLeak, JUDGE_MAX_BUDGET_USD as VALIDATION_BUDGET, JUDGE_TIMEOUT_MS as VALIDATION_TIMEOUT } from "../src/validate/judge.ts";
import { ANSWER, askProfile, fakeQuery, run } from "./fakes.ts";

const CASE = { id: "a", question: "pergunta a", referenceAnswer: "referência a", tags: ["t"], adversarial: false };

test("C12 the validation judge ends at its deadline even when the SDK ignores the abort, with a 0.25 budget", async () => {
  const fake = fakeQuery().judge({ hangIgnoringAbort: true });
  const started = Date.now();
  const result = await judgeLeak("pergunta", [{ field: "answer", text: "resposta" }], { query: fake.query, env: {}, timeoutMs: 500 });
  assert.ok(Date.now() - started < 3000, `${Date.now() - started} ms`);
  assert.equal(result.verdict, undefined);
  assert.match(result.error!, /timed out/);
  assert.equal(fake.judgeCalls[0]!.options.maxBudgetUsd, 0.25);
  assert.equal(fake.judgeCalls[0]!.options.abortController?.signal.aborted, true);
  assert.equal(VALIDATION_BUDGET, 0.25);
  assert.equal(VALIDATION_TIMEOUT, 120_000);
});

test("C12 the rubric judge ends at its deadline even when the SDK ignores the abort, with a 0.25 budget", async () => {
  const fake = fakeQuery({ hangIgnoringAbort: true });
  const started = Date.now();
  const result = await judgeAnswer(CASE, ANSWER, "# Rubric", { query: fake.query, env: {}, timeoutMs: 500 });
  assert.ok(Date.now() - started < 3000, `${Date.now() - started} ms`);
  assert.equal(result.error, "judge failed: timed out");
  assert.equal(fake.calls[0]!.options.maxBudgetUsd, 0.25);
  assert.equal(JUDGE_MAX_BUDGET_USD, 0.25);
  assert.equal(JUDGE_TIMEOUT_MS, 120_000);
});

test("C12 runEvals passes its timeout to the rubric judge", async () => {
  const dir = askProfile();
  mkdirSync(join(dir, "evals"));
  writeFileSync(join(dir, "evals", "real.jsonl"), `${JSON.stringify(CASE)}\n`);
  writeFileSync(join(dir, "evals", "rubric.md"), "# Rubric\n");
  const started = Date.now();
  const result = await run(["eval"], dir, fakeQuery({}, { hangIgnoringAbort: true }).query, { timeoutMs: 700 });
  assert.equal(result.code, 0, result.stderr);
  assert.ok(Date.now() - started < 10_000, `${Date.now() - started} ms`);
  assert.match(result.stdout, /^a  FAILED: judge failed: timed out  /m);
});
