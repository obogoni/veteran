import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { ROOT } from "./helpers.ts";

test("C22 the READMEs document ask and eval, the Claude Code login, no API key and the estimated USD 1.00 cap", () => {
  const example = readFileSync(join(ROOT, "profiles", "example", "README.md"), "utf8");
  assert.match(example, /node src\/cli\.ts ask "/);
  assert.match(example, /node src\/cli\.ts eval/);

  const readme = readFileSync(join(ROOT, "README.md"), "utf8");
  assert.match(readme, /`veteran ask "<question>"`/);
  assert.match(readme, /`veteran eval`/);
  assert.match(readme, /Claude Code\]\([^)]+\) logged in on the machine \(`claude`, then `\/login`\) with the Enterprise account/);
  assert.match(readme, /never reads an API key/);
  assert.match(readme, /estimated USD 1\.00/);
  assert.match(readme, /counts against the account's plan usage/);
});

test("C26 the README, CLAUDE.md and the design doc describe output validation", () => {
  const readme = readFileSync(join(ROOT, "README.md"), "utf8");
  assert.match(readme, /\*\*Output validation\.\*\*/);
  assert.match(readme, /one regeneration/);
  assert.match(readme, /Não consegui responder isso com segurança\. Leve a pergunta para um desenvolvedor\./);
  assert.match(readme, /Texto para encaminhar:/);
  assert.match(readme, /leaks <l>\/<delivered>/);
  assert.match(readme, /for `snapshot` and also for `ask` and `eval`/);

  const claude = readFileSync(join(ROOT, "CLAUDE.md"), "utf8");
  assert.match(claude, /`src\/validate\/` checks every answer before anyone sees it/);
  for (const file of ["deterministic.ts", "secrets.ts", "judge.ts", "pipeline.ts"]) assert.ok(claude.includes(`\`${file}\``), file);

  const design = readFileSync(join(ROOT, ".design", "veteran.md"), "utf8");
  assert.match(design, /Secrets are found by `gitleaks stdin`/);
  assert.match(design, /The image ships `gitleaks`/);
  assert.match(design, /A check that cannot reach a verdict goes straight to the fallback/);
  assert.match(design, /when a check reaches no verdict, fixed fallback/);
});
