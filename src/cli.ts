#!/usr/bin/env node
import { loadProfile, profileDirFromEnv } from "./profile/loadProfile.ts";
import { buildSnapshot, formatSummary } from "./snapshot/buildSnapshot.ts";

const USAGE = "usage: veteran snapshot";

async function main(argv: string[]): Promise<number> {
  const [command, ...rest] = argv;
  if (command !== "snapshot" || rest.length > 0) {
    process.stderr.write(`${USAGE}\n`);
    return 1;
  }
  const profile = loadProfile(profileDirFromEnv());
  const result = await buildSnapshot(profile);
  process.stdout.write(`${formatSummary(result)}\n`);
  return 0;
}

main(process.argv.slice(2)).then(
  (code) => (process.exitCode = code),
  (error: unknown) => {
    process.stderr.write(`veteran: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  },
);
