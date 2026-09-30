import type { Options, SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { mkdirSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { VeteranAnswer } from "../src/agent/answerSchema.ts";
import type { QueryFn } from "../src/agent/sdk.ts";
import { runCommand } from "../src/commands.ts";
import { makeProfile, tempDir } from "./helpers.ts";

export const ANSWER: VeteranAnswer = {
  answer: "Depende do tipo do cartão.",
  branches: [
    { condition: "Cartão tipo A", behavior: "não é desativado" },
    { condition: "Cartão tipo B", behavior: "é desativado" },
  ],
  suggestedTests: ["Devolver um cartão tipo A e conferir que continua ativo"],
  clarifyingQuestion: null,
  confidence: "high",
  dependsOn: ["O tipo cadastrado para o cartão"],
  caveats: ["Cartões antigos podem não ter tipo"],
  internalReferences: ["INTERNAL-REF-CardService.cs:42"],
};

export interface FakeCall {
  prompt: string;
  options: Options;
}

export interface FakeScenario {
  /** `structured_output` of a success result; ignored when `result` overrides it. */
  answer?: unknown;
  /** Fields merged into the result message. */
  result?: Record<string, unknown>;
  /** Fields merged into the init message. */
  init?: Record<string, unknown>;
  /** Messages yielded between init and the result. */
  messages?: Record<string, unknown>[];
  /** Never yields a result; rejects when the caller aborts. */
  hang?: boolean;
  /** Called before the result is yielded, e.g. to exercise the hook. */
  during?: (options: Options) => Promise<void>;
  /** Yield no init message at all. */
  noInit?: boolean;
}

/** A stand-in for the SDK's `query()` that records each call and yields a scripted session. */
export function fakeQuery(...scenarios: FakeScenario[]): { query: QueryFn; calls: FakeCall[]; active: () => number; maxActive: () => number } {
  const calls: FakeCall[] = [];
  let active = 0;
  let maxActive = 0;
  const query: QueryFn = (params) => {
    const scenario = scenarios[Math.min(calls.length, scenarios.length - 1)] ?? {};
    calls.push({ prompt: params.prompt, options: params.options ?? {} });
    const options = params.options ?? {};
    return (async function* (): AsyncGenerator<SDKMessage> {
      active++;
      maxActive = Math.max(maxActive, active);
      try {
        if (!scenario.noInit) {
          yield {
            type: "system",
            subtype: "init",
            session_id: "sess-1",
            apiKeySource: "none",
            cwd: options.cwd,
            tools: Array.isArray(options.tools) && options.tools.length === 0 ? ["StructuredOutput"] : ["Read", "Grep", "Glob", "StructuredOutput"],
            mcp_servers: [],
            plugins: [],
            model: options.model,
            permissionMode: options.permissionMode,
            ...scenario.init,
          } as unknown as SDKMessage;
        }
        for (const message of scenario.messages ?? []) yield message as unknown as SDKMessage;
        if (scenario.during) await scenario.during(options);
        if (scenario.hang) {
          await new Promise((_, reject) => {
            const signal = options.abortController?.signal;
            if (signal?.aborted) reject(new Error("aborted"));
            signal?.addEventListener("abort", () => reject(new Error("aborted")));
          });
        }
        await new Promise((resolve) => setTimeout(resolve, 5));
        yield {
          type: "result",
          subtype: "success",
          is_error: false,
          result: "",
          structured_output: "answer" in scenario ? scenario.answer : ANSWER,
          total_cost_usd: 0.1234,
          duration_ms: 4200,
          num_turns: 3,
          session_id: "sess-1",
          errors: [],
          ...scenario.result,
        } as unknown as SDKMessage;
      } finally {
        active--;
      }
    })();
  };
  return { query, calls, active: () => active, maxActive: () => maxActive };
}

/** A valid profile whose `snapshot/` exists (or not). */
export function askProfile(options: { snapshot?: boolean; language?: string; versionCaveat?: string } = {}): string {
  const dir = makeProfile(tempDir("repo-unused"), {
    language: options.language ?? "pt-BR",
    versionCaveat: options.versionCaveat ?? "Comportamento da versão atual.",
  });
  if (options.snapshot !== false) mkdirSync(join(dir, "snapshot", "src"), { recursive: true });
  return dir;
}

export interface CommandResult {
  code: number;
  stdout: string;
  stderr: string;
}

/** Runs the CLI in-process with a fake `query`. */
export async function run(argv: string[], profileDir: string | undefined, query: QueryFn, extra: { env?: NodeJS.ProcessEnv; timeoutMs?: number } = {}): Promise<CommandResult> {
  let stdout = "";
  let stderr = "";
  const env: NodeJS.ProcessEnv = { ...extra.env };
  if (profileDir !== undefined) env.VETERAN_PROFILE_DIR = profileDir;
  let code: number;
  try {
    code = await runCommand(argv, { env, stdout: (text) => (stdout += text), stderr: (text) => (stderr += text) }, { query, timeoutMs: extra.timeoutMs });
  } catch (error) {
    stderr += `veteran: ${(error as Error).message}\n`;
    code = 1;
  }
  return { code, stdout, stderr };
}

export function transcriptsOf(profileDir: string): string[] {
  const dir = join(profileDir, "transcripts");
  try {
    return readdirSync(dir).map((name) => join(dir, name));
  } catch {
    return [];
  }
}

export function readTranscript(path: string): Record<string, unknown>[] {
  return readFileSync(path, "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}
