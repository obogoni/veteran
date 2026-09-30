import { randomBytes } from "node:crypto";
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export interface Transcript {
  path: string;
  /** Appends one JSON line; written immediately so an abort or crash keeps everything so far. */
  write(entry: unknown): void;
}

/** `20260930T201500123Z` - sortable, and safe in a Windows file name. */
export function transcriptTimestamp(date: Date): string {
  return date.toISOString().replace(/[-:]/g, "").replace(".", "");
}

/** Creates `<profileDir>/transcripts/<timestamp>-<8 hex>.jsonl`. */
export function openTranscript(profileDir: string, now: Date = new Date()): Transcript {
  const dir = join(profileDir, "transcripts");
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `${transcriptTimestamp(now)}-${randomBytes(4).toString("hex")}.jsonl`);
  writeFileSync(path, "", { flag: "wx" });
  return {
    path,
    write(entry) {
      appendFileSync(path, `${JSON.stringify(entry)}\n`);
    },
  };
}
