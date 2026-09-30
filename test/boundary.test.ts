import assert from "node:assert/strict";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { boundaryHook, denialReason, type Denial } from "../src/agent/boundary.ts";
import { tempDir } from "./helpers.ts";

const profileDir = tempDir("boundary-profile");
const snapshot = join(profileDir, "snapshot");
const repoPath = join(profileDir, "repo");
const otherDrive = process.platform === "win32" ? (snapshot.toUpperCase().startsWith("C:") ? "D:\\data\\x.txt" : "C:\\Windows\\win.ini") : "/etc/passwd";

const denied: [string, Record<string, unknown>][] = [
  ["Read", { file_path: "../repo/.specs/x.md" }],
  ["Read", { file_path: join(repoPath, "README.md") }],
  ["Read", { file_path: join(profileDir, "profile.yaml") }],
  ["Read", { file_path: resolve(snapshot, "..", "profile.yaml") }],
  ["Read", { file_path: otherDrive }],
  ["Read", { file_path: "~/.ssh/id_rsa" }],
  ["Read", { file_path: "src/../../profile.yaml" }],
  ["Glob", { pattern: "/etc/**" }],
  ["Glob", { pattern: "../**/*.md" }],
  ["Glob", { pattern: "{src/**,../repo/**}" }],
  ["Glob", { pattern: "**/*.ts", path: repoPath }],
  ["Grep", { pattern: "password", path: ".." }],
  ["Grep", { pattern: "password", path: profileDir }],
  ["Grep", { pattern: "password", glob: "../repo/**" }],
  ["Bash", { command: "cat ../profile.yaml" }],
  ["Write", { file_path: "src/app.ts", content: "" }],
  ["WebFetch", { url: "https://example.com" }],
  ["Task", { prompt: "read ../repo" }],
];

const allowed: [string, Record<string, unknown>][] = [
  ["Read", { file_path: "src/app.ts" }],
  ["Read", { file_path: join(snapshot, "src", "app.ts") }],
  ["Glob", { pattern: "**/*.ts" }],
  ["Glob", { pattern: "src/**/*.{ts,tsx}", path: join(snapshot, "src") }],
  ["Grep", { pattern: "\\.\\./", path: "src" }],
  ["Grep", { pattern: "deactivate", glob: "**/*.ts" }],
  ["Grep", { pattern: "x" }],
  ["StructuredOutput", { answer: "../../etc" }],
];

test("C8 the hook denies every target outside the snapshot and every other tool", async () => {
  for (const [tool, input] of denied) {
    assert.ok(denialReason(snapshot, tool, input), `${tool} ${JSON.stringify(input)} should be denied`);
  }
  const denials: Denial[] = [];
  const hook = boundaryHook(snapshot, denials);
  const output = await hook(
    { hook_event_name: "PreToolUse", tool_name: "Read", tool_input: { file_path: "../repo/.specs/x.md" }, tool_use_id: "t1", session_id: "s", transcript_path: "", cwd: snapshot } as never,
    "t1",
    { signal: new AbortController().signal },
  );
  assert.deepEqual(output, {
    hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: "outside the snapshot; only the snapshot may be read" },
  });
  assert.deepEqual(denials, [{ tool: "Read", target: "../repo/.specs/x.md", reason: "outside the snapshot; only the snapshot may be read" }]);
});

test("C8 the hook allows reads inside the snapshot and StructuredOutput", async () => {
  for (const [tool, input] of allowed) {
    assert.equal(denialReason(snapshot, tool, input), undefined, `${tool} ${JSON.stringify(input)} should be allowed`);
  }
  const denials: Denial[] = [];
  const output = await boundaryHook(snapshot, denials)(
    { hook_event_name: "PreToolUse", tool_name: "Glob", tool_input: { pattern: "**/*.ts" }, tool_use_id: "t2", session_id: "s", transcript_path: "", cwd: snapshot } as never,
    "t2",
    { signal: new AbortController().signal },
  );
  assert.deepEqual(output, {});
  assert.deepEqual(denials, []);
});
