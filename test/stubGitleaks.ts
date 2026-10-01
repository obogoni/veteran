/**
 * Stands in for `gitleaks stdin` in unit tests, where one real gitleaks start costs seconds. It
 * reports only Veteran's canary line (`token = "ghp_..."`), so every answer comes out clean.
 */
import { readFileSync, writeFileSync } from "node:fs";

const args = process.argv.slice(2);
const reportPath = args[args.indexOf("--report-path") + 1]!;
const lines = readFileSync(0, "utf8").split("\n");
const canary = lines.findLastIndex((line) => line.startsWith('token = "ghp_'));
writeFileSync(reportPath, JSON.stringify(canary < 0 ? [] : [{ RuleID: "github-pat", StartLine: canary + 1, Match: "REDACTED" }]));
process.exit(canary < 0 ? 0 : 42);
