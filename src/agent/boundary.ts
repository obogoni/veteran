import type { HookCallback } from "@anthropic-ai/claude-agent-sdk";
import { realpathSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";

/** Tools the agent may call. `StructuredOutput` is added by the SDK whenever `outputFormat` is set. */
export const READ_TOOLS = ["Read", "Grep", "Glob"] as const;
export const STRUCTURED_OUTPUT_TOOL = "StructuredOutput";

export interface Denial {
  tool: string;
  target: string;
  reason: string;
}

/** The path-like values a read tool call would reach; a missing `path` means the working directory. */
export function targetsOf(tool: string, input: unknown): string[] {
  const data = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const pick = (...keys: string[]) => keys.map((key) => data[key]).filter((value): value is string => typeof value === "string");
  switch (tool) {
    case "Read":
      return pick("file_path");
    case "Grep":
      return pick("path", "glob");
    case "Glob":
      return pick("path", "pattern");
    default:
      return [];
  }
}

/**
 * Whether `target` stays inside `root`. A glob pattern counts as a path. Denied outright: any `..`
 * segment (a glob double star can match zero folders, so "any-depth then .." climbs out), `~`, and environment
 * expansions (`%VAR%`, `$VAR`, `${VAR}`). Otherwise the target must resolve under `root`, in its
 * given or its real form (so a Windows 8.3 short name and its long form both count).
 */
export function isInside(root: string, target: string): boolean {
  const trimmed = target.trim();
  if (trimmed === "") return true;
  if (trimmed.startsWith("~")) return false;
  if (/%[^%\\/]+%|\$[A-Za-z_{(]/.test(trimmed)) return false;
  if (trimmed.split(/[\\/{},]/).some((segment) => segment.trim() === "..")) return false;
  // Brace alternatives and comma lists can hide an escaping member: check each one.
  const members = trimmed.split(/[{},]/).filter((part) => part.trim() !== "");
  if (members.length > 1 && !members.every((part) => isInside(root, part))) return false;
  const roots = rootForms(root);
  const path = resolve(root, trimmed);
  return roots.some((form) => contains(form, path));
}

function rootForms(root: string): string[] {
  const forms = [resolve(root)];
  try {
    forms.push(realpathSync.native(forms[0]!));
  } catch {
    // A root that does not exist has only its resolved form.
  }
  return forms;
}

function contains(root: string, path: string): boolean {
  const rel = relative(root, path);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

/** Why a tool call must be denied, or undefined when it may run. */
export function denialReason(root: string, tool: string, input: unknown): Denial | undefined {
  if (tool === STRUCTURED_OUTPUT_TOOL) return undefined;
  if (!(READ_TOOLS as readonly string[]).includes(tool)) {
    return { tool, target: "", reason: `tool ${tool} is not available to Veteran` };
  }
  for (const target of targetsOf(tool, input)) {
    if (!isInside(root, target)) return { tool, target, reason: "outside the snapshot; only the snapshot may be read" };
  }
  return undefined;
}

/** A `PreToolUse` hook that denies anything outside `root` and records each denial. */
export function boundaryHook(root: string, denials: Denial[], allowTools = true): HookCallback {
  return async (input) => {
    if (input.hook_event_name !== "PreToolUse") return {};
    const denial = allowTools
      ? denialReason(root, input.tool_name, input.tool_input)
      : input.tool_name === STRUCTURED_OUTPUT_TOOL
        ? undefined
        : { tool: input.tool_name, target: "", reason: "no tools are available here" };
    if (!denial) return {};
    denials.push(denial);
    return {
      hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: denial.reason },
    };
  };
}
