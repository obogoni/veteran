import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";
import { ask } from "../src/agent/ask.ts";
import { renderAnswer } from "../src/agent/render.ts";
import { loadProfile } from "../src/profile/loadProfile.ts";
import { DISABLED_PLUGINS } from "../src/agent/sdk.ts";
import { ANSWER, askProfile, fakeQuery, JUDGE_PASS, readTranscript, run, STUB_SCANNER, transcriptsOf, type FakeScenario } from "./fakes.ts";
import { ROOT, tempDir } from "./helpers.ts";

const Q = "Posso cancelar um pedido já faturado?";
const CAVEAT = "Comportamento da versão atual.";
const FALLBACK = "Não consegui responder isso com segurança. Leve a pergunta para um desenvolvedor.";

/** An answer that fails the deterministic check on `OrderService.Cancel` (rule identifier). */
const LEAKY = { ...ANSWER, answer: "Sim, o OrderService.Cancel cuida disso." };
const SECOND = { ...ANSWER, answer: "Sim, enquanto a nota não foi emitida." };

const judgeFails = (reason: string): FakeScenario => ({ answer: { revealsImplementation: true, reason }, result: { total_cost_usd: 0, duration_ms: 0 } });

test("C11 after a deterministic pass, one judge call runs isolated, with the question and the user-facing fields only", async () => {
  const dir = askProfile();
  const answer = { ...ANSWER, clarifyingQuestion: "Qual é o tipo do pedido?" };
  const fake = fakeQuery({ answer });
  const result = await run(["ask", Q], dir, fake.query, { env: { ANTHROPIC_API_KEY: "sk-ant-x", KEEP_ME: "1" } });
  assert.equal(result.code, 0, result.stderr);
  assert.equal(fake.judgeCalls.length, 1);
  const { prompt, options } = fake.judgeCalls[0]!;
  assert.equal(options.model, "claude-sonnet-5-5");
  assert.deepEqual(options.tools, []);
  assert.deepEqual(options.settingSources, []);
  assert.equal(options.maxTurns, 1);
  assert.equal(options.maxBudgetUsd, 0.25);
  assert.equal(options.permissionMode, "dontAsk");
  assert.deepEqual(options.outputFormat, {
    type: "json_schema",
    schema: {
      type: "object",
      additionalProperties: false,
      required: ["revealsImplementation", "reason"],
      properties: { revealsImplementation: { type: "boolean" }, reason: { type: "string" } },
    },
  });
  assert.deepEqual((options.settings as { enabledPlugins: unknown }).enabledPlugins, DISABLED_PLUGINS);
  assert.equal(options.hooks?.PreToolUse?.length, 1);
  const hook = options.hooks!.PreToolUse![0]!.hooks[0]!;
  const decide = async (tool_name: string) =>
    ((await hook({ hook_event_name: "PreToolUse", tool_name, tool_input: { file_path: "x" } } as never, undefined, { signal: new AbortController().signal })) as {
      hookSpecificOutput?: { permissionDecision?: string };
    }).hookSpecificOutput?.permissionDecision;
  assert.equal(await decide("Read"), "deny");
  assert.equal(await decide("StructuredOutput"), undefined);
  assert.notEqual(options.cwd, join(dir, "snapshot"));
  assert.match(options.systemPrompt as string, /does this answer reveal implementation details beyond business behavior\?/);
  assert.ok(prompt.includes(Q), "the question");
  for (const text of [answer.answer, answer.branches[0]!.condition, answer.branches[1]!.behavior, answer.suggestedTests[0]!, answer.clarifyingQuestion, answer.dependsOn[0]!, answer.caveats[0]!]) {
    assert.ok(prompt.includes(text), text);
  }
  assert.ok(!prompt.includes("INTERNAL-REF"), "internalReferences stays out");
  assert.equal(options.env?.KEEP_ME, "1");
  assert.ok(!("ANTHROPIC_API_KEY" in options.env!));
});

test("C11 revealsImplementation true fails the attempt, and a deterministic failure runs no judge for that attempt", async () => {
  const dir = askProfile();
  const flagged = fakeQuery({}, { answer: SECOND }).judge(judgeFails("cita uma tabela"), JUDGE_PASS);
  const result = await run(["ask", Q], dir, flagged.query);
  assert.equal(result.code, 0, result.stderr);
  assert.equal(flagged.calls.length, 2, "the judge's failure triggered a regeneration");
  assert.ok(result.stdout.startsWith(SECOND.answer));

  const leaky = fakeQuery({ answer: LEAKY }, { answer: SECOND });
  const second = await run(["ask", Q], askProfile(), leaky.query);
  assert.equal(second.code, 0, second.stderr);
  assert.equal(leaky.judgeCalls.length, 1, "only attempt 2 reached the judge");
  assert.ok(leaky.judgeCalls[0]!.prompt.includes(SECOND.answer));
});

test("C11 a judge session that is not isolated reaches no verdict", async () => {
  const fake = fakeQuery({}).judge({ init: { tools: ["StructuredOutput", "Read"] } });
  const result = await run(["ask", Q], askProfile(), fake.query);
  assert.equal(result.code, 1);
  assert.ok(result.stdout.startsWith(FALLBACK));
  assert.match(result.stderr, /judge session is not isolated/);
  assert.equal(fake.calls.length, 1);
});

test("C13 a failed attempt 1 regenerates once, resuming its session with the same limits and the findings as feedback", async () => {
  const dir = askProfile();
  const fake = fakeQuery({ answer: LEAKY, init: { session_id: "sess-A" } }, { answer: LEAKY });
  await run(["ask", Q], dir, fake.query);
  assert.equal(fake.calls.length, 2, "exactly one regeneration, even when it fails too");
  const [first, second] = fake.calls;
  assert.equal(first!.options.resume, undefined);
  assert.equal(second!.options.resume, "sess-A");
  for (const key of ["model", "cwd", "tools", "allowedTools", "disallowedTools", "settingSources", "permissionMode", "systemPrompt", "maxTurns", "maxBudgetUsd", "outputFormat"] as const) {
    assert.deepEqual(second!.options[key], first!.options[key], key);
  }
  assert.equal(second!.options.maxTurns, 40);
  assert.equal(second!.options.maxBudgetUsd, 1);
  assert.notEqual(second!.options.abortController, first!.options.abortController, "its own deadline");
  assert.ok(second!.prompt.includes('- answer: identifier ("OrderService.Cancel")'), second!.prompt);
  assert.ok(second!.prompt.includes(Q), "the original question");
});

test("C13 a judge rejection's reason is the feedback", async () => {
  const fake = fakeQuery({}, { answer: SECOND }).judge(judgeFails("cita o nome de uma tabela"), JUDGE_PASS);
  await run(["ask", Q], askProfile(), fake.query);
  assert.ok(fake.calls[1]!.prompt.includes("- judge: cita o nome de uma tabela"), fake.calls[1]!.prompt);
});

test("C14 a passing attempt 2 exits 0, renders attempt 2, and shows nothing from attempt 1", async () => {
  const dir = askProfile({ versionCaveat: CAVEAT });
  const result = await run(["ask", Q], dir, fakeQuery({ answer: LEAKY }, { answer: SECOND }).query);
  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.stdout, renderAnswer(SECOND, CAVEAT, "pt-BR"));
  for (const stream of [result.stdout, result.stderr]) assert.ok(!stream.includes("OrderService") && !stream.includes(LEAKY.answer));
});

test("C15 a failing attempt 2 exits 1 with the fallback and escalation text, no caveat, no answer text, and ids without matches on stderr", async () => {
  const dir = askProfile({ versionCaveat: CAVEAT });
  const result = await run(["ask", Q], dir, fakeQuery({ answer: LEAKY }, { answer: { ...LEAKY, answer: "Veja src/orders/cancel.ts." } }).query);
  assert.equal(result.code, 1);
  const [transcript] = transcriptsOf(dir);
  assert.equal(result.stdout, `${FALLBACK}\n\nTexto para encaminhar:\nPergunta: ${Q}\nRegistro: ${basename(transcript!)}\n`);
  assert.ok(!result.stdout.includes(CAVEAT));
  assert.match(result.stderr, /attempt 1: deterministic identifier; attempt 2: deterministic file-path/);
  for (const text of ["OrderService", "src/orders", "Depende do tipo", "Cartão tipo"]) assert.ok(!result.stdout.includes(text) && !result.stderr.includes(text), text);
});

test("C15 a judge rejection on attempt 2 names the judge's verdict, not its reason", async () => {
  const fake = fakeQuery({}, { answer: SECOND }).judge(judgeFails("cita a tabela PEDIDOS_FATURADOS"));
  const result = await run(["ask", Q], askProfile(), fake.query);
  assert.equal(result.code, 1);
  assert.match(result.stderr, /attempt 1: judge revealsImplementation; attempt 2: judge revealsImplementation/);
  assert.ok(!result.stderr.includes("PEDIDOS_FATURADOS"));
});

test("C15 a regeneration that ends in an agent error also ends in the fallback", async () => {
  const errors: [FakeScenario, RegExp][] = [
    [{ result: { subtype: "error_max_turns", is_error: true } }, /attempt 2: the agent stopped: error_max_turns/],
    [{ hang: true }, /attempt 2: timed out after 1 s/],
    [{ answer: { answer: "só texto" } }, /attempt 2: the answer did not match the expected schema/],
    [{ result: { is_error: true, api_error_status: 529, result: "Overloaded" } }, /attempt 2: API error 529/],
  ];
  for (const [second, message] of errors) {
    const result = await run(["ask", Q], askProfile(), fakeQuery({ answer: LEAKY }, second).query, { timeoutMs: 600 });
    assert.equal(result.code, 1, String(message));
    assert.ok(result.stdout.startsWith(FALLBACK), String(message));
    assert.match(result.stderr, message);
  }
});

test("C16 a validator without a verdict goes straight to the fallback, naming it, with no regeneration", async () => {
  const scanners: [typeof STUB_SCANNER, RegExp][] = [
    [{ command: "veteran-no-such-gitleaks" }, /gitleaks gave no verdict \(gitleaks not found on PATH\)/],
    [{ command: process.execPath, prefixArgs: ["-e", "process.exit(3)"] }, /gitleaks gave no verdict \(gitleaks exited 3/],
    [{ command: process.execPath, prefixArgs: ["-e", "process.exit(0)"] }, /gitleaks gave no verdict \(gitleaks did not detect the canary secret\)/],
  ];
  for (const [scanner, message] of scanners) {
    const fake = fakeQuery({});
    const result = await run(["ask", Q], askProfile(), fake.query, { scanner });
    assert.equal(result.code, 1, String(message));
    assert.ok(result.stdout.startsWith(FALLBACK), String(message));
    assert.match(result.stderr, message);
    assert.equal(fake.calls.length, 1, "no regeneration");
    assert.equal(fake.judgeCalls.length, 0);
  }
  const judges: [FakeScenario, RegExp][] = [
    [{ result: { subtype: "error_during_execution", is_error: true } }, /validation judge gave no verdict \(judge stopped: error_during_execution\)/],
    [{ hangIgnoringAbort: true }, /validation judge gave no verdict \(judge timed out\)/],
    [{ answer: { verdict: "ok" } }, /validation judge gave no verdict \(judge verdict did not match the schema\)/],
  ];
  for (const [judge, message] of judges) {
    const fake = fakeQuery({}).judge(judge);
    const started = Date.now();
    const result = await run(["ask", Q], askProfile(), fake.query, { timeoutMs: 800 });
    assert.equal(result.code, 1, String(message));
    assert.ok(result.stdout.startsWith(FALLBACK), String(message));
    assert.match(result.stderr, message);
    assert.equal(fake.calls.length, 1, "no regeneration");
    assert.ok(Date.now() - started < 10_000);
  }
});

test("C16 the real gitleaks gives a verdict on a clean answer", { timeout: 120_000 }, async () => {
  const result = await run(["ask", Q], askProfile(), fakeQuery({}).query, { scanner: { command: "gitleaks" } });
  assert.equal(result.code, 0, result.stderr);
});

test("C17 AskResult.answer is set only when the same attempt passed both stages", async () => {
  const profile = loadProfile(askProfile());
  const paths: [string, FakeScenario[], FakeScenario[] | undefined, unknown][] = [
    ["pass on attempt 1", [{}], undefined, ANSWER],
    ["pass on attempt 2", [{ answer: LEAKY }, { answer: SECOND }], undefined, SECOND],
    ["both attempts fail", [{ answer: LEAKY }, { answer: LEAKY }], undefined, null],
    ["judge rejects both", [{}, { answer: SECOND }], [judgeFails("x")], null],
    ["judge without a verdict", [{}], [{ answer: {} }], null],
    ["regeneration errors", [{ answer: LEAKY }, { result: { subtype: "error_max_turns", is_error: true } }], undefined, null],
    ["agent error on attempt 1", [{ result: { subtype: "error_max_turns", is_error: true } }], undefined, null],
  ];
  for (const [name, scenarios, judge, expected] of paths) {
    const fake = fakeQuery(...scenarios);
    if (judge) fake.judge(...judge);
    const result = await ask(profile, Q, { query: fake.query, env: {}, scanner: STUB_SCANNER });
    assert.deepEqual(result.answer, expected, name);
    assert.equal(result.ok, expected !== null, name);
  }
});

test("C18 an agent error on attempt 1 keeps block 3's behaviour: exit 1, no judge, no regeneration, no fallback", async () => {
  const errors: [FakeScenario, RegExp][] = [
    [{ result: { subtype: "error_max_turns", is_error: true } }, /the agent stopped: error_max_turns/],
    [{ hang: true }, /timed out after 1 s/],
    [{ answer: { answer: "só texto" } }, /did not match the expected schema/],
    [{ result: { is_error: true, api_error_status: 529, result: "Overloaded" } }, /API error 529/],
  ];
  for (const [scenario, message] of errors) {
    const fake = fakeQuery(scenario);
    const result = await run(["ask", Q], askProfile(), fake.query, { timeoutMs: 600 });
    assert.equal(result.code, 1, String(message));
    assert.equal(result.stdout, "", String(message));
    assert.match(result.stderr, message);
    assert.equal(fake.calls.length, 1, String(message));
    assert.equal(fake.judgeCalls.length, 0, String(message));
  }
});

test("C19 the summary records every stage, attempts, fallback, the delivered answer and the summed cost; both attempts' messages are in the file", async () => {
  const dir = askProfile();
  const extra = { type: "assistant", message: { content: [{ type: "text", text: "procurando" }] }, session_id: "sess-A" };
  const fake = fakeQuery(
    { answer: LEAKY, init: { session_id: "sess-A" }, messages: [extra], result: { total_cost_usd: 0.1, duration_ms: 3000 } },
    { answer: SECOND, init: { session_id: "sess-A" }, result: { total_cost_usd: 0.1, duration_ms: 2000 } },
  ).judge({ answer: { revealsImplementation: false, reason: "só termos de negócio" }, result: { total_cost_usd: 0.02, duration_ms: 500 } });
  const result = await run(["ask", Q], dir, fake.query);
  assert.equal(result.code, 0, result.stderr);
  const lines = readTranscript(transcriptsOf(dir)[0]!);
  assert.deepEqual(
    lines.map((line) => (line.type === "system" ? `system:${line.subtype}` : line.type)),
    ["system:init", "assistant", "result", "system:init", "result", "summary"],
  );
  assert.equal((lines[2]!.structured_output as { answer: string }).answer, LEAKY.answer);
  assert.equal((lines[4]!.structured_output as { answer: string }).answer, SECOND.answer);
  const summary = lines.at(-1)!;
  assert.deepEqual(summary.validation, [
    { attempt: 1, stage: "deterministic", pass: false, findings: [{ field: "answer", rule: "identifier", match: "OrderService.Cancel" }], costUsd: 0 },
    { attempt: 2, stage: "deterministic", pass: true, findings: [], costUsd: 0 },
    { attempt: 2, stage: "judge", pass: true, reason: "só termos de negócio", costUsd: 0.02 },
  ]);
  assert.equal(summary.attempts, 2);
  assert.equal(summary.fallback, false);
  assert.deepEqual(summary.answer, SECOND);
  assert.equal(summary.total_cost_usd, 0.22);
  assert.equal(summary.duration_ms, 5500);
  assert.equal(summary.sessionId, "sess-A");
});

test("C19 a fallback's summary has fallback true, answer null, and a no-verdict stage carries its error", async () => {
  const dir = askProfile();
  await run(["ask", Q], dir, fakeQuery({}).query, { scanner: { command: "veteran-no-such-gitleaks" } });
  const summary = readTranscript(transcriptsOf(dir)[0]!).at(-1)!;
  assert.equal(summary.fallback, true);
  assert.equal(summary.answer, null);
  assert.equal(summary.attempts, 1);
  const [entry] = summary.validation as { stage: string; pass: boolean; error?: string }[];
  assert.equal(entry!.stage, "deterministic");
  assert.equal(entry!.pass, false);
  assert.match(entry!.error!, /gitleaks not found on PATH/);
});

test("C20 stderr's last line carries the summed cost", async () => {
  const dir = askProfile();
  const fake = fakeQuery({ answer: LEAKY, result: { total_cost_usd: 0.1, duration_ms: 3000 } }, { answer: SECOND, result: { total_cost_usd: 0.1, duration_ms: 2000 } }).judge({
    answer: { revealsImplementation: false, reason: "ok" },
    result: { total_cost_usd: 0.02, duration_ms: 500 },
  });
  const result = await run(["ask", Q], dir, fake.query);
  assert.equal(result.stderr.trimEnd().split("\n").at(-1), `transcript: ${transcriptsOf(dir)[0]} · cost: $0.2200 (estimated) · 5.5 s`);
});

test("C23 the veteran process exits within 5 s of its last stderr line even when the SDK ignores the abort", { timeout: 60_000 }, async () => {
  const dir = tempDir("stuck-sdk");
  const script = join(dir, "stuck.mjs");
  writeFileSync(
    script,
    `import { main } from ${JSON.stringify(pathToFileURL(join(ROOT, "src", "main.ts")).href)};
// Stands in for an SDK child that ignores the abort: it never yields and keeps the event loop alive.
const query = () => (async function* () { setInterval(() => {}, 1000); await new Promise(() => {}); })();
await main(["ask", "pergunta"], query, { timeoutMs: 500 });
`,
  );
  const child = spawn(process.execPath, [script], { env: { ...process.env, VETERAN_PROFILE_DIR: askProfile() }, stdio: ["ignore", "pipe", "pipe"] });
  let stderr = "";
  let lastLineAt = 0;
  child.stderr.on("data", (chunk: Buffer) => {
    stderr += chunk.toString("utf8");
    if (/transcript: .* s\n$/.test(stderr)) lastLineAt = Date.now();
  });
  const code = await new Promise<number | null>((resolve) => {
    const kill = setTimeout(() => child.kill(), 30_000);
    child.on("close", (exitCode) => {
      clearTimeout(kill);
      resolve(exitCode);
    });
  });
  assert.equal(code, 1, stderr);
  assert.match(stderr, /timed out after 1 s/);
  assert.ok(lastLineAt > 0, stderr);
  assert.ok(Date.now() - lastLineAt < 5000, `exited ${Date.now() - lastLineAt} ms after the last line`);
});

test("C24 ask stops reading at the result message instead of waiting for the stream to end", async () => {
  const fake = fakeQuery({ hangAfterResult: true });
  const started = Date.now();
  const result = await run(["ask", Q], askProfile(), fake.query, { timeoutMs: 60_000 });
  assert.equal(result.code, 0, result.stderr);
  assert.ok(Date.now() - started < 10_000, `${Date.now() - started} ms`);
  assert.equal(fake.calls[0]!.options.abortController?.signal.aborted, true, "the stalled stream is closed");
});

test("C11 the agent and the judge switch off claude.ai connectors and load only the MCP servers they pass", async () => {
  const fake = fakeQuery({});
  await run(["ask", Q], askProfile(), fake.query);
  for (const call of [fake.calls[0]!, fake.judgeCalls[0]!]) {
    assert.equal(call.options.strictMcpConfig, true, String(call.options.model));
    assert.equal(call.options.env?.ENABLE_CLAUDEAI_MCP_SERVERS, "false", String(call.options.model));
  }
});

test("C19 a judge whose SDK child still holds its working directory does not stop the answer or the summary", { timeout: 60_000 }, async () => {
  const dir = askProfile();
  // Holds the judge's cwd open past the result, like the real SDK child does on Windows.
  const holder: { child?: ReturnType<typeof spawn> } = {};
  const fake = fakeQuery({}).judge({
    answer: { revealsImplementation: false, reason: "ok" },
    result: { total_cost_usd: 0, duration_ms: 0 },
    during: async (options) => {
      holder.child = spawn(process.execPath, ["-e", "setTimeout(() => {}, 4000)"], { cwd: options.cwd, stdio: "ignore" });
      await new Promise((resolve) => setTimeout(resolve, 200));
    },
  });
  try {
    const result = await run(["ask", Q], dir, fake.query);
    assert.equal(result.code, 0, result.stderr);
    assert.equal(readTranscript(transcriptsOf(dir)[0]!).at(-1)!.type, "summary");
  } finally {
    holder.child?.kill();
  }
});
