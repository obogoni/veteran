import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { test } from "node:test";
import { ANSWER_SCHEMA } from "../src/agent/answerSchema.ts";
import { DISABLED_PLUGINS } from "../src/agent/sdk.ts";
import { ANSWER, askProfile, fakeQuery, readTranscript, run, transcriptsOf } from "./fakes.ts";

const Q = "A devolução do cartão desativa o cartão?";

test("C1 success prints answer, branches, tests, dependsOn, caveats, then versionCaveat, and exits 0", async () => {
  const dir = askProfile({ versionCaveat: "Comportamento da versão atual (main)." });
  const fake = fakeQuery({});
  const result = await run(["ask", Q], dir, fake.query);
  assert.equal(result.code, 0, result.stderr);
  const expected = [
    "Depende do tipo do cartão.",
    "Depende do caso:\n- Cartão tipo A: não é desativado\n- Cartão tipo B: é desativado",
    "Cenários para testar:\n- Devolver um cartão tipo A e conferir que continua ativo",
    "Depende de:\n- O tipo cadastrado para o cartão",
    "Observações:\n- Cartões antigos podem não ter tipo",
    "Comportamento da versão atual (main).",
  ].join("\n\n");
  assert.equal(result.stdout, `${expected}\n`);
});

test("C1 an empty list prints no heading", async () => {
  const dir = askProfile();
  const answer = { ...ANSWER, branches: [], suggestedTests: [], dependsOn: [], caveats: [] };
  const result = await run(["ask", Q], dir, fakeQuery({ answer }).query);
  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.stdout, "Depende do tipo do cartão.\n\nComportamento da versão atual.\n");
  for (const heading of ["Depende do caso:", "Cenários para testar:", "Depende de:", "Observações:"]) {
    assert.ok(!result.stdout.includes(heading), heading);
  }
});

test("C2 a clarifying question prints first, before the answer", async () => {
  const dir = askProfile();
  const answer = { ...ANSWER, clarifyingQuestion: "Qual é o tipo do cartão?" };
  const result = await run(["ask", Q], dir, fakeQuery({ answer }).query);
  assert.equal(result.code, 0, result.stderr);
  assert.ok(result.stdout.startsWith("Pergunta para você:\nQual é o tipo do cartão?\n\nDepende do tipo do cartão."), result.stdout);
});

test("C3 internalReferences never reaches stdout or stderr, only the transcript", async () => {
  const dir = askProfile();
  const result = await run(["ask", Q], dir, fakeQuery({}).query);
  assert.equal(result.code, 0, result.stderr);
  assert.ok(!result.stdout.includes("INTERNAL-REF"), "stdout");
  assert.ok(!result.stderr.includes("INTERNAL-REF"), "stderr");
  const [transcript] = transcriptsOf(dir);
  assert.ok(readFileSync(transcript!, "utf8").includes("INTERNAL-REF-CardService.cs:42"));
});

test("C4 missing or off-schema structured_output exits 1 with a schema message and prints no answer", async () => {
  const offSchema = [undefined, { ...ANSWER, confidence: "certain" }, { ...ANSWER, extra: 1 }, { answer: "só texto" }, "texto livre"];
  for (const answer of offSchema) {
    const dir = askProfile();
    const result = await run(["ask", Q], dir, fakeQuery({ answer }).query);
    assert.equal(result.code, 1, JSON.stringify(answer));
    assert.match(result.stderr, /did not match the expected schema/);
    assert.equal(result.stdout, "");
    assert.ok(!result.stderr.includes("Depende do tipo"), "no answer text on stderr");
  }
});

test("C5 no question, an empty question or extra arguments exit 1 with usage and start no agent", async () => {
  for (const argv of [["ask"], ["ask", ""], ["ask", "   "], ["ask", "uma", "duas"]]) {
    const dir = askProfile();
    const fake = fakeQuery({});
    const result = await run(argv, dir, fake.query);
    assert.equal(result.code, 1, argv.join(" "));
    assert.match(result.stderr, /usage: veteran snapshot \| veteran ask "<question>" \| veteran eval/);
    assert.equal(fake.calls.length, 0);
  }
});

test("C6 a missing snapshot exits 1 telling to run veteran snapshot, and starts no agent", async () => {
  const dir = askProfile({ snapshot: false });
  const fake = fakeQuery({});
  const result = await run(["ask", Q], dir, fake.query);
  assert.equal(result.code, 1);
  assert.match(result.stderr, /run `veteran snapshot` first/);
  assert.ok(result.stderr.includes(join(dir, "snapshot")));
  assert.equal(fake.calls.length, 0);
});

test("C6 an unsupported profile language exits 1 naming it, and starts no agent", async () => {
  const dir = askProfile({ language: "en-US" });
  const fake = fakeQuery({});
  const result = await run(["ask", Q], dir, fake.query);
  assert.equal(result.code, 1);
  assert.match(result.stderr, /"en-US" is not supported/);
  assert.equal(fake.calls.length, 0);
});

test("C7 the query carries the decided isolation options", async () => {
  const dir = askProfile();
  const fake = fakeQuery({});
  await run(["ask", Q], dir, fake.query);
  const options = fake.calls[0]!.options;
  assert.equal(options.model, "claude-opus-5-5");
  assert.deepEqual(options.tools, ["Read", "Grep", "Glob"]);
  assert.deepEqual(options.allowedTools, ["Read", "Grep", "Glob"]);
  assert.deepEqual(options.disallowedTools, ["Bash", "Write", "Edit", "WebFetch", "WebSearch"]);
  assert.equal(options.permissionMode, "dontAsk");
  assert.equal(options.cwd, join(dir, "snapshot"));
  assert.deepEqual(options.outputFormat, { type: "json_schema", schema: ANSWER_SCHEMA });
  assert.equal(options.hooks?.PreToolUse?.length, 1);
});

test("C7 an init with an unexpected tool, MCP server or other cwd aborts with exit 1 naming it", async () => {
  const cases: [Record<string, unknown>, RegExp][] = [
    [{ tools: ["Read", "Grep", "Glob", "StructuredOutput", "Bash"] }, /unexpected tool set \[Bash, Glob, Grep, Read, StructuredOutput\]/],
    [{ mcp_servers: [{ name: "linear", status: "connected" }] }, /unexpected MCP servers: linear/],
  ];
  for (const [init, message] of cases) {
    const dir = askProfile();
    const result = await run(["ask", Q], dir, fakeQuery({ init }).query);
    assert.equal(result.code, 1);
    assert.match(result.stderr, message);
    assert.match(result.stderr, /not isolated/);
    assert.equal(result.stdout, "");
  }
});

test("C10 the query loads no settings, uses Veteran's own prompt and switches the built-in plugins off", async () => {
  const dir = askProfile();
  writeFileSync(join(dir, "overview.md"), "# Overview\nMARKER-FROM-PROFILE-INSTRUCTIONS\n");
  const fake = fakeQuery({});
  await run(["ask", Q], dir, fake.query);
  const options = fake.calls[0]!.options;
  assert.deepEqual(options.settingSources, []);
  assert.equal(typeof options.systemPrompt, "string");
  assert.match(options.systemPrompt as string, /^You are Veteran/);
  assert.match(options.systemPrompt as string, /Write every user-facing field in pt-BR/);
  assert.match(options.systemPrompt as string, /## Project instructions\n\n# Overview\nMARKER-FROM-PROFILE-INSTRUCTIONS/);
  assert.deepEqual((options.settings as { enabledPlugins: unknown }).enabledPlugins, DISABLED_PLUGINS);
  assert.equal(options.env?.CLAUDE_CODE_DISABLE_BUNDLED_SKILLS, "1");
});

test("C10 an init that lists any plugin aborts with exit 1", async () => {
  const dir = askProfile();
  const init = { plugins: [{ name: "cc-plugin-agents-md", path: "builtin" }] };
  const result = await run(["ask", Q], dir, fakeQuery({ init }).query);
  assert.equal(result.code, 1);
  assert.match(result.stderr, /unexpected plugins loaded: cc-plugin-agents-md/);
  assert.equal(result.stdout, "");
});

test("C11 every error subtype and an API error exit 1 naming the subtype or status", async () => {
  for (const subtype of ["error_max_turns", "error_max_budget_usd", "error_max_structured_output_retries", "error_during_execution"]) {
    const dir = askProfile();
    const result = await run(["ask", Q], dir, fakeQuery({ result: { subtype, is_error: true } }).query);
    assert.equal(result.code, 1, subtype);
    assert.match(result.stderr, new RegExp(`the agent stopped: ${subtype}`));
    assert.equal(result.stdout, "");
  }
  const dir = askProfile();
  const result = await run(["ask", Q], dir, fakeQuery({ result: { is_error: true, api_error_status: 529, result: "Overloaded" } }).query);
  assert.equal(result.code, 1);
  assert.match(result.stderr, /API error 529: Overloaded/);
});

test("C12 no result before the timeout aborts the run, exits 1 and reports the timeout", async () => {
  const dir = askProfile();
  const fake = fakeQuery({ hang: true });
  const started = Date.now();
  const result = await run(["ask", Q], dir, fake.query, { timeoutMs: 1000 });
  assert.equal(result.code, 1);
  assert.match(result.stderr, /timed out after 1 s/);
  assert.ok(Date.now() - started < 5000);
  assert.equal(fake.calls[0]!.options.abortController?.signal.aborted, true);
});

test("C12 the default timeout is 300 s", async () => {
  const { TIMEOUT_MS } = await import("../src/agent/ask.ts");
  assert.equal(TIMEOUT_MS, 300_000);
});

test("C13 the query runs with maxTurns 40 and maxBudgetUsd 1, and the summary records both", async () => {
  const dir = askProfile();
  const fake = fakeQuery({});
  await run(["ask", Q], dir, fake.query);
  assert.equal(fake.calls[0]!.options.maxTurns, 40);
  assert.equal(fake.calls[0]!.options.maxBudgetUsd, 1);
  const summary = readTranscript(transcriptsOf(dir)[0]!).at(-1)!;
  assert.equal(summary.maxTurns, 40);
  assert.equal(summary.maxBudgetUsd, 1);
});

test("C14 success, a limit and a timeout each leave one transcript with every message and a final summary", async () => {
  const extra = { type: "assistant", message: { content: [{ type: "text", text: "procurando" }] }, session_id: "sess-1" };
  const scenarios = [
    { name: "success", scenario: { messages: [extra] }, timeoutMs: undefined, subtype: "success" },
    { name: "limit", scenario: { messages: [extra], result: { subtype: "error_max_turns", is_error: true } }, timeoutMs: undefined, subtype: "error_max_turns" },
    { name: "timeout", scenario: { messages: [extra], hang: true }, timeoutMs: 500, subtype: "aborted" },
  ];
  for (const { name, scenario, timeoutMs, subtype } of scenarios) {
    const dir = askProfile();
    await run(["ask", Q], dir, fakeQuery(scenario).query, { timeoutMs });
    const files = transcriptsOf(dir);
    assert.equal(files.length, 1, name);
    assert.match(basename(files[0]!), /^\d{8}T\d{9}Z-[0-9a-f]{8}\.jsonl$/, name);
    const lines = readTranscript(files[0]!);
    assert.equal((lines[0] as { subtype?: string }).subtype, "init", name);
    assert.deepEqual(lines[1], extra, name);
    if (name !== "timeout") assert.equal(lines[2]!.type, "result", name);
    const summary = lines.at(-1)!;
    assert.equal(summary.type, "summary", name);
    for (const field of ["question", "sessionId", "subtype", "total_cost_usd", "duration_ms", "num_turns", "maxTurns", "maxBudgetUsd", "answer", "validation"]) {
      assert.ok(field in summary, `${name}: ${field}`);
    }
    assert.equal(summary.question, Q, name);
    assert.equal(summary.sessionId, "sess-1", name);
    assert.equal(summary.subtype, subtype, name);
    assert.deepEqual(summary.validation, [], name);
    if (name === "success") assert.deepEqual(summary.answer, ANSWER);
    else assert.equal(summary.answer, null, name);
  }
});

test("C15 stderr's last line carries the transcript path, the cost and the seconds", async () => {
  for (const scenario of [{}, { result: { subtype: "error_max_budget_usd", is_error: true } }]) {
    const dir = askProfile();
    const result = await run(["ask", Q], dir, fakeQuery(scenario).query);
    const last = result.stderr.trimEnd().split("\n").at(-1)!;
    const [transcript] = transcriptsOf(dir);
    assert.equal(last, `transcript: ${transcript} · cost: $0.1234 (estimated) · 4.2 s`);
    assert.ok(existsSync(transcript!));
  }
});

test("C23 the agent never receives an API key, token or base URL from the operator's env", async () => {
  const dir = askProfile();
  const fake = fakeQuery({});
  const env = { ANTHROPIC_API_KEY: "sk-ant-should-not-pass", ANTHROPIC_AUTH_TOKEN: "tok", ANTHROPIC_BASE_URL: "https://proxy.invalid", KEEP_ME: "1" };
  const result = await run(["ask", Q], dir, fake.query, { env });
  assert.equal(result.code, 0, result.stderr);
  const passed = fake.calls[0]!.options.env!;
  for (const key of ["ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "ANTHROPIC_BASE_URL"]) assert.ok(!(key in passed), key);
  assert.equal(passed.KEEP_ME, "1");
});

test("C23 an authentication failure adds the /login hint", async () => {
  const failures = [
    { result: { is_error: true, api_error_status: 401, result: "Invalid credentials" } },
    { result: { is_error: true, result: "Not logged in · Please run /login" } },
    { messages: [{ type: "system", subtype: "api_retry", error: "authentication_failed", attempt: 1 }], result: { subtype: "error_during_execution", is_error: true } },
  ];
  for (const scenario of failures) {
    const dir = askProfile();
    const result = await run(["ask", Q], dir, fakeQuery(scenario).query);
    assert.equal(result.code, 1);
    assert.match(result.stderr, /Claude Code must be logged in with the Enterprise account: run `claude`, then `\/login`\./);
  }
});
