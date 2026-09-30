import { spawn } from "node:child_process";
import { randomInt } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const CONFIG_PATH = fileURLToPath(new URL("../../config/gitleaks.toml", import.meta.url));
const LEAK_EXIT_CODE = 42;
const CANARY_FILE = "canary.txt";
const ALPHANUMERIC = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

export interface Scanner {
  command: string;
  /** Arguments placed before gitleaks' own; lets tests stand a script in for the binary. */
  prefixArgs?: string[];
}

export const GITLEAKS: Scanner = { command: "gitleaks" };

export interface Finding {
  /** Repo-relative, `/`-separated. */
  path: string;
  line: number;
  rule: string;
}

export class ScanIncompleteError extends Error {
  override name = "ScanIncompleteError";
}

export class SecretsFoundError extends Error {
  override name = "SecretsFoundError";
  readonly findings: Finding[];
  constructor(findings: Finding[]) {
    super(
      [`gitleaks found ${findings.length} secret(s); snapshot aborted:`]
        .concat(findings.map((finding) => `  - ${finding.path}:${finding.line} (rule ${finding.rule})`))
        .join("\n"),
    );
    this.findings = findings;
  }
}

/**
 * Scans `<scanRoot>/tree` for secrets. gitleaks scans `scanRoot`, not `tree`, so a
 * `.gitleaksignore` shipped at the tree's root is never read; a fresh canary secret at
 * `scanRoot` proves the scan actually ran with the default rules. `workDir` holds the
 * report and the empty ignore directory, outside the scanned root.
 */
export async function scanForSecrets(scanRoot: string, workDir: string, scanner: Scanner = GITLEAKS): Promise<void> {
  writeFileSync(join(scanRoot, CANARY_FILE), `token = "ghp_${randomToken(36)}"\n`);
  const ignoreDir = join(workDir, "ignore");
  mkdirSync(ignoreDir, { recursive: true });
  const reportPath = join(workDir, "report.json");

  const args = [
    ...(scanner.prefixArgs ?? []),
    "dir",
    scanRoot,
    "--config",
    CONFIG_PATH,
    "--gitleaks-ignore-path",
    ignoreDir,
    "--ignore-gitleaks-allow",
    "--redact",
    "--no-banner",
    "--no-color",
    "--exit-code",
    String(LEAK_EXIT_CODE),
    "--report-format",
    "json",
    "--report-path",
    reportPath,
  ];
  const { code, stderr } = await run(scanner.command, args);

  if (code !== LEAK_EXIT_CODE) {
    const detail = code === 0 ? "gitleaks did not detect the canary secret" : `gitleaks exited ${code}: ${lastLine(stderr)}`;
    throw new ScanIncompleteError(`secret scan did not complete (${detail}); snapshot aborted`);
  }
  if (!existsSync(reportPath)) throw new ScanIncompleteError("secret scan did not complete (no report written); snapshot aborted");

  let report: unknown;
  try {
    report = JSON.parse(readFileSync(reportPath, "utf8"));
  } catch {
    throw new ScanIncompleteError("secret scan did not complete (unreadable report); snapshot aborted");
  }
  if (!Array.isArray(report)) throw new ScanIncompleteError("secret scan did not complete (unexpected report); snapshot aborted");

  const canaryPath = resolve(scanRoot, CANARY_FILE);
  const treeRoot = resolve(scanRoot, "tree");
  let canarySeen = false;
  const findings: Finding[] = [];
  for (const item of report as Array<{ File?: string; StartLine?: number; RuleID?: string }>) {
    const file = resolve(item.File ?? "");
    if (file === canaryPath) {
      canarySeen = true;
      continue;
    }
    findings.push({
      path: relative(treeRoot, file).split(sep).join("/"),
      line: item.StartLine ?? 0,
      rule: item.RuleID ?? "unknown",
    });
  }
  if (!canarySeen) throw new ScanIncompleteError("secret scan did not complete (canary not reported); snapshot aborted");
  if (findings.length > 0) throw new SecretsFoundError(findings);
}

function run(command: string, args: string[]): Promise<{ code: number; stderr: string }> {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.toUpperCase().startsWith("GITLEAKS_")));
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { env, stdio: ["ignore", "ignore", "pipe"] });
    const err: Buffer[] = [];
    child.stderr.on("data", (chunk: Buffer) => err.push(chunk));
    child.on("error", (error: NodeJS.ErrnoException) =>
      reject(
        new ScanIncompleteError(
          error.code === "ENOENT"
            ? "secret scan did not complete (gitleaks not found on PATH); snapshot aborted"
            : `secret scan did not complete (${error.message}); snapshot aborted`,
        ),
      ),
    );
    child.on("close", (code) => resolvePromise({ code: code ?? 1, stderr: Buffer.concat(err).toString("utf8") }));
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
