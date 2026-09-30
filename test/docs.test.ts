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
