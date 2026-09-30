import assert from "node:assert/strict";
import { readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { makeProfile, makeRepo, runCli, tempDir, writeProfileYaml } from "./helpers.ts";

const FIELDS = ["name", "repoPath", "ref", "language", "instructions", "excludePaths", "denyTerms", "versionCaveat"];

test("C1 unset or empty VETERAN_PROFILE_DIR exits non-zero naming the variable and creates nothing", () => {
  for (const value of [undefined, ""]) {
    const cwd = tempDir("cwd");
    const result = runCli(value, { cwd });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /VETERAN_PROFILE_DIR/);
    assert.deepEqual(readdirSync(cwd), []);
  }
});

test("C2 missing profile.yaml exits non-zero with its absolute path", () => {
  const dir = tempDir("empty-profile");
  const result = runCli(dir);
  assert.notEqual(result.status, 0);
  assert.ok(result.stderr.includes(join(dir, "profile.yaml")), result.stderr);
});

test("C3 invalid YAML exits non-zero with the profile's absolute path", () => {
  const dir = tempDir("bad-yaml");
  writeFileSync(join(dir, "profile.yaml"), "name: [unclosed\n  - : :\n");
  const result = runCli(dir);
  assert.notEqual(result.status, 0);
  assert.ok(result.stderr.includes(join(dir, "profile.yaml")), result.stderr);
  assert.match(result.stderr, /Invalid YAML/);
});

test("C4 a profile missing all 8 fields names every one of them before running git", () => {
  const dir = tempDir("no-fields");
  writeFileSync(join(dir, "profile.yaml"), "unrelated: true\n");
  const result = runCli(dir, { env: { PATH: "", Path: "" } });
  assert.notEqual(result.status, 0);
  for (const field of FIELDS) assert.match(result.stderr, new RegExp(`- ${field}: missing`), field);
  assert.doesNotMatch(result.stderr, /git/i);
});

test("C5 wrongly-typed fields are named", () => {
  const repo = makeRepo({ "a.txt": "a" });
  const dir = makeProfile(repo, { name: ["list"], excludePaths: "config", denyTerms: ["ok", 3] });
  const result = runCli(dir);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /- name: expected a non-empty string/);
  assert.match(result.stderr, /- excludePaths: expected a list of strings/);
  assert.match(result.stderr, /- denyTerms: expected a list of strings/);
});

test("C7 instructions resolve against the profile directory; a missing entry is named", () => {
  const repo = makeRepo({ "a.txt": "a" });
  const dir = makeProfile(repo, { instructions: ["overview.md", "missing.md"] });
  const result = runCli(dir, { cwd: tempDir("elsewhere") });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /instructions\[1\] "missing\.md": file not found/);
  assert.doesNotMatch(result.stderr, /instructions\[0\]/);
});

test("C10 an excludePaths entry starting with ! is rejected by name", () => {
  const repo = makeRepo({ "a.txt": "a" });
  const dir = makeProfile(repo, { excludePaths: ["config/**", "!config/public.json"] });
  const result = runCli(dir);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /excludePaths\[1\] "!config\/public\.json": negation is not supported/);
});

test("excludePaths entries that could silently match nothing are rejected", () => {
  const repo = makeRepo({ "a.txt": "a" });
  for (const pattern of ["/config", "./config", "config\\app", " "]) {
    const dir = tempDir("pattern");
    writeFileSync(join(dir, "overview.md"), "x");
    writeProfileYaml(dir, {
      name: "t", repoPath: repo, ref: "main", language: "pt-BR", instructions: ["overview.md"],
      excludePaths: [pattern], denyTerms: [], versionCaveat: "v",
    });
    const result = runCli(dir);
    assert.notEqual(result.status, 0, pattern);
    assert.match(result.stderr, /excludePaths\[0\]/, pattern);
  }
});
