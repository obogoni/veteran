import { existsSync, readFileSync, statSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import { parse } from "yaml";

export const PROFILE_DIR_ENV = "VETERAN_PROFILE_DIR";

export interface Profile {
  /** Absolute path of the profile directory. */
  dir: string;
  name: string;
  /** Absolute path; a relative value in profile.yaml resolves against `dir`. */
  repoPath: string;
  ref: string;
  language: string;
  /** Absolute paths; relative values resolve against `dir`. */
  instructions: string[];
  excludePaths: string[];
  denyTerms: string[];
  versionCaveat: string;
}

export class ProfileError extends Error {
  override name = "ProfileError";
}

const STRING_FIELDS = ["name", "repoPath", "ref", "language", "versionCaveat"] as const;
const LIST_FIELDS = ["instructions", "excludePaths", "denyTerms"] as const;

export function profileDirFromEnv(env: NodeJS.ProcessEnv = process.env): string {
  const value = env[PROFILE_DIR_ENV];
  if (!value) {
    throw new ProfileError(`${PROFILE_DIR_ENV} is not set; point it at a profile directory containing profile.yaml`);
  }
  return resolve(value);
}

export function loadProfile(profileDir: string): Profile {
  const dir = resolve(profileDir);
  const file = join(dir, "profile.yaml");

  if (!existsSync(file) || !statSync(file).isFile()) {
    throw new ProfileError(`Profile not found: ${file}`);
  }

  let raw: unknown;
  try {
    raw = parse(readFileSync(file, "utf8"));
  } catch (error) {
    throw new ProfileError(`Invalid YAML in ${file}: ${(error as Error).message}`);
  }
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    throw new ProfileError(`Invalid profile ${file}:\n  - the file must be a mapping of the profile fields`);
  }
  const data = raw as Record<string, unknown>;
  const problems: string[] = [];

  for (const field of STRING_FIELDS) {
    const value = data[field];
    if (value === undefined || value === null) problems.push(`${field}: missing`);
    else if (typeof value !== "string" || value.trim() === "") problems.push(`${field}: expected a non-empty string`);
  }
  for (const field of LIST_FIELDS) {
    const value = data[field];
    if (value === undefined || value === null) problems.push(`${field}: missing`);
    else if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
      problems.push(`${field}: expected a list of strings`);
    }
  }

  if (Array.isArray(data.denyTerms)) {
    for (const [index, term] of data.denyTerms.entries()) {
      // An empty term matches every answer, so nothing would ever be delivered.
      if (typeof term === "string" && term.trim() === "") problems.push(`denyTerms[${index}]: empty term`);
    }
  }

  if (problems.length === 0) {
    for (const [index, pattern] of (data.excludePaths as string[]).entries()) {
      const problem = excludePathProblem(pattern);
      if (problem) problems.push(`excludePaths[${index}] ${JSON.stringify(pattern)}: ${problem}`);
    }
    for (const [index, entry] of (data.instructions as string[]).entries()) {
      const path = resolveFrom(dir, entry);
      if (!existsSync(path) || !statSync(path).isFile()) {
        problems.push(`instructions[${index}] ${JSON.stringify(entry)}: file not found (${path})`);
      }
    }
  }

  if (problems.length > 0) {
    throw new ProfileError(`Invalid profile ${file}:\n${problems.map((problem) => `  - ${problem}`).join("\n")}`);
  }

  return {
    dir,
    name: data.name as string,
    repoPath: resolveFrom(dir, data.repoPath as string),
    ref: data.ref as string,
    language: data.language as string,
    instructions: (data.instructions as string[]).map((entry) => resolveFrom(dir, entry)),
    excludePaths: data.excludePaths as string[],
    denyTerms: data.denyTerms as string[],
    versionCaveat: data.versionCaveat as string,
  };
}

function resolveFrom(dir: string, path: string): string {
  return isAbsolute(path) ? path : resolve(dir, path);
}

/** Patterns that would silently match nothing are rejected: a typo here exposes a path. */
function excludePathProblem(pattern: string): string | undefined {
  if (pattern.trim() === "") return "empty pattern";
  if (pattern.startsWith("!")) return "negation is not supported; list only the paths to exclude";
  if (pattern.includes("\\")) return "use / as the separator";
  if (pattern.startsWith("/") || pattern.startsWith("./")) return "patterns are relative to the repository root; drop the leading / or ./";
  return undefined;
}
