import type { QueryFn } from "./agent/sdk.ts";
import { runCommand } from "./commands.ts";

/**
 * Runs the CLI and exits the process once stdout and stderr have drained. Exiting explicitly matters:
 * an SDK child that ignores the abort keeps handles open, and would otherwise keep `veteran` alive
 * after it has printed its result.
 */
export async function main(argv: string[], query: QueryFn, extra: { timeoutMs?: number } = {}): Promise<never> {
  let code: number;
  try {
    code = await runCommand(
      argv,
      { env: process.env, stdout: (text) => process.stdout.write(text), stderr: (text) => process.stderr.write(text) },
      { query, timeoutMs: extra.timeoutMs },
    );
  } catch (error) {
    process.stderr.write(`veteran: ${error instanceof Error ? error.message : String(error)}\n`);
    code = 1;
  }
  await Promise.all([drain(process.stdout), drain(process.stderr)]);
  process.exit(code);
}

function drain(stream: NodeJS.WriteStream): Promise<void> {
  return new Promise((resolve) => stream.write("", () => resolve()));
}
