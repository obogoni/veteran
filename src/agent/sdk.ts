import type { Options, SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { realpathSync, rmSync } from "node:fs";
import { resolve } from "node:path";

/** The shape of the SDK's `query()` that Veteran uses; tests pass a fake. */
export type QueryFn = (params: { prompt: string; options?: Options }) => AsyncIterable<SDKMessage>;

/** Credentials Veteran never hands to the agent: it runs on the machine's Claude Code login only. */
export const STRIPPED_ENV = ["ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "ANTHROPIC_BASE_URL"] as const;

/**
 * Built-in plugins the Claude Code binary loads even with `settingSources: []`. `agents-md` exists to
 * load instruction files from the working directory, so every known one is switched off, and any
 * plugin still listed in `init` aborts the run (see `initProblems`).
 */
export const DISABLED_PLUGINS: Record<string, false> = {
  "cc-plugin-agents-md@builtin": false,
  "cc-plugin-telemetry@builtin": false,
  "cc-plugin-diff@builtin": false,
};

export function agentEnv(source: NodeJS.ProcessEnv = process.env): Record<string, string | undefined> {
  // Connectors attached to the claude.ai account reach a session through the login, not through settings.
  const env: Record<string, string | undefined> = { ...source, CLAUDE_CODE_DISABLE_BUNDLED_SKILLS: "1", ENABLE_CLAUDEAI_MCP_SERVERS: "false" };
  // Windows env names are case-insensitive: `anthropic_api_key` reaches a child as ANTHROPIC_API_KEY.
  for (const key of Object.keys(env)) {
    if ((STRIPPED_ENV as readonly string[]).includes(key.toUpperCase())) delete env[key];
  }
  return env;
}

/** Options every Veteran query shares, whatever its tools. */
export function hardenedOptions(env: NodeJS.ProcessEnv): Pick<Options, "settingSources" | "env" | "permissionMode" | "settings" | "strictMcpConfig"> {
  return {
    settingSources: [],
    strictMcpConfig: true,
    env: agentEnv(env),
    permissionMode: "dontAsk",
    settings: { enabledPlugins: { ...DISABLED_PLUGINS } },
  };
}

type InitMessage = Extract<SDKMessage, { type: "system"; subtype: "init" }>;

export function isInit(message: SDKMessage): message is InitMessage {
  return message.type === "system" && (message as { subtype?: string }).subtype === "init";
}

export interface ExpectedSession {
  tools: readonly string[];
  cwd?: string;
  model?: string;
  permissionMode?: string;
}

/** Why the session the SDK started is not the one Veteran asked for; empty when it is. */
export function initProblems(init: InitMessage, expected: ExpectedSession): string[] {
  const problems: string[] = [];
  const tools = [...(init.tools ?? [])].sort();
  const wanted = [...expected.tools].sort();
  if (JSON.stringify(tools) !== JSON.stringify(wanted)) {
    problems.push(`unexpected tool set [${tools.join(", ")}], expected [${wanted.join(", ")}]`);
  }
  if ((init.mcp_servers ?? []).length > 0) {
    problems.push(`unexpected MCP servers: ${init.mcp_servers.map((server) => server.name).join(", ")}`);
  }
  if (expected.cwd !== undefined && !samePath(init.cwd ?? "", expected.cwd)) {
    problems.push(`unexpected cwd ${JSON.stringify(init.cwd)}, expected ${JSON.stringify(expected.cwd)}`);
  }
  if (expected.model !== undefined && init.model !== expected.model) {
    problems.push(`unexpected model ${JSON.stringify(init.model)}, expected ${JSON.stringify(expected.model)}`);
  }
  if (expected.permissionMode !== undefined && init.permissionMode !== expected.permissionMode) {
    problems.push(`unexpected permission mode ${JSON.stringify(init.permissionMode)}, expected ${JSON.stringify(expected.permissionMode)}`);
  }
  if ((init.plugins ?? []).length > 0) {
    problems.push(`unexpected plugins loaded: ${init.plugins.map((plugin) => plugin.name).join(", ")}`);
  }
  return problems;
}

/** Compares real paths, so a Windows 8.3 short name (`OTVIOB~1`) matches its long form. */
function samePath(a: string, b: string): boolean {
  if (a === "") return false;
  const norm = (path: string) => {
    let real = resolve(path);
    try {
      real = realpathSync.native(real);
    } catch {
      // A path that does not exist compares by its resolved form.
    }
    return process.platform === "win32" ? real.toLowerCase() : real;
  };
  return norm(a) === norm(b);
}

/**
 * Whether a failure looks like a missing or rejected Claude Code login. `errorText` must be the
 * SDK's or the API's error text, never the model's answer, so a question about login rules cannot
 * trigger the hint.
 */
export function looksLikeAuthFailure(status: number | null | undefined, errorText: string, retryErrors: string[]): boolean {
  if (status === 401 || status === 403) return true;
  if (retryErrors.some((error) => error === "authentication_failed" || error === "oauth_org_not_allowed")) return true;
  return /not logged in|please run \/login|authentication_failed|invalid (api key|credentials|bearer token)|oauth token/i.test(errorText);
}

export interface Consumed {
  /** The deadline fired before the stream ended or `onMessage` stopped it. */
  timedOut: boolean;
  /** The SDK threw; set only when neither the deadline nor `onMessage` ended the run first. */
  thrown?: unknown;
}

/**
 * Reads `messages` until `onMessage` returns `"stop"`, the stream ends, or `timeoutMs` passes. Every
 * step races the deadline, so an SDK that ignores the abort still ends the read on time. Whenever the
 * stream did not end on its own, the controller is aborted and the iterator closed without waiting.
 */
export async function consume(
  messages: AsyncIterable<SDKMessage>,
  controller: AbortController,
  timeoutMs: number,
  onMessage: (message: SDKMessage) => "stop" | void,
): Promise<Consumed> {
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const deadline = new Promise<"deadline">((resolvePromise) => {
    if (controller.signal.aborted) resolvePromise("deadline");
    controller.signal.addEventListener("abort", () => resolvePromise("deadline"), { once: true });
  });
  let iterator: AsyncIterator<SDKMessage> | undefined;
  let ended = false;
  try {
    iterator = messages[Symbol.asyncIterator]();
    for (;;) {
      const next = await Promise.race([iterator.next(), deadline]);
      if (next === "deadline") return { timedOut: true };
      if (next.done) {
        ended = true;
        return { timedOut: false };
      }
      if (onMessage(next.value) === "stop") return { timedOut: false };
    }
  } catch (error) {
    return controller.signal.aborted ? { timedOut: true } : { timedOut: false, thrown: error };
  } finally {
    clearTimeout(timer);
    if (!ended) {
      controller.abort();
      void iterator?.return?.().catch(() => undefined);
    }
  }
}

/**
 * Removes a judge's temporary working directory. Best effort: once a run stops at its result, the SDK
 * child can still hold the directory for a moment, and on Windows that makes removal fail. An empty
 * leftover directory in the OS temp dir costs nothing; failing the run over it would.
 */
export function removeQuietly(dir: string): void {
  try {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  } catch {
    // Left for the OS to clean up.
  }
}

export const LOGIN_HINT = "Claude Code must be logged in with the Enterprise account: run `claude`, then `/login`.";
