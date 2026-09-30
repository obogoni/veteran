import type { Options, SDKMessage } from "@anthropic-ai/claude-agent-sdk";

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
  const env: Record<string, string | undefined> = { ...source, CLAUDE_CODE_DISABLE_BUNDLED_SKILLS: "1" };
  for (const key of STRIPPED_ENV) delete env[key];
  return env;
}

/** Options every Veteran query shares, whatever its tools. */
export function hardenedOptions(env: NodeJS.ProcessEnv): Pick<Options, "settingSources" | "env" | "permissionMode" | "settings"> {
  return {
    settingSources: [],
    env: agentEnv(env),
    permissionMode: "dontAsk",
    settings: { enabledPlugins: { ...DISABLED_PLUGINS } },
  };
}

type InitMessage = Extract<SDKMessage, { type: "system"; subtype: "init" }>;

export function isInit(message: SDKMessage): message is InitMessage {
  return message.type === "system" && (message as { subtype?: string }).subtype === "init";
}

/** Why the session the SDK started is not the one Veteran asked for; empty when it is. */
export function initProblems(init: InitMessage, expectedTools: readonly string[]): string[] {
  const problems: string[] = [];
  const tools = [...(init.tools ?? [])].sort();
  const expected = [...expectedTools].sort();
  if (JSON.stringify(tools) !== JSON.stringify(expected)) {
    problems.push(`unexpected tool set [${tools.join(", ")}], expected [${expected.join(", ")}]`);
  }
  if ((init.mcp_servers ?? []).length > 0) {
    problems.push(`unexpected MCP servers: ${init.mcp_servers.map((server) => server.name).join(", ")}`);
  }
  if ((init.plugins ?? []).length > 0) {
    problems.push(`unexpected plugins loaded: ${init.plugins.map((plugin) => plugin.name).join(", ")}`);
  }
  return problems;
}

/** Whether a failure looks like a missing or rejected Claude Code login. */
export function looksLikeAuthFailure(status: number | null | undefined, text: string, retryErrors: string[]): boolean {
  if (status === 401 || status === 403) return true;
  if (retryErrors.some((error) => error === "authentication_failed" || error === "oauth_org_not_allowed")) return true;
  return /not logged in|\/login|authenticat|oauth/i.test(text);
}

export const LOGIN_HINT = "Claude Code must be logged in with the Enterprise account: run `claude`, then `/login`.";
