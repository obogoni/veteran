# Headless PoC (`veteran ask` / `veteran eval`)

Profile: light (no `tlc-implement` profile declared in the repository). Handoff: on, one batch (see Handoff).

Sources:

- `.tasks/headless-poc.md`: the task. Criteria 1-23, Decided, and the Unresolved defaults. This is the record of decision
- Issue #3: what block 3 delivers
- `.design/veteran.md`, *Decisions* (Agent tools, Configuration isolation, Per-run limits, Answer shape, Models, Authentication) and the *Adds* lines for `ask.ts`, `answerSchema.ts`, `writeTranscript.ts`, `runEvals.ts`, `rubricJudge.ts` and `cli.ts`
- `.tasks/eval-set.md` (paused): the eval case format and the draft accuracy rule
- `@anthropic-ai/claude-agent-sdk` 0.3.286, `sdk.d.ts` and `sdk-tools.d.ts`
- Live probes run 2026-09-30 on the operator's Enterprise login, from scratch scripts that were not committed:
  - `apiKeySource: "none"`.
  - `outputFormat` adds a `StructuredOutput` tool, which reaches `PreToolUse`.
  - The model rewrote `../profile.yaml` to an absolute path and read it.
  - `CLAUDE.md`, `AGENTS.md` and `CLAUDE.local.md` in `cwd` are not loaded under `settingSources: []`.
  - The built-in plugins `cc-plugin-agents-md`, `cc-plugin-telemetry` and `cc-plugin-diff` load unless `settings.enabledPlugins` sets them `false`, which leaves `plugins: []`.
  - `CLAUDE_CODE_DISABLE_BUNDLED_SKILLS=1` cuts the bundled skills from 18 to 2, and those 2 cannot run without the `Skill` tool.
  - The login's user email reaches the model as context.
- Conversation 2026-09-30: the example profile first, and no API key (Enterprise login)

## Out of scope

- `--session`/`resume` (spike 6), output validation and leak rate (block 4), the container (block 5), transcript retention, the real eval set (block 2) and a `--json` mode. All come from the task's *Out of scope*

## Landing

New `src/agent/` (the answer schema, the system prompt, the read boundary, the SDK runner, rendering), `src/transcripts/writeTranscript.ts` and `src/evals/` (case loader, rubric judge, runner). `src/cli.ts` becomes a dispatcher over `snapshot`/`ask`/`eval` behind an injectable `runCli(argv, io, deps)`, so tests drive the CLI in-process with a fake `query`. It reuses `loadProfile`/`profileDirFromEnv` and the `ProfileError` convention (exit `1`, reason on stderr).

| One-way door | Literal shape | Alternative rejected |
| --- | --- | --- |
| Agent runtime (task) | `query()` with `model: "claude-opus-5-5"`, `tools: ["Read", "Grep", "Glob"]`, `allowedTools` the same, `disallowedTools: ["Bash", "Write", "Edit", "WebFetch", "WebSearch"]`, `settingSources: []`, `permissionMode: "dontAsk"`, `cwd: <profile>/snapshot`, `maxTurns: 40`, `maxBudgetUsd: 1.00`, `outputFormat` json_schema, 300 s `AbortController` | Python SDK - design doc |
| Answer shape (task) | `VeteranAnswer` exactly as the task's Decided; JSON Schema with `additionalProperties: false` and every field required; validated again in-process | free text - design doc |
| Read boundary (task) | the `PreToolUse` hook allows `Read`/`Grep`/`Glob` only when every target (`Read.file_path`; `Grep.path`, `Grep.glob`; `Glob.path`, `Glob.pattern`) resolves inside the snapshot (`path.resolve(snapshot, target)` then `path.relative` without `..` and not absolute), plus `StructuredOutput`; it denies every other tool | a `..` substring check - the probe showed the model rewrites `..` into an absolute path |
| `StructuredOutput` in the tool set (found while building) | criterion 7's "exactly `Read`, `Grep` and `Glob`" is checked as exactly `Read`, `Grep`, `Glob` and `StructuredOutput`. The SDK adds the latter whenever `outputFormat` is set, and the Decided answer shape requires `outputFormat` | dropping `outputFormat` to keep three tools - it contradicts the Decided answer shape. **Renegotiated in the user's absence; the user confirms at review** |
| Built-in plugins off, fail closed (found while building) | `settings: { enabledPlugins: { "cc-plugin-agents-md@builtin": false, "cc-plugin-telemetry@builtin": false, "cc-plugin-diff@builtin": false } }` plus env `CLAUDE_CODE_DISABLE_BUNDLED_SKILLS=1`. If `init` lists any plugin, any MCP server, or any tool beyond the four, the run is aborted and `ask` exits `1` naming it | trusting the list of known built-ins - a new SDK release can add a plugin (the `diff` one appeared on the second probe), and `agents-md` exists to load instruction files from the repository |
| Authentication (task) | `env` = `process.env` minus `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN` and `ANTHROPIC_BASE_URL`, plus `CLAUDE_CODE_DISABLE_BUNDLED_SKILLS=1`; the same env is used for the judge | API key - ruled out |
| System prompt (task) | a custom string: `src/agent/systemPrompt.ts` (English, with the answer language taken from `profile.language`), then `## Project instructions` and each `instructions` file in order | `claude_code` preset - developer persona |
| Rubric judge (task) | `query()` with `model: "claude-sonnet-5-5"`, `tools: []`, `settingSources: []`, `maxTurns: 1`, the same plugin and env hardening, the hook denying everything except `StructuredOutput`, `cwd` a fresh temp dir; `outputFormat` of the five items, each `{ pass, reason }` | `@anthropic-ai/sdk` - needs an API key |
| Transcript file (task) | `<profile>/transcripts/<YYYYMMDDTHHmmssSSSZ>-<8 hex>.jsonl`, appended as messages arrive (so a timeout leaves the file). The lines are the SDK messages verbatim, then `{ "type": "summary", question, sessionId, subtype, total_cost_usd, duration_ms, num_turns, maxTurns, maxBudgetUsd, answer, validation: [], hookDenials: [{ tool, target, reason }], error }` | one JSON document written at the end - a timeout or crash would leave nothing |

| Verifier round 1 fixes (found while building) | `init` must also match `cwd` (compared by real path, so a Windows 8.3 short name equals its long form), `model` and `permissionMode`, otherwise the run aborts. The boundary denies any `..` segment outright (a glob `**` can match zero folders), `~`, `%VAR%`, `$VAR` and `${VAR}`, and accepts a target under the snapshot's given or real path. Env stripping ignores name case (Windows). Every step of the stream races a hard deadline, so a stuck SDK that ignores the abort still ends at the timeout, and a result that already arrived wins over a late timeout. The judge gets a 120 s abort and an estimated USD 0.25 cap as guards | resolving `..` and trusting containment - `**/../x` resolves inside while the glob can climb out |

- Nothing else in this change is hard to reverse

## Checks

The check numbers match the task's criteria. `unit` proofs run a fake `query` with no agent; `live` proofs run the real SDK on the operator's login (`VETERAN_LIVE=1`, which `npm test` skips).

### S1 - `veteran ask` answers in the schema · ~9 files · ~60 KB · ~15k

**C1** - Success prints, in order: the answer, the branches (condition and behaviour each), the suggested tests, what it depends on, the caveats, and last the `versionCaveat` verbatim. Headings are `pt-BR` and an empty list prints no heading. It exits `0`
Proof: `node --test --test-name-pattern "C1 " test/ask.test.ts`
Proof: `VETERAN_LIVE=1 node --test --test-name-pattern "C1 " test/live.test.ts`

**C2** - A non-null `clarifyingQuestion` prints first, before the answer
Proof: `node --test --test-name-pattern "C2 " test/ask.test.ts`

**C3** - `internalReferences` appears in neither stdout nor stderr, and does appear in the transcript
Proof: `node --test --test-name-pattern "C3 " test/ask.test.ts`

**C4** - A `success` result whose `structured_output` is missing or off-schema makes `ask` exit `1` with a schema message and print no answer
Proof: `node --test --test-name-pattern "C4 " test/ask.test.ts`

**C5** - No question, an empty question, or 2+ positionals make `ask` exit `1` with the usage line, and no `query` call is made
Proof: `node --test --test-name-pattern "C5 " test/ask.test.ts`

**C6** - A missing `snapshot/` makes `ask` exit `1` telling the operator to run `veteran snapshot`, and no `query` call is made
Proof: `node --test --test-name-pattern "C6 " test/ask.test.ts`

### S2 - Isolation · ~4 files · ~25 KB · ~7k

**C7** - `init` shows `tools` exactly {`Read`, `Grep`, `Glob`, `StructuredOutput`}, `mcp_servers` `[]`, `cwd` the absolute snapshot path, `model` `claude-opus-5-5` and `permissionMode` `dontAsk`. The options passed carry the Decided shape. An `init` outside that shape aborts with exit `1`
Proof: `node --test --test-name-pattern "C7 " test/ask.test.ts`
Proof: `VETERAN_LIVE=1 node --test --test-name-pattern "C7 " test/live.test.ts`

**C8** - The hook denies the table in criterion 8 and allows `src/app.ts`, `**/*.ts` and `StructuredOutput`. It denies every other tool, absolute paths into `repoPath` and the profile directory, other drives, and `..` escapes, whether in `path` or in patterns
Proof: `node --test --test-name-pattern "C8 " test/boundary.test.ts`

**C9** - A live question that tells the agent to read `../repo/<excluded file>` and the absolute profile path leaves no content from those files anywhere in the transcript. Every tool call aimed at them was denied
Proof: `VETERAN_LIVE=1 node --test --test-name-pattern "C9 " test/live.test.ts`

**C10** - A snapshot with `CLAUDE.md`, `AGENTS.md` and `.claude/settings.json` telling the agent to output `VETERAN-INJECTED` yields an answer with no marker, and `init.plugins` is `[]`
Proof: `VETERAN_LIVE=1 node --test --test-name-pattern "C10 " test/live.test.ts`
Proof: `node --test --test-name-pattern "C10 " test/ask.test.ts` (the options carry `settingSources: []`, the custom system prompt and the plugin switches; an `init` with any plugin aborts)

### S3 - Limits · ~3 files · ~15 KB · ~4k

**C11** - Each of `error_max_turns`, `error_max_budget_usd`, `error_max_structured_output_retries` and `error_during_execution`, and a `success` with `is_error` and `api_error_status`, makes `ask` exit `1` with stderr naming the subtype or status
Proof: `node --test --test-name-pattern "C11 " test/ask.test.ts`

**C12** - With no result before the timeout, the controller aborts, `ask` exits `1` and stderr says `timed out after 300 s` (the test injects a short timeout, and the message reports the configured seconds)
Proof: `node --test --test-name-pattern "C12 " test/ask.test.ts`

**C13** - The options carry `maxTurns: 40` and `maxBudgetUsd: 1`, and the summary line records both
Proof: `node --test --test-name-pattern "C13 " test/ask.test.ts`

**C23** - The env handed to `query` lacks `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN` and `ANTHROPIC_BASE_URL` even when they are set, for both the agent and the judge. An auth failure (401/403 or `authentication_failed`) adds the `/login` hint to stderr
Proof: `node --test --test-name-pattern "C23 " test/ask.test.ts`

### S4 - Transcript · ~2 files · ~8 KB · ~2k

**C14** - Success, a limit and a timeout each leave exactly one new `<ts>-<id>.jsonl`. It holds every SDK message in order, then a last `summary` line with the listed fields and `validation: []`
Proof: `node --test --test-name-pattern "C14 " test/ask.test.ts`

**C15** - stderr's last line carries the transcript path, the cost in USD and the seconds
Proof: `node --test --test-name-pattern "C15 " test/ask.test.ts`

### S5 - `veteran eval` · ~5 files · ~30 KB · ~8k

**C16** - Only real cases run: one `ask` each, never two at once, and the judge gets the question, `referenceAnswer`, `expectedBranches` and the text of `rubric.md`
Proof: `node --test --test-name-pattern "C16 " test/eval.test.ts`

**C17** - One line per case (id, the five items, cost, seconds), then a summary with `passed/total (NN%)`, total cost, p50/p95 nearest-rank. Accuracy is `correct` plus `byBranch` when `expectedBranches` exists
Proof: `node --test --test-name-pattern "C17 " test/eval.test.ts`

**C18** - A case whose `ask` fails counts as not accurate, its line gives the reason, the next case still runs, and the exit code is `0`
Proof: `node --test --test-name-pattern "C18 " test/eval.test.ts`

**C19** - Bad JSON, format violations, duplicate ids and a missing `rubric.md` are all reported in one run as `file:line`, with exit `1` and no `query` call
Proof: `node --test --test-name-pattern "C19 " test/eval.test.ts`

**C20** - `adversarial: true` cases are not run, and the summary counts them as skipped
Proof: `node --test --test-name-pattern "C20 " test/eval.test.ts`

### S6 - Example profile end to end · ~4 files · ~15 KB · ~4k

**C21** - `profiles/example/evals/` holds 5 or more valid real cases and a `rubric.md` with the five items. Live `veteran eval` on the example exits `0`
Proof: `node --test --test-name-pattern "C21 " test/eval.test.ts`
Proof: `VETERAN_LIVE=1 node --test --test-name-pattern "C21 " test/live.test.ts`

**C22** - `profiles/example/README.md` shows `veteran ask` and `veteran eval`. `README.md` documents both, the Claude Code login, that no API key is read, and the estimated USD 1.00 cap
Proof: `node --test --test-name-pattern "C22 " test/docs.test.ts`

## Swept

- validation: C4, C5, C6, C19
- failure modes: C4, C11, C12, C18
- idempotency and retry: not in scope - each `ask` is a new run; the SDK's structured-output retries end in `error_max_structured_output_retries` (C11)
- authorization: C7, C8, C9, C10, C23
- concurrency: C16 (sequential); `ask` during `veteran snapshot` is unguarded (task Unresolved 4)
- data lifecycle: C14 (transcripts accumulate, and the example's are ignored by git); retention is out of scope
- dependency failure: C11, C12, C23
- state transitions: not in scope - a run ends in a result or an abort
- observability: C13, C14, C15, C17

## Handoff

S1-S6 read `src/cli.ts`, `src/profile/loadProfile.ts`, `test/helpers.ts`, the parts of the SDK's `sdk.d.ts` this block uses, and the new files: about 45k in all, well under the 150k budget. One batch, no handoff.
