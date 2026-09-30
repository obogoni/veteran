import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { loadProfile } from "../src/profile/loadProfile.ts";
import { buildSnapshot } from "../src/snapshot/buildSnapshot.ts";
import { exists, fakeSecret, makeProfile, makeRepo, pathWithoutGitleaks, readTree, runCli, tempDir } from "./helpers.ts";

function leakyRepo(extra: Record<string, string> = {}) {
  const secret = fakeSecret();
  const repo = makeRepo({ "src/settings.ts": `export const token = "${secret}";\n`, "src/ok.ts": "export {};\n", ...extra });
  return { repo, secret };
}

/** A profile whose snapshot already holds a clean earlier run, then points at the leaky repo. */
function profileWithPreviousSnapshot(leakyRepoPath: string): { dir: string; before: ReturnType<typeof readTree> } {
  const clean = makeRepo({ "clean.txt": "clean" });
  const dir = makeProfile(clean);
  assert.equal(runCli(dir).status, 0);
  const yaml = readTree(dir).get("profile.yaml")!.toString();
  writeFileSync(join(dir, "profile.yaml"), yaml.replace(clean, leakyRepoPath));
  return { dir, before: readTree(join(dir, "snapshot")) };
}

test("C18 a secret in a non-excluded file aborts with its path and rule, value redacted", () => {
  const { repo, secret } = leakyRepo();
  const result = runCli(makeProfile(repo));
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /src\/settings\.ts:1 \(rule github-pat\)/);
  assert.ok(!result.stderr.includes(secret) && !result.stdout.includes(secret));
});

test("C19 after an abort the previous snapshot is intact, and absent when there was none", () => {
  const { repo } = leakyRepo();
  const fresh = makeProfile(repo);
  assert.notEqual(runCli(fresh).status, 0);
  assert.equal(exists(join(fresh, "snapshot")), false);

  const { dir, before } = profileWithPreviousSnapshot(repo);
  assert.notEqual(runCli(dir).status, 0);
  assert.deepEqual(readTree(join(dir, "snapshot")), before);
});

test("C20 a secret only in an excluded path exits 0", () => {
  const { repo } = leakyRepo();
  const result = runCli(makeProfile(repo, { excludePaths: ["src/settings.ts"] }));
  assert.equal(result.status, 0, result.stderr);
});

test("C21 a .gitleaks.toml in the tree cannot allowlist the secret", () => {
  const { repo } = leakyRepo({
    ".gitleaks.toml": "[extend]\nuseDefault = true\n[allowlist]\npaths = ['''.*''']\nregexes = ['''ghp_.*''']\n",
  });
  const result = runCli(makeProfile(repo));
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /src\/settings\.ts:1 \(rule github-pat\)/);
});

test("C22 a root .gitleaksignore in the tree cannot ignore the finding", () => {
  const fingerprints = ["src/settings.ts", "tree/src/settings.ts", "scan/tree/src/settings.ts"]
    .map((path) => `${path}:github-pat:1`)
    .join("\n");
  const { repo } = leakyRepo({ ".gitleaksignore": `${fingerprints}\n` });
  const result = runCli(makeProfile(repo));
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /src\/settings\.ts:1 \(rule github-pat\)/);
});

test("C23 a gitleaks:allow comment cannot silence the finding", () => {
  const secret = fakeSecret();
  const repo = makeRepo({ "src/settings.ts": `export const token = "${secret}"; // gitleaks:allow\n` });
  const result = runCli(makeProfile(repo));
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /src\/settings\.ts:1 \(rule github-pat\)/);
});

test("C24 without gitleaks on PATH the run aborts and the snapshot is unchanged", () => {
  const repo = makeRepo({ "a.txt": "a" });
  const { dir, before } = profileWithPreviousSnapshot(repo);
  const path = pathWithoutGitleaks();
  const result = runCli(dir, { env: { PATH: path, Path: path } });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /secret scan did not complete \(gitleaks not found on PATH\)/);
  assert.deepEqual(readTree(join(dir, "snapshot")), before);
});

test("C25 a scanner that errors, or exits 0 without the canary, aborts and leaves the snapshot unchanged", async () => {
  const repo = makeRepo({ "a.txt": "a" });
  const { dir, before } = profileWithPreviousSnapshot(repo);
  const profile = loadProfile(dir);
  const scripts = { error: "process.exit(1)", silent: "process.exit(0)", "leak-code without report": "process.exit(42)" };
  for (const [label, body] of Object.entries(scripts)) {
    const script = join(tempDir("fake-gitleaks"), "fake.mjs");
    writeFileSync(script, `${body}\n`);
    await assert.rejects(
      buildSnapshot(profile, { scanner: { command: process.execPath, prefixArgs: [script] } }),
      /secret scan did not complete/,
      label,
    );
    assert.deepEqual(readTree(join(dir, "snapshot")), before, label);
  }
});
