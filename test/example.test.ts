import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { cpSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { parse } from "yaml";
import { exists, git, ROOT, runCli, tempDir } from "./helpers.ts";

const EXAMPLE = join(ROOT, "profiles", "example");

test("C28 the example profile snapshots Playground at the pinned ref without .specs", () => {
  const readme = readFileSync(join(EXAMPLE, "README.md"), "utf8");
  const clone = /git clone (\S+) profiles\/example\/repo/.exec(readme);
  assert.equal(clone?.[1], "https://github.com/obogoni/playground");

  const dir = join(tempDir("example"), "example");
  cpSync(EXAMPLE, dir, { recursive: true, filter: (source) => !/[\\/](repo|snapshot)$/.test(source) });
  execFileSync("git", ["clone", "-q", "--filter=blob:none", clone[1]!, join(dir, "repo")]);

  const profile = parse(readFileSync(join(dir, "profile.yaml"), "utf8")) as { ref: string; excludePaths: string[] };
  assert.equal(profile.ref, "60ff14809dc31c700f9f987add96aae48f72cb97");
  assert.ok(profile.excludePaths.includes(".specs"));
  assert.notEqual(git(join(dir, "repo"), "ls-tree", "--name-only", profile.ref, ".specs"), "");

  const result = runCli(dir);
  assert.equal(result.status, 0, result.stderr);
  assert.ok(exists(join(dir, "snapshot", "README.md")));
  assert.equal(exists(join(dir, "snapshot", ".specs")), false);
});

test("C29 git ignores real profiles and generated folders, but not the example's own files", () => {
  const ignored = (path: string) => {
    try {
      execFileSync("git", ["-C", ROOT, "check-ignore", "-q", "--no-index", path]);
      return true;
    } catch {
      return false;
    }
  };
  for (const path of [
    "profiles/acme/profile.yaml",
    "profiles/example/snapshot/",
    "profiles/example/transcripts/",
    "profiles/example/repo/",
    "profiles/example/snapshot/a.txt",
    "profiles/example/transcripts/a.jsonl",
    "profiles/example/repo/README.md",
    "profiles/example/.snapshot-staging-abc/scan/tree/a.txt",
  ]) {
    assert.equal(ignored(path), true, path);
  }
  for (const path of ["profiles/example/profile.yaml", "profiles/example/README.md", "src/snapshot/buildSnapshot.ts"]) {
    assert.equal(ignored(path), false, path);
  }
});
