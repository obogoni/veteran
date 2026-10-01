import { basename } from "node:path";
import { ask, type AskDeps } from "./agent/ask.ts";
import { renderAnswer, renderFallback } from "./agent/render.ts";
import { runEvals } from "./evals/runEvals.ts";
import { loadProfile, profileDirFromEnv } from "./profile/loadProfile.ts";
import { buildSnapshot, formatSummary as formatSnapshotSummary } from "./snapshot/buildSnapshot.ts";

export const USAGE = 'usage: veteran snapshot | veteran ask "<question>" | veteran eval';

export interface Io {
  env: NodeJS.ProcessEnv;
  stdout: (text: string) => void;
  stderr: (text: string) => void;
}

/** Runs one CLI command and returns its exit code. Errors propagate; the caller prints them and exits `1`. */
export async function runCommand(argv: string[], io: Io, deps: AskDeps): Promise<number> {
  const [command, ...rest] = argv;
  const usage = () => {
    io.stderr(`${USAGE}\n`);
    return 1;
  };

  if (command === "snapshot") {
    if (rest.length > 0) return usage();
    const profile = loadProfile(profileDirFromEnv(io.env));
    io.stdout(`${formatSnapshotSummary(await buildSnapshot(profile))}\n`);
    return 0;
  }

  if (command === "ask") {
    if (rest.length !== 1 || rest[0]!.trim() === "") return usage();
    const profile = loadProfile(profileDirFromEnv(io.env));
    const result = await ask(profile, rest[0]!, { ...deps, env: deps.env ?? io.env });
    if (result.ok && result.answer) io.stdout(renderAnswer(result.answer, profile.versionCaveat, profile.language));
    else {
      if (result.fallback) io.stdout(renderFallback(rest[0]!, basename(result.transcriptPath), profile.language));
      io.stderr(`veteran: ${result.error}\n`);
    }
    io.stderr(`transcript: ${result.transcriptPath} · cost: $${result.costUsd.toFixed(4)} (estimated) · ${(result.durationMs / 1000).toFixed(1)} s\n`);
    return result.ok ? 0 : 1;
  }

  if (command === "eval") {
    if (rest.length > 0) return usage();
    const profile = loadProfile(profileDirFromEnv(io.env));
    await runEvals(profile, { ...deps, env: deps.env ?? io.env }, (line) => io.stdout(`${line}\n`));
    return 0;
  }

  return usage();
}
