import { spawn } from "node:child_process";
import { existsSync, realpathSync, statSync } from "node:fs";
import type { Readable } from "node:stream";

/**
 * Read-only access to a repository's objects. Only rev-parse, ls-tree and cat-file
 * run, so the working tree, index and HEAD of `repoPath` are never touched.
 */
const GIT_OPTIONS = ["-c", "core.fsmonitor=false", "-c", "core.quotePath=false"];

export class GitError extends Error {
  override name = "GitError";
}

export interface TreeEntry {
  mode: string;
  type: "blob" | "tree" | "commit";
  sha: string;
  path: string;
}

interface GitResult {
  code: number;
  stdout: Buffer;
  stderr: string;
}

function git(repo: string, args: string[]): Promise<GitResult> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn("git", [...GIT_OPTIONS, "-C", repo, ...args], { stdio: ["ignore", "pipe", "pipe"] });
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    child.stdout.on("data", (chunk: Buffer) => out.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => err.push(chunk));
    child.on("error", (error: NodeJS.ErrnoException) =>
      reject(new GitError(error.code === "ENOENT" ? "git not found on PATH" : `git failed to start: ${error.message}`)),
    );
    child.on("close", (code) =>
      resolvePromise({ code: code ?? 1, stdout: Buffer.concat(out), stderr: Buffer.concat(err).toString("utf8").trim() }),
    );
  });
}

function samePath(a: string, b: string): boolean {
  const left = realpathSync.native(a);
  const right = realpathSync.native(b);
  return process.platform === "win32" ? left.toLowerCase() === right.toLowerCase() : left === right;
}

/** Fails unless `repoPath` itself is the root of a repository (a directory inside another one does not count). */
export async function assertRepository(repoPath: string): Promise<void> {
  const notARepo = new GitError(`repoPath is not a git repository: ${repoPath}`);
  if (!existsSync(repoPath) || !statSync(repoPath).isDirectory()) throw notARepo;

  const inside = await git(repoPath, ["rev-parse", "--is-inside-work-tree"]);
  if (inside.code !== 0) throw notARepo;
  if (inside.stdout.toString("utf8").trim() === "true") {
    const top = await git(repoPath, ["rev-parse", "--show-toplevel"]);
    if (top.code !== 0 || !samePath(top.stdout.toString("utf8").trim(), repoPath)) throw notARepo;
    return;
  }
  const gitDir = await git(repoPath, ["rev-parse", "--absolute-git-dir"]);
  if (gitDir.code !== 0 || !samePath(gitDir.stdout.toString("utf8").trim(), repoPath)) throw notARepo;
}

export async function resolveCommit(repoPath: string, ref: string): Promise<string> {
  const result = await git(repoPath, ["rev-parse", "--verify", "--quiet", "--end-of-options", `${ref}^{commit}`]);
  const sha = result.stdout.toString("utf8").trim();
  if (result.code !== 0 || !/^[0-9a-f]{40,64}$/.test(sha)) {
    throw new GitError(`ref does not resolve to a commit in ${repoPath}: ${ref}`);
  }
  return sha;
}

export async function listTree(repoPath: string, sha: string): Promise<TreeEntry[]> {
  const result = await git(repoPath, ["ls-tree", "-r", "-z", "--full-tree", sha]);
  if (result.code !== 0) throw new GitError(`git ls-tree failed: ${result.stderr}`);
  const entries: TreeEntry[] = [];
  for (const record of result.stdout.toString("utf8").split("\0")) {
    if (record === "") continue;
    const tab = record.indexOf("\t");
    const [mode, type, objectSha] = record.slice(0, tab).split(" ");
    entries.push({ mode: mode!, type: type as TreeEntry["type"], sha: objectSha!, path: record.slice(tab + 1) });
  }
  return entries;
}

/** A long-lived `git cat-file --batch`, read one blob at a time. */
export class BlobReader {
  private readonly child;
  private readonly stdout: Readable;
  private buffered: Buffer = Buffer.alloc(0);
  private ended = false;
  private failure: Error | undefined;
  private wake: (() => void) | undefined;

  constructor(repoPath: string) {
    this.child = spawn("git", [...GIT_OPTIONS, "-C", repoPath, "cat-file", "--batch"], {
      stdio: ["pipe", "pipe", "ignore"],
    });
    this.stdout = this.child.stdout;
    this.stdout.on("data", (chunk: Buffer) => {
      this.buffered = this.buffered.length === 0 ? chunk : Buffer.concat([this.buffered, chunk]);
      this.notify();
    });
    this.stdout.on("end", () => {
      this.ended = true;
      this.notify();
    });
    this.child.on("error", (error) => {
      this.failure = new GitError(`git cat-file failed: ${error.message}`);
      this.notify();
    });
  }

  async read(sha: string): Promise<Buffer> {
    this.child.stdin.write(`${sha}\n`);
    const header = (await this.take((buffer) => buffer.indexOf(0x0a) + 1)).toString("utf8").trim();
    const [, type, size] = header.split(" ");
    if (type !== "blob" || size === undefined) throw new GitError(`git cat-file could not read ${sha}: ${header}`);
    const length = Number(size);
    const body = await this.take((buffer) => (buffer.length >= length + 1 ? length + 1 : 0));
    return body.subarray(0, length);
  }

  close(): void {
    this.child.stdin.end();
    this.child.kill();
  }

  /** Waits until `size(buffer)` returns a positive byte count, then consumes those bytes. */
  private async take(size: (buffer: Buffer) => number): Promise<Buffer> {
    for (;;) {
      const count = size(this.buffered);
      if (count > 0) {
        const chunk = this.buffered.subarray(0, count);
        this.buffered = this.buffered.subarray(count);
        return chunk;
      }
      if (this.failure) throw this.failure;
      if (this.ended) throw new GitError("git cat-file ended unexpectedly");
      await new Promise<void>((resolveWait) => (this.wake = resolveWait));
    }
  }

  private notify(): void {
    const wake = this.wake;
    this.wake = undefined;
    wake?.();
  }
}
