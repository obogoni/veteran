import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { loadProfile } from "../src/profile/loadProfile.ts";
import { buildSnapshot, copyTree, replaceSnapshot } from "../src/snapshot/buildSnapshot.ts";
import {
  commitFiles,
  commitRawEntry,
  exists,
  fakeSecret,
  filesOf,
  git,
  makeProfile,
  makeRepo,
  readTree,
  repoState,
  runCli,
  tempDir,
} from "./helpers.ts";

const BINARY = Buffer.from([0, 1, 2, 255, 254, 13, 10, 0]);

test("C6 a relative repoPath resolves against the profile directory, not the working directory", () => {
  const profileDir = makeProfile("./repo");
  const repo = join(profileDir, "repo");
  mkdirSync(repo);
  git(repo, "init", "-q", "-b", "main");
  commitFiles(repo, { "a.txt": "a" }, "initial");
  const result = runCli(profileDir, { cwd: tempDir("cwd") });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(filesOf(join(profileDir, "snapshot")), ["a.txt"]);
});

test("C8 a repoPath that is not a repository root exits non-zero naming it", () => {
  const outer = makeRepo({ "a.txt": "a" });
  const inner = join(outer, "plain");
  mkdirSync(inner);
  for (const repoPath of [tempDir("not-a-repo"), inner]) {
    const dir = makeProfile(repoPath);
    const result = runCli(dir);
    assert.notEqual(result.status, 0, repoPath);
    assert.ok(result.stderr.includes(`repoPath is not a git repository: ${repoPath}`), result.stderr);
    assert.equal(exists(join(dir, "snapshot")), false);
  }
  const dir = makeProfile(outer);
  assert.equal(runCli(dir).status, 0);
  const before = readTree(join(dir, "snapshot"));
  writeFileSync(join(dir, "profile.yaml"), readProfile(dir).replace(`repoPath: ${outer}`, `repoPath: ${inner}`));
  assert.notEqual(runCli(dir).status, 0);
  assert.deepEqual(readTree(join(dir, "snapshot")), before);
});

test("C9 an unresolvable ref exits non-zero naming it, snapshot unchanged", () => {
  const repo = makeRepo({ "a.txt": "a" });
  const dir = makeProfile(repo);
  assert.equal(runCli(dir).status, 0);
  const before = readTree(join(dir, "snapshot"));
  writeFileSync(join(dir, "profile.yaml"), readProfile(dir).replace("ref: main", "ref: no-such-branch"));
  const result = runCli(dir);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /ref does not resolve to a commit .*: no-such-branch/);
  assert.deepEqual(readTree(join(dir, "snapshot")), before);
});

test("C11 the snapshot is exactly the committed tree at ref, byte for byte", () => {
  const repo = makeRepo({
    "README.md": "hello\n",
    "src/crlf.txt": "line one\r\nline two\r\n",
    "src/data.bin": BINARY,
    "run.sh": "#!/bin/sh\necho hi\n",
  });
  git(repo, "update-index", "--chmod=+x", "run.sh");
  git(repo, "commit", "-q", "-m", "executable");
  writeFileSync(join(repo, "untracked.txt"), "not committed");
  writeFileSync(join(repo, "README.md"), "uncommitted edit\n");

  const dir = makeProfile(repo);
  const result = runCli(dir);
  assert.equal(result.status, 0, result.stderr);
  const snapshot = join(dir, "snapshot");
  assert.deepEqual(filesOf(snapshot), ["README.md", "run.sh", "src/crlf.txt", "src/data.bin"]);
  const tree = readTree(snapshot);
  assert.deepEqual(tree.get("README.md"), Buffer.from("hello\n"));
  assert.deepEqual(tree.get("src/crlf.txt"), Buffer.from("line one\r\nline two\r\n"));
  assert.deepEqual(tree.get("src/data.bin"), BINARY);
  assert.deepEqual(tree.get("run.sh"), Buffer.from("#!/bin/sh\necho hi\n"));
});

test("C13 the snapshot applies the excludePaths dialect", () => {
  const repo = makeRepo({
    "config/app/secrets.json": "{}",
    "key.pem": "k",
    "certs/key.pem": "k",
    "deep/certs/other.pem": "k",
    "Docs/a.txt": "upper",
    "ab.txt": "ab",
    "keep/main.ts": "x",
  });
  const dir = makeProfile(repo, { excludePaths: ["config", "*.pem", "deep/**/*.pem", "a?.txt", "docs/**"] });
  const result = runCli(dir);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(filesOf(join(dir, "snapshot")), ["Docs/a.txt", "ab.txt", "certs/key.pem", "keep/main.ts"]);
});

test("C14 no .git entry at any depth and no submodule gitlink is written", () => {
  const repo = makeRepo({ "a.txt": "a", "lib/b.txt": "b" });
  commitRawEntry(repo, "160000", "vendor/sub", "", "add submodule gitlink");
  commitCraftedGitDirs(repo);
  const dir = makeProfile(repo);
  const result = runCli(dir);
  assert.equal(result.status, 0, result.stderr);
  const keys = [...readTree(join(dir, "snapshot")).keys()];
  assert.ok(keys.every((key) => !key.split("/").includes(".git")), keys.join(","));
  assert.equal(exists(join(dir, "snapshot", "vendor", "sub")), false);
  assert.match(result.stdout, /1 submodules omitted/);
});

test("C15 tracked symlinks are omitted and counted", () => {
  const repo = makeRepo({ "real.txt": "real", "config/secret.txt": "s" });
  commitRawEntry(repo, "120000", "inside-link", "config/secret.txt", "link inside");
  commitRawEntry(repo, "120000", "outside-link", "../../etc/passwd", "link outside");
  const dir = makeProfile(repo, { excludePaths: ["config"] });
  const result = runCli(dir);
  assert.equal(result.status, 0, result.stderr);
  const tree = readTree(join(dir, "snapshot"));
  assert.deepEqual([...tree.keys()].sort(), ["real.txt"]);
  assert.match(result.stdout, /2 symlinks omitted/);
});

test("C16 a later run replaces the snapshot wholesale", () => {
  const repo = makeRepo({ "keep.txt": "k", "gone.txt": "g", "later-excluded.txt": "l" });
  const dir = makeProfile(repo);
  assert.equal(runCli(dir).status, 0);
  assert.deepEqual(filesOf(join(dir, "snapshot")), ["gone.txt", "keep.txt", "later-excluded.txt"]);

  git(repo, "rm", "-q", "gone.txt");
  git(repo, "commit", "-q", "-m", "delete");
  writeFileSync(join(dir, "profile.yaml"), readProfile(dir).replace("excludePaths: []", "excludePaths:\n  - later-excluded.txt"));
  const result = runCli(dir);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(filesOf(join(dir, "snapshot")), ["keep.txt"]);
});

test("C17 repoPath is left as found after a successful and a failed run", () => {
  const repo = makeRepo({ "a.txt": "a" });
  git(repo, "checkout", "-q", "-b", "work");
  writeFileSync(join(repo, "a.txt"), "dirty");
  writeFileSync(join(repo, "new.txt"), "untracked");
  const before = repoState(repo);

  const dir = makeProfile(repo);
  assert.equal(runCli(dir).status, 0);
  assert.deepEqual(repoState(repo), before);

  writeFileSync(join(dir, "profile.yaml"), readProfile(dir).replace("ref: main", "ref: missing"));
  assert.notEqual(runCli(dir).status, 0);
  assert.deepEqual(repoState(repo), before);

  // A failure after the copy has started: the tree at the new ref holds a secret.
  commitFiles(repo, { "leak.txt": `token = "${fakeSecret()}"\n` }, "leak");
  writeFileSync(join(repo, "a.txt"), "dirty");
  const beforeLeak = repoState(repo);
  writeFileSync(join(dir, "profile.yaml"), readProfile(dir).replace("ref: missing", "ref: work"));
  const leaked = runCli(dir);
  assert.notEqual(leaked.status, 0);
  assert.match(leaked.stderr, /gitleaks found/);
  assert.deepEqual(repoState(repo), beforeLeak);
});

test("C26 a failure at copy, scan or replace leaves no .snapshot-* entry and the snapshot unchanged", async () => {
  const repo = makeRepo({ "a.txt": "a", "b.txt": "b" });
  const dir = makeProfile(repo);
  assert.equal(runCli(dir).status, 0);
  commitFiles(repo, { "c.txt": "c" }, "more");
  const before = readTree(join(dir, "snapshot"));
  const profile = loadProfile(dir);

  const failures = {
    copy: {
      copy: async (repoPath: string, sha: string, excludes: readonly string[], target: string) => {
        await copyTree(repoPath, sha, excludes, target);
        throw new Error("copy failed");
      },
    },
    scan: { scan: async () => Promise.reject(new Error("scan failed")) },
    replace: { replace: async () => Promise.reject(new Error("replace failed")) },
    // Fails on the second rename, after the previous snapshot has already been moved aside.
    "replace after moving": {
      replace: async (tree: string, snapshot: string) => {
        await replaceSnapshot(join(tree, "does-not-exist"), snapshot);
      },
    },
  };
  for (const [step, steps] of Object.entries(failures)) {
    await assert.rejects(buildSnapshot(profile, { steps }), step === "replace after moving" ? /ENOENT/ : new RegExp(`${step} failed`));
    assert.deepEqual(readdirSync(dir).filter((name) => name.startsWith(".snapshot-")), [], step);
    assert.deepEqual(readTree(join(dir, "snapshot")), before, step);
  }
});

test("C27 a successful run prints one summary line with the SHA and the counts", () => {
  const repo = makeRepo({ "a.txt": "a", "b.txt": "b", "secret/x.txt": "x" });
  const sha = commitRawEntry(repo, "120000", "link", "a.txt", "link");
  const dir = makeProfile(repo, { excludePaths: ["secret"] });
  const result = runCli(dir);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, `snapshot ${sha}: 2 files copied, 1 excluded, 1 symlinks omitted, 0 submodules omitted\n`);
});

/** Commits a tree holding `.git/config` and `lib/.git/hooks/x` - git mktree accepts what `git add` never would. */
function commitCraftedGitDirs(repo: string): void {
  const run = (args: string[], input: string) => execFileSync("git", ["-C", repo, ...args], { input, encoding: "utf8" }).trim();
  const mktree = (entries: string[]) => run(["mktree"], `${entries.join("\n")}\n`);
  const blob = run(["hash-object", "-w", "--stdin"], "[core]\n");
  const hooks = mktree([`100644 blob ${blob}\tx`]);
  const nestedGit = mktree([`040000 tree ${hooks}\thooks`]);
  const lib = mktree([...git(repo, "ls-tree", "HEAD:lib").split("\n"), `040000 tree ${nestedGit}\t.git`]);
  const topGit = mktree([`100644 blob ${blob}\tconfig`]);
  const root = mktree([
    ...git(repo, "ls-tree", "HEAD").split("\n").filter((line) => !line.endsWith("\tlib")),
    `040000 tree ${lib}\tlib`,
    `040000 tree ${topGit}\t.git`,
  ]);
  const commit = git(repo, "commit-tree", root, "-p", "HEAD", "-m", "crafted .git entries");
  git(repo, "update-ref", "refs/heads/main", commit);
}

function readProfile(dir: string): string {
  return readTree(dir).get("profile.yaml")!.toString();
}
