import { execFileSync, spawnSync } from "node:child_process";
import { randomInt } from "node:crypto";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { stringify } from "yaml";

export const ROOT = fileURLToPath(new URL("..", import.meta.url));
export const CLI = join(ROOT, "src", "cli.ts");

export function tempDir(label: string): string {
  return mkdtempSync(join(tmpdir(), `veteran-${label}-`));
}

const GIT_IDENTITY = ["-c", "user.name=Veteran Test", "-c", "user.email=test@example.invalid", "-c", "core.autocrlf=false"];

export function git(repo: string, ...args: string[]): string {
  return execFileSync("git", [...GIT_IDENTITY, "-C", repo, ...args], { encoding: "utf8" }).trim();
}

/** Creates a repository with `files` committed on `main`. Values are written byte for byte. */
export function makeRepo(files: Record<string, string | Buffer>, label = "repo"): string {
  const repo = tempDir(label);
  git(repo, "init", "-q", "-b", "main");
  commitFiles(repo, files, "initial");
  return repo;
}

export function commitFiles(repo: string, files: Record<string, string | Buffer>, message: string): string {
  for (const [path, content] of Object.entries(files)) {
    const file = join(repo, ...path.split("/"));
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, content);
  }
  git(repo, "add", "-A");
  git(repo, "commit", "-q", "--allow-empty", "-m", message);
  return git(repo, "rev-parse", "HEAD");
}

/** Adds an index entry of an arbitrary mode (symlink 120000, gitlink 160000) without touching the filesystem. */
export function commitRawEntry(repo: string, mode: string, path: string, content: string, message: string): string {
  const sha =
    mode === "160000"
      ? git(repo, "rev-parse", "HEAD")
      : execFileSync("git", ["-C", repo, "hash-object", "-w", "--stdin"], { input: content, encoding: "utf8" }).trim();
  git(repo, "update-index", "--add", "--cacheinfo", `${mode},${sha},${path}`);
  git(repo, "commit", "-q", "-m", message);
  return git(repo, "rev-parse", "HEAD");
}

export interface ProfileFields {
  name?: unknown;
  repoPath?: unknown;
  ref?: unknown;
  language?: unknown;
  instructions?: unknown;
  excludePaths?: unknown;
  denyTerms?: unknown;
  versionCaveat?: unknown;
}

/** A valid profile directory over `repoPath`, with one instructions file. */
export function makeProfile(repoPath: string, fields: ProfileFields = {}): string {
  const dir = tempDir("profile");
  writeFileSync(join(dir, "overview.md"), "# Overview\n");
  writeProfileYaml(dir, {
    name: "test",
    repoPath,
    ref: "main",
    language: "pt-BR",
    instructions: ["overview.md"],
    excludePaths: [],
    denyTerms: [],
    versionCaveat: "current version",
    ...fields,
  });
  return dir;
}

export function writeProfileYaml(dir: string, fields: ProfileFields): void {
  writeFileSync(join(dir, "profile.yaml"), stringify(fields));
}

export interface CliResult {
  status: number;
  stdout: string;
  stderr: string;
}

export function runCli(profileDir: string | undefined, options: { cwd?: string; env?: NodeJS.ProcessEnv } = {}): CliResult {
  const env: NodeJS.ProcessEnv = { ...process.env, ...options.env };
  if (profileDir === undefined) delete env.VETERAN_PROFILE_DIR;
  else env.VETERAN_PROFILE_DIR = profileDir;
  const result = spawnSync(process.execPath, [CLI, "snapshot"], { cwd: options.cwd ?? ROOT, env, encoding: "utf8" });
  return { status: result.status ?? -1, stdout: result.stdout, stderr: result.stderr };
}

/** Every file under `dir` as repo-style relative path -> content, directories and symlinks included by type. */
export function readTree(dir: string): Map<string, Buffer | "dir" | "symlink"> {
  const out = new Map<string, Buffer | "dir" | "symlink">();
  const walk = (current: string) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const full = join(current, entry.name);
      const key = relative(dir, full).split(sep).join("/");
      if (entry.isSymbolicLink()) out.set(key, "symlink");
      else if (entry.isDirectory()) {
        out.set(key, "dir");
        walk(full);
      } else out.set(key, readFileSync(full));
    }
  };
  walk(dir);
  return out;
}

export function filesOf(dir: string): string[] {
  return [...readTree(dir)].filter(([, value]) => Buffer.isBuffer(value)).map(([key]) => key).sort();
}

export function exists(path: string): boolean {
  try {
    statSync(path);
    return true;
  } catch {
    return false;
  }
}

/** A GitHub-PAT-shaped token that the gitleaks default rules detect, never present in source. */
export function fakeSecret(): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let token = "ghp_";
  for (let i = 0; i < 36; i++) token += alphabet[randomInt(alphabet.length)];
  return token;
}

/** PATH with only the directory holding git, so gitleaks cannot be found. */
export function pathWithoutGitleaks(): string {
  const gitPath = execFileSync(process.platform === "win32" ? "where" : "which", ["git"], { encoding: "utf8" })
    .split(/\r?\n/)[0]!
    .trim();
  return dirname(gitPath);
}

export function repoState(repo: string): { head: string; branch: string; status: string } {
  return {
    head: git(repo, "rev-parse", "HEAD"),
    branch: git(repo, "symbolic-ref", "--short", "HEAD"),
    status: git(repo, "status", "--porcelain", "--untracked-files=all"),
  };
}
