import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { rename } from "node:fs/promises";
import { setTimeout as sleep } from "node:timers/promises";
import { dirname, join } from "node:path";
import type { Profile } from "../profile/loadProfile.ts";
import { assertRepository, BlobReader, GitError, listTree, resolveCommit } from "./git.ts";
import { compileExcludes } from "./glob.ts";
import { GITLEAKS, scanForSecrets, type Scanner } from "./scan.ts";

export const SNAPSHOT_DIR = "snapshot";
const STAGING_PREFIX = ".snapshot-staging-";
const OLD_PREFIX = ".snapshot-old-";

export interface TreeCounts {
  copied: number;
  excluded: number;
  symlinks: number;
  submodules: number;
}

export interface SnapshotResult extends TreeCounts {
  sha: string;
  snapshotPath: string;
}

/** The steps after the copy begins; replaceable so tests can make each one fail. */
export interface SnapshotSteps {
  copy: (repoPath: string, sha: string, excludePaths: readonly string[], target: string) => Promise<TreeCounts>;
  scan: (scanRoot: string, workDir: string) => Promise<void>;
  replace: (tree: string, snapshot: string) => Promise<void>;
}

export interface SnapshotOptions {
  scanner?: Scanner;
  steps?: Partial<SnapshotSteps>;
}

export async function buildSnapshot(profile: Profile, options: SnapshotOptions = {}): Promise<SnapshotResult> {
  const steps: SnapshotSteps = {
    copy: copyTree,
    scan: (scanRoot, workDir) => scanForSecrets(scanRoot, workDir, options.scanner ?? GITLEAKS),
    replace: replaceSnapshot,
    ...options.steps,
  };

  await assertRepository(profile.repoPath);
  const sha = await resolveCommit(profile.repoPath, profile.ref);

  const snapshotPath = join(profile.dir, SNAPSHOT_DIR);
  const staging = mkdtempSync(join(profile.dir, STAGING_PREFIX));
  try {
    const scanRoot = join(staging, "scan");
    const tree = join(scanRoot, "tree");
    mkdirSync(tree, { recursive: true });
    const counts = await steps.copy(profile.repoPath, sha, profile.excludePaths, tree);
    await steps.scan(scanRoot, staging);
    await steps.replace(tree, snapshotPath);
    return { sha, snapshotPath, ...counts };
  } finally {
    rmSync(staging, { recursive: true, force: true, maxRetries: 10 });
  }
}

/** Writes the blobs at `sha` into `target`, skipping exclusions, symlinks and submodules. */
export async function copyTree(
  repoPath: string,
  sha: string,
  excludePaths: readonly string[],
  target: string,
): Promise<TreeCounts> {
  const isExcluded = compileExcludes(excludePaths);
  const counts: TreeCounts = { copied: 0, excluded: 0, symlinks: 0, submodules: 0 };
  const reader = new BlobReader(repoPath);
  try {
    for (const entry of await listTree(repoPath, sha)) {
      const segments = entry.path.split("/");
      if (segments.some((segment) => segment === ".." || segment === "" || segment.toLowerCase() === ".git")) {
        if (segments.some((segment) => segment === ".." || segment === "")) {
          throw new GitError(`refusing unsafe path in tree: ${JSON.stringify(entry.path)}`);
        }
        counts.excluded++;
        continue;
      }
      if (isExcluded(entry.path)) {
        counts.excluded++;
        continue;
      }
      if (entry.type === "commit") {
        counts.submodules++;
        continue;
      }
      if (entry.mode === "120000") {
        counts.symlinks++;
        continue;
      }
      const destination = join(target, ...segments);
      mkdirSync(dirname(destination), { recursive: true });
      writeFileSync(destination, await reader.read(entry.sha));
      counts.copied++;
    }
  } finally {
    reader.close();
  }
  return counts;
}

/** Swaps `tree` in as `snapshot`; the previous snapshot survives any failure before the swap completes. */
export async function replaceSnapshot(tree: string, snapshot: string): Promise<void> {
  if (!existsSync(snapshot)) {
    await renameWithRetry(tree, snapshot);
    return;
  }
  const old = join(dirname(snapshot), OLD_PREFIX + randomBytes(6).toString("hex"));
  await renameWithRetry(snapshot, old);
  try {
    await renameWithRetry(tree, snapshot);
  } catch (error) {
    await renameWithRetry(old, snapshot);
    throw error;
  }
  rmSync(old, { recursive: true, force: true, maxRetries: 10 });
}

const TRANSIENT_RENAME_CODES = new Set(["EPERM", "EACCES", "EBUSY"]);

/**
 * On Windows, antivirus and indexers briefly hold freshly written files, and renaming
 * their directory fails with EPERM until they let go.
 */
async function renameWithRetry(from: string, to: string): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    try {
      await rename(from, to);
      return;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code ?? "";
      if (process.platform !== "win32" || !TRANSIENT_RENAME_CODES.has(code) || attempt >= 40) throw error;
      await sleep(Math.min(50 * 2 ** attempt, 500));
    }
  }
}

export function formatSummary(result: SnapshotResult): string {
  return (
    `snapshot ${result.sha}: ${result.copied} files copied, ${result.excluded} excluded, ` +
    `${result.symlinks} symlinks omitted, ${result.submodules} submodules omitted`
  );
}
