import assert from "node:assert/strict";
import { randomInt } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import type { VeteranAnswer } from "../src/agent/answerSchema.ts";
import { loadProfile } from "../src/profile/loadProfile.ts";
import { deterministicFindings, type Rule } from "../src/validate/deterministic.ts";
import { secretFindings } from "../src/validate/secrets.ts";
import { askProfile, fakeQuery, run } from "./fakes.ts";
import { fakeSecret, makeProfile, tempDir } from "./helpers.ts";

const CLEAN: VeteranAnswer = {
  answer: "Depende do tipo do pedido.",
  branches: [{ condition: "Pedido do tipo A", behavior: "não é cancelado" }],
  suggestedTests: ["Cancelar um pedido do tipo A"],
  clarifyingQuestion: "Qual é o tipo do pedido?",
  confidence: "high",
  dependsOn: ["O tipo cadastrado"],
  caveats: ["Pedidos antigos podem não ter tipo"],
  internalReferences: [],
};

/** CLEAN with `text` appended to the answer. */
const inAnswer = (text: string): VeteranAnswer => ({ ...CLEAN, answer: `${CLEAN.answer} ${text}` });

function rulesOf(text: string, denyTerms: string[] = []): Rule[] {
  return deterministicFindings(inAnswer(text), denyTerms).map((finding) => finding.rule);
}

function assertFlags(rule: Rule, flagged: string[], passing: string[]) {
  for (const text of flagged) {
    const findings = deterministicFindings(inAnswer(text), []);
    assert.ok(findings.some((finding) => finding.rule === rule && finding.field === "answer"), `${JSON.stringify(text)} should be flagged as ${rule}: ${JSON.stringify(findings)}`);
  }
  for (const text of passing) assert.deepEqual(rulesOf(text), [], `${JSON.stringify(text)} should pass`);
}

test("C1 every user-facing field is checked and named; internalReferences is not", () => {
  const leak = "Veja src/app.ts";
  const placements: [string, (answer: VeteranAnswer) => VeteranAnswer][] = [
    ["answer", (a) => ({ ...a, answer: leak })],
    ["branches[1].condition", (a) => ({ ...a, branches: [...a.branches, { condition: leak, behavior: "ok" }] })],
    ["branches[1].behavior", (a) => ({ ...a, branches: [...a.branches, { condition: "ok", behavior: leak }] })],
    ["suggestedTests[1]", (a) => ({ ...a, suggestedTests: [...a.suggestedTests, leak] })],
    ["clarifyingQuestion", (a) => ({ ...a, clarifyingQuestion: leak })],
    ["dependsOn[1]", (a) => ({ ...a, dependsOn: [...a.dependsOn, leak] })],
    ["caveats[1]", (a) => ({ ...a, caveats: [...a.caveats, leak] })],
  ];
  for (const [field, place] of placements) {
    assert.deepEqual(deterministicFindings(place(CLEAN), []), [{ field, rule: "file-path", match: "src/app.ts" }], field);
  }
  assert.deepEqual(deterministicFindings({ ...CLEAN, internalReferences: ["src/app.ts", "OrderService.Cancel()"] }, ["Order"]), []);
  assert.deepEqual(deterministicFindings({ ...CLEAN, clarifyingQuestion: null }, []), []);
});

test("C1 the profile's versionCaveat is never checked", async () => {
  const dir = askProfile({ versionCaveat: "Versão atual; veja src/app.ts para detalhes." });
  const result = await run(["ask", "pergunta"], dir, fakeQuery({}).query);
  assert.equal(result.code, 0, result.stderr);
  assert.ok(result.stdout.trimEnd().endsWith("Versão atual; veja src/app.ts para detalhes."));
});

test("C2 a backtick, fenced or inline, fails with rule code", () => {
  assertFlags("code", ["```\nselect 1\n```", "use `cancelar`"], ["sem crase nenhuma"]);
});

test("C3 file paths fail with rule file-path; dates, money and versions pass", () => {
  assertFlags("file-path", ["src/agent/ask.ts", "C:\\app\\web.config", "Program.cs", "appsettings.json"], ["e/ou", "24/12/2026", "R$ 1.234,56", "versão 3.5"]);
});

test("C4 identifiers with a dot or parentheses fail with rule identifier; plural marks and names pass", () => {
  assertFlags("identifier", ["OrderService.Cancel", "order_type.id", "cancel()", "Order.Return(x)"], ["cartão(s)", "cliente(a)", "Sr. Silva", "WhatsApp", "e-mail"]);
});

test("C5 SQL statement shapes fail with rule sql; ordinary words pass", () => {
  assertFlags("sql", ["SELECT nome FROM clientes", "update pedido set ativo = 0", "insert into pedidos", "delete from pedidos", "join itens on pedido"], ["o update do app saiu ontem", "selecione o cliente"]);
});

test("C6 stack-trace shapes fail with rule stack-trace; a plain error message passes", () => {
  assertFlags(
    "stack-trace",
    ["   at Billing.Order.Return() in C:\\src\\Order.cs:line 42", "System.NullReferenceException", "TypeError: x is undefined", "Traceback (most recent call last)"],
    ["deu erro ao salvar"],
  );
});

function awsKey(): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let key = "AKIA";
  for (let i = 0; i < 16; i++) key += alphabet[randomInt(alphabet.length)];
  return key;
}

test("C7 gitleaks flags a GitHub token and an AWS key with rule secret, in the field that holds them", { timeout: 120_000 }, async () => {
  const fields = [
    { field: "answer", text: "Tudo certo por aqui." },
    { field: "caveats[0]", text: `use o token ${fakeSecret()}` },
    { field: "dependsOn[0]", text: `chave ${awsKey()} do ambiente` },
  ];
  const findings = await secretFindings(fields);
  assert.deepEqual(findings.map((finding) => [finding.field, finding.rule]).sort(), [["caveats[0]", "secret"], ["dependsOn[0]", "secret"]]);
  for (const finding of findings) assert.ok(!finding.match.includes("ghp_") && !finding.match.includes("AKIA"), "findings stay redacted");
  assert.deepEqual(await secretFindings([{ field: "answer", text: "Nenhum segredo aqui." }]), []);
});

test("C7 the scan runs gitleaks stdin with Veteran's config, an empty ignore dir, allow comments ignored, redaction, a JSON report and GITLEAKS_* stripped", async () => {
  const dir = tempDir("recording-gitleaks");
  const log = join(dir, "call.json");
  const script = join(dir, "record.mjs");
  writeFileSync(
    script,
    `import { readFileSync, readdirSync, writeFileSync } from "node:fs";
const args = process.argv.slice(2);
const input = readFileSync(0, "utf8");
const ignore = args[args.indexOf("--gitleaks-ignore-path") + 1];
writeFileSync(${JSON.stringify(log)}, JSON.stringify({ args, cwd: process.cwd(), input, ignoreEntries: readdirSync(ignore), env: Object.keys(process.env).filter((k) => k.toUpperCase().startsWith("GITLEAKS_")) }));
const lines = input.split("\\n");
const canary = lines.findLastIndex((line) => line.startsWith('token = "ghp_'));
writeFileSync(args[args.indexOf("--report-path") + 1], JSON.stringify([{ RuleID: "github-pat", StartLine: canary + 1, Match: "REDACTED" }]));
process.exit(42);
`,
  );
  process.env.GITLEAKS_CONFIG = "/tmp/evil.toml";
  try {
    await secretFindings([{ field: "answer", text: "linha um\nlinha dois" }], { command: process.execPath, prefixArgs: [script] });
  } finally {
    delete process.env.GITLEAKS_CONFIG;
  }
  const call = JSON.parse(readFileSync(log, "utf8")) as { args: string[]; cwd: string; input: string; ignoreEntries: string[]; env: string[] };
  assert.equal(call.args[0], "stdin");
  const value = (flag: string) => call.args[call.args.indexOf(flag) + 1];
  assert.equal(value("--config"), join(process.cwd(), "config", "gitleaks.toml"));
  assert.deepEqual(call.ignoreEntries, []);
  assert.ok(!value("--gitleaks-ignore-path")!.startsWith(process.cwd()), "the ignore dir is a temp dir");
  for (const flag of ["--ignore-gitleaks-allow", "--redact", "--no-banner"]) assert.ok(call.args.includes(flag), flag);
  assert.equal(value("--report-format"), "json");
  assert.equal(value("--exit-code"), "42");
  assert.deepEqual(call.env, []);
  assert.match(call.input, /^linha um\nlinha dois\ntoken = "ghp_[A-Za-z0-9]{36}"\n$/);
});

test("C8 a deny term matches case-insensitively as a substring", () => {
  assert.deepEqual(rulesOf("Salvo no Config-Store do app", ["config-store"]), ["deny-term"]);
  assert.equal(deterministicFindings(inAnswer("Salvo no Config-Store"), ["config-store"])[0]!.match, "Config-Store");
  assert.deepEqual(rulesOf("Abra a configuração", ["config-store"]), []);
});

test("C9 an email address fails with rule email", () => {
  assertFlags("email", ["fale com fulano@empresa.com.br"], ["use o @ do teclado"]);
});

test("C10 an empty or blank denyTerms entry fails the profile load, with every other error", () => {
  const dir = makeProfile(tempDir("repo-unused"), { denyTerms: ["ok", "", "   "], versionCaveat: "" });
  assert.throws(
    () => loadProfile(dir),
    (error: Error) =>
      /denyTerms\[1\]: empty term/.test(error.message) && /denyTerms\[2\]: empty term/.test(error.message) && /versionCaveat: expected a non-empty string/.test(error.message),
  );
  assert.equal(loadProfile(makeProfile(tempDir("repo-unused"), { denyTerms: ["config-store"] })).denyTerms[0], "config-store");
});
