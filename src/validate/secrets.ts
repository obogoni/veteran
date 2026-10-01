import { spawn } from "node:child_process";
import { randomInt } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { GITLEAKS, type Scanner } from "../snapshot/scan.ts";
import type { CheckedField, Finding } from "./deterministic.ts";

const CONFIG_PATH = fileURLToPath(new URL("../../config/gitleaks.toml", import.meta.url));
const LEAK_EXIT_CODE = 42;
const ALPHANUMERIC = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

/** The secret scan could not reach a verdict; the pipeline goes straight to the fallback. */
export class SecretScanError extends Error {
  override name = "SecretScanError";
}

/**
 * Runs gitleaks over the checked fields through stdin, with the same hardening as the snapshot scan:
 * Veteran's own config, an empty ignore directory, `gitleaks:allow` ignored, findings redacted and
 * `GITLEAKS_*` stripped. A fresh canary on the last line must be reported, or the scan has no verdict.
 */
export async function secretFindings(fields: CheckedField[], scanner: Scanner = GITLEAKS): Promise<Finding[]> {
  const lines: { field: string; line: number }[] = [];
  const text: string[] = [];
  for (const { field, text: value } of fields) {
    for (const line of value.split(/\r?\n/)) {
      text.push(line);
      lines.push({ field, line: text.length });
    }
  }
  text.push(`token = "ghp_${randomToken(36)}"`);
  const canaryLine = text.length;

  const work = mkdtempSync(join(tmpdir(), "veteran-secrets-"));
  try {
    const ignoreDir = join(work, "ignore");
    mkdirSync(ignoreDir);
    const reportPath = join(work, "report.json");
    const args = [
      ...(scanner.prefixArgs ?? []),
      "stdin",
      "--config",
      CONFIG_PATH,
      "--gitleaks-ignore-path",
      ignoreDir,
      "--ignore-gitleaks-allow",
      "--redact",
      "--no-banner",
      "--no-color",
      "--report-format",
      "json",
      "--report-path",
      reportPath,
      "--exit-code",
      String(LEAK_EXIT_CODE),
    ];
    const { code, stderr } = await run(scanner.command, args, `${text.join("\n")}\n`, work);
    if (code !== LEAK_EXIT_CODE) {
      throw new SecretScanError(code === 0 ? "gitleaks did not detect the canary secret" : `gitleaks exited ${code}: ${lastLine(stderr)}`);
    }
    if (!existsSync(reportPath)) throw new SecretScanError("gitleaks wrote no report");
    let report: unknown;
    try {
      report = JSON.parse(readFileSync(reportPath, "utf8"));
    } catch {
      throw new SecretScanError("gitleaks wrote an unreadable report");
    }
    if (!Array.isArray(report)) throw new SecretScanError("gitleaks wrote an unexpected report");

    let canarySeen = false;
    const findings: Finding[] = [];
    for (const item of report as Array<{ StartLine?: number; RuleID?: string; Match?: string }>) {
      if (item.StartLine === canaryLine) {
        canarySeen = true;
        continue;
      }
      const field = lines.find((entry) => entry.line === item.StartLine)?.field ?? "unknown";
      findings.push({ field, rule: "secret", match: `${item.RuleID ?? "unknown"}: ${item.Match ?? "REDACTED"}` });
    }
    if (!canarySeen) throw new SecretScanError("gitleaks did not report the canary secret");
    return findings;
  } finally {
    rmSync(work, { recursive: true, force: true, maxRetries: 3 });
  }
}

function run(command: string, args: string[], input: string, cwd: string): Promise<{ code: number; stderr: string }> {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.toUpperCase().startsWith("GITLEAKS_")));
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { env, cwd, stdio: ["pipe", "ignore", "pipe"] });
    const err: Buffer[] = [];
    child.stderr.on("data", (chunk: Buffer) => err.push(chunk));
    // A scanner that exits without reading stdin closes the pipe; its exit code decides.
    child.stdin.on("error", () => undefined);
    child.on("error", (error: NodeJS.ErrnoException) =>
      reject(new SecretScanError(error.code === "ENOENT" ? "gitleaks not found on PATH" : error.message)),
    );
    child.on("close", (code) => resolvePromise({ code: code ?? 1, stderr: Buffer.concat(err).toString("utf8") }));
    child.stdin.end(input);
  });
}

function lastLine(text: string): string {
  const lines = text.trim().split(/\r?\n/);
  return lines[lines.length - 1] || "no output";
}

function randomToken(length: number): string {
  let token = "";
  for (let i = 0; i < length; i++) token += ALPHANUMERIC[randomInt(ALPHANUMERIC.length)];
  return token;
}
