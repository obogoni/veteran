#!/usr/bin/env node
import { query } from "@anthropic-ai/claude-agent-sdk";
import { runCommand } from "./commands.ts";

runCommand(
  process.argv.slice(2),
  { env: process.env, stdout: (text) => process.stdout.write(text), stderr: (text) => process.stderr.write(text) },
  { query },
).then(
  (code) => (process.exitCode = code),
  (error: unknown) => {
    process.stderr.write(`veteran: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  },
);
