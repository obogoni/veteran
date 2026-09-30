# Headless PoC (`veteran ask` / `veteran eval`)

> Build this with **tlc-implement**.
> Every criterion below becomes a check with a proof, referenced by its number. Nothing under
> `Unresolved` gets settled while building.

## Intent

Today Veteran cannot answer anything. A support question still goes to a developer, who runs the functional-explanation skill in Claude Code and relays the answer, then relays again for every "that's not what I see". The author cannot yet see whether a read-only agent over the filtered snapshot answers well, what a question costs, or how long it takes. The design doc's numbers (`maxTurns: 40`, `maxBudgetUsd: 1.00`, a 5-minute timeout) are guesses waiting for a p95 to recalibrate them. There is also a hole block 1 does not close: on a developer workstation the full repository, `.git` and excluded paths included, sits at `repoPath` next to the snapshot, and nothing yet stops an agent from reading outside the snapshot.

When this ships, an operator runs `veteran ask "<question>"` against a profile and gets an answer in business terms in the profile's language. The answer is split by branch, with suggested test scenarios, what it depends on, and the profile's version caveat. Every run leaves a JSONL transcript with its cost and duration. `veteran eval` runs the profile's eval cases and reports accuracy, cost and p50/p95 latency. Everything is proved on the example profile first. Pointing `VETERAN_PROFILE_DIR` at the real profile needs no code change. The author asked to see something working before curating the eval set, so this block runs ahead of block 2 (conversation of 2026-09-30).

The agent runs on the operator's Claude Code login under the company's Enterprise plan, never on an API key (author, 2026-09-30: "não podemos usar credencial de API").

23 criteria in 6 slices · 7 one-way doors · 7 open, of which 0 block

## Criteria

### `veteran ask` answers in the schema

1. Given the example profile with a built `snapshot/`, when `veteran ask "<question about the example codebase>"` runs, then it exits `0` and stdout shows, in this order, the answer, the branches (condition and behaviour each), the suggested tests, what it depends on, the caveats, and last the profile's `versionCaveat` verbatim. Headings are in `pt-BR` (Unresolved 3), and an empty list prints no heading.
2. Given the answer's `clarifyingQuestion` is not `null`, then stdout shows it as the first block, before the answer.
3. Always, `internalReferences` never appears on stdout or stderr; it is written only to the transcript.
4. Given the SDK result has `subtype: "success"` but `structured_output` is missing or fails the `VeteranAnswer` schema in Decided, when `veteran ask` runs, then it exits `1`, stderr says the answer did not match the schema, and nothing from the answer is printed.
5. When `veteran ask` runs with no question, an empty question, or more than one positional argument, then it exits `1` with the usage line and starts no agent.
6. Given `<VETERAN_PROFILE_DIR>/snapshot/` does not exist, when `veteran ask` runs, then it exits `1`, stderr says to run `veteran snapshot` first, and no agent is started.

### The agent is isolated from the machine it runs on

7. Always, the transcript's `system`/`init` message shows `tools` as exactly `Read`, `Grep` and `Glob` (any order), `mcp_servers` empty, `cwd` equal to the absolute path of `<VETERAN_PROFILE_DIR>/snapshot`, `model` equal to `claude-opus-5-5` and `permissionMode` equal to `dontAsk`.
8. Always, the `PreToolUse` hook denies any `Read`, `Grep` or `Glob` call whose target resolves outside `<VETERAN_PROFILE_DIR>/snapshot`. Targets are `file_path`, `path` and `pattern`/`glob`. A target is outside when it is absolute outside the snapshot, climbs out with `..`, or names `repoPath` or the profile directory. Calls inside the snapshot are allowed. Concretely, `Read ../repo/.specs/x.md`, `Read <repoPath>/README.md`, `Glob /etc/**` and `Grep path=..` are denied, and `Read src/app.ts` and `Glob **/*.ts` are allowed.
9. Given a question that asks the agent to read a file under `repoPath` or in an excluded path, when `veteran ask` runs, then the transcript shows the denial (a hook denial or `permission_denials` entry) for every such call, and no tool result in the transcript contains content from outside the snapshot.
10. Given the snapshot contains a `CLAUDE.md` and a `.claude/settings.json` that tell the agent to include the marker `VETERAN-INJECTED` in every answer, when `veteran ask` runs, then no field of the answer contains the marker and the `init` message shows `plugins` empty. The agent runs with `settingSources: []` and a custom system prompt (Decided).

### Limits stop a wandering run

11. If the run ends with `error_max_turns`, `error_max_budget_usd`, `error_max_structured_output_retries` or `error_during_execution`, or with an API error, then `veteran ask` exits `1` and stderr names that subtype or the API error status.
12. If the run has not produced a result 300 s after it started, then it is aborted through its `AbortController`, `veteran ask` exits `1`, and stderr says it timed out after 300 s.
13. Always, the query runs with `maxTurns: 40` and `maxBudgetUsd: 1.00`, as recorded in the transcript's summary line. Under a subscription `total_cost_usd` is the SDK's client-side estimate, and the budget limits that estimate.
23. Always, the environment `ask` and the rubric judge hand to the SDK has no `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN` or `ANTHROPIC_BASE_URL`, even when the operator's shell sets them. The run authenticates only through the Claude Code login on the machine, and the `init` message's `apiKeySource` is recorded in the transcript. If there is no login, the run ends on an authentication error and 11 applies, with stderr adding that Claude Code must be logged in (`claude` → `/login`) with the Enterprise account.

### Every run leaves a transcript

14. Always, whether the run succeeded, hit a limit or timed out, one new file `<VETERAN_PROFILE_DIR>/transcripts/<UTC timestamp>-<id>.jsonl` exists. It holds one line per SDK message in the order received, then a final `summary` line with `question`, `sessionId`, `subtype`, `total_cost_usd`, `duration_ms`, `num_turns`, `maxTurns`, `maxBudgetUsd`, the parsed answer or `null`, and `validation: []`, which block 4 fills.
15. When `veteran ask` exits, then stderr's last line carries the transcript path, the cost in USD and the duration in seconds.

### `veteran eval` scores the profile's cases

16. Given `<VETERAN_PROFILE_DIR>/evals/*.jsonl` in the format in Decided, when `veteran eval` runs, then it runs `ask` once for each case with `adversarial: false`, sequentially, and has the rubric judge score each answer against the case's `referenceAnswer`, `expectedBranches` and `<VETERAN_PROFILE_DIR>/evals/rubric.md`.
17. When `veteran eval` finishes, then stdout has one line per case (id, pass/fail for each rubric item, cost, seconds) and a summary line with accuracy as `passed/total` and a percentage, total cost in USD, and p50 and p95 of per-case `duration_ms` using nearest-rank. A case is accurate when `correct` passes and, where the case has `expectedBranches`, `byBranch` passes too.
18. Given a case whose `ask` fails (limit, timeout, schema), then that case counts as not accurate, its line says why, and the remaining cases still run. `veteran eval` exits `0` once every case has been attempted.
19. Given any eval line is not valid JSON or breaks the format, or ids repeat, or `rubric.md` is missing, when `veteran eval` runs, then it exits `1` naming every offending file and line in one run, and no agent is started.
20. Always, cases with `adversarial: true` are not run and are counted on the summary line as skipped. Leak scoring is block 4.

### The example profile runs end to end

21. Given a fresh clone, Playground cloned and the snapshot built as `profiles/example/README.md` instructs, when `VETERAN_PROFILE_DIR=profiles/example veteran eval` runs on a machine where Claude Code is logged in with the Enterprise account, then it exits `0` over at least 5 real cases in `profiles/example/evals/`, all about Playground's business areas, and `profiles/example/evals/rubric.md` holds the five items from the block 2 draft.
22. `profiles/example/README.md` gains the `veteran ask` and `veteran eval` commands. `README.md` documents both commands, that they need a Claude Code login and never read an API key, and that each `ask` stops at an estimated USD 1.00 and counts against the account's plan usage.

## Out of scope

- `--session` / `resume` and the 7-day session. These are spike 6. The transcript already records `sessionId`.
- Output validation (deterministic checks, the judge, regeneration, fallback) and leak rate. These are block 4. `validation` stays `[]`.
- Running the adversarial cases. That is block 4 (criterion 20).
- The container and network egress limits. That is block 5. Criterion 8 is the boundary until then.
- Transcript retention of 90 days (design *Open 3*). Nothing deletes transcripts yet.
- The real eval set. That is block 2, paused in `.tasks/eval-set.md`.
- Recalibrating the limits. That happens after the real eval set gives a p95.
- A `--json` output mode for `ask`. Not in the source.

## Observable

| Surface | Decision | Landing |
| --- | --- | --- |
| command `veteran ask` | output format and verbosity | 1, 2, 3, 15 |
| command `veteran ask` | every flag and its default | n/a - one positional question; the profile comes from `VETERAN_PROFILE_DIR`; `--session` is spike 6 |
| command `veteran ask` | exit codes | `0` in 1; `1` in 4, 5, 6, 11, 12 |
| command `veteran ask` | what it prints when it fails halfway | 11, 12, 15 - the transcript exists anyway (14) |
| command `veteran eval` | output format and verbosity | 17, 20 |
| command `veteran eval` | every flag and its default | n/a - no flags; cases come from the profile |
| command `veteran eval` | exit codes | `0` in 18, 21; `1` in 19 |
| command `veteran eval` | what it prints when it fails halfway | 18 (a case fails, the run continues); a crash or Ctrl-C mid-run is Unresolved 5 |
| document `README.md`, `profiles/example/README.md` | structure, what the reader does next | 22 |
| collection `profiles/example/evals/*.jsonl` | naming, duplicates, exception | 19 (unique ids, format); adversarial cases skipped (20) |

## Swept

- validation: 4, 5, 6, 19
- failure modes: 4, 11, 12, 18
- idempotency and retry: n/a - every `ask` is a new run with a new transcript; the SDK's own structured-output retries end in `error_max_structured_output_retries` (11), and no retry is added
- authorization: 7, 8, 9, 10 - who may run it is n/a (a local command); what the agent may reach is these
- concurrency and ordering: 16 (cases run sequentially); `ask` reading `snapshot/` while `veteran snapshot` replaces it is Unresolved 4
- data lifecycle: 14 (transcripts accumulate under the profile, git-ignored for the example by block 1); retention is Out of scope
- external-dependency failure: 11 (API error), 12 (hang)
- state transitions: n/a - a run has no lifecycle beyond result or abort
- observability: 13, 14, 15, 17 - p50/p95 latency and cost are reported per eval run, which is where the service target is measured

## Impact

| Front | What changes |
|---|---|
| domain | new term: `VeteranAnswer` - the structured answer in Decided; `internalReferences` never reaches stdout |
| domain | new term: `Transcript` - one JSONL per `ask` run in `<VETERAN_PROFILE_DIR>/transcripts/` |
| domain | existing term: `Snapshot` was only written by `veteran snapshot`, and now it is also the agent's `cwd` and its read boundary (8). Block 1's Unresolved 6 said this block decides the read-during-replace case, which is Unresolved 4 |
| docs | `.design/veteran.md` *Configuration isolation*: `cwd: "/repo"` is the container path (block 5). Running locally, `cwd` is `<VETERAN_PROFILE_DIR>/snapshot`. Amend the row |
| docs | `.tasks/eval-set.md` (paused): this block consumes its *Eval case format* and its draft accuracy rule (Unresolved 2 there). If block 2 changes either, `veteran eval` changes with it |
| stored data | nothing to migrate |
| tooling | new dependency `@anthropic-ai/claude-agent-sdk` (0.3.286 at planning time); a Claude Code login (Enterprise account) on the machine that runs `ask`/`eval` and their live proofs; no API key anywhere |

## Decided

| Decision | Shape | Alternative rejected |
|---|---|---|
| Agent runtime | `@anthropic-ai/claude-agent-sdk` `query()` with `model: "claude-opus-5-5"`, `tools: ["Read", "Grep", "Glob"]`, `disallowedTools: ["Bash", "Write", "Edit", "WebFetch", "WebSearch"]`, `settingSources: []`, `cwd: <VETERAN_PROFILE_DIR>/snapshot`, `maxTurns: 40`, `maxBudgetUsd: 1.00`, `outputFormat: { type: "json_schema", schema }`, a 300 s `AbortController` in the caller | Python SDK - design doc, one language |
| Answer shape | `VeteranAnswer = { answer: string, branches: {condition: string, behavior: string}[], suggestedTests: string[], clarifyingQuestion: string \| null, confidence: "high" \| "medium" \| "low", dependsOn: string[], caveats: string[], internalReferences: string[] }`, every field required, no extra fields; `versionCaveat` appended by the service, never asked of the model | Free text - design doc: branches and test scenarios come from the schema |
| Read boundary before the container | `permissionMode: "dontAsk"`, `allowedTools: ["Read", "Grep", "Glob"]`, and a `PreToolUse` hook that returns `permissionDecision: "deny"` for any target outside the snapshot (criterion 8). The hook is the enforcement; `cwd` is not a boundary | Relying on `cwd` or on the prompt - the Read tool accepts absolute paths, and the full repository with its `.git` sits at `repoPath` on the same machine. Waiting for block 5 - the author runs this locally now |
| System prompt | `systemPrompt` is a custom string: Veteran's base prompt (in this repository, English, telling the agent to answer in `profile.language`) followed by each `instructions` file of the profile in order. The `claude_code` preset is not used | The `claude_code` preset - it brings Claude Code's coding persona and environment sections, which assume a developer audience |
| Rubric judge | a second `query()` from the same SDK with `model: "claude-sonnet-5-5"`, `tools: []`, `settingSources: []`, `maxTurns: 1` and `outputFormat` of `{ correct, businessLevel, byBranch, admitsUncertainty, noLeak }`, each `{ pass: boolean, reason: string }` | `@anthropic-ai/sdk` for the judge - it needs an API key, which is ruled out |
| Authentication | Claude Code's own login on the machine (Enterprise plan). `env` passed to `query()` is `process.env` minus `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN` and `ANTHROPIC_BASE_URL` (criterion 23) | An API key from the Claude Console - ruled out by the author. `--bare` / a bare `claude -p` - bare mode "never reads OAuth credentials", so it cannot use the subscription |
| Eval case format (from `.tasks/eval-set.md`) | JSONL: `{ id: string, question: string, referenceAnswer: string, expectedBranches?: { condition: string, behavior: string }[], followUp?: { message: string, referenceAnswer: string }, tags: string[], adversarial: boolean }`; `followUp` is accepted and ignored until spike 6 | Defining it here separately - two formats would drift, and block 2's operator writes against that one |

## Surface

| Route | In | Out | Status | Criteria |
|---|---|---|---|---|
| `veteran ask "<question>"` | env `VETERAN_PROFILE_DIR`; `<dir>/profile.yaml`, `<dir>/snapshot/` | rendered answer on stdout; transcript path, cost, duration on stderr; `<dir>/transcripts/*.jsonl` | `0` answered, `1` any failure | 1-15 |
| `veteran eval` | env `VETERAN_PROFILE_DIR`; `<dir>/evals/*.jsonl`, `<dir>/evals/rubric.md` | per-case lines and summary on stdout; one transcript per case | `0` all cases attempted, `1` invalid eval files | 16-21 |

## Sources

- Issue #3, `Block 3: Headless PoC (veteran ask / veteran eval)`: what the block delivers.
- `.design/veteran.md`, *Decisions* rows *Agent tools*, *Configuration isolation*, *Per-run limits*, *Answer shape*, *Models*, and the *Adds* lines for `ask.ts`, `answerSchema.ts`, `writeTranscript.ts`, `runEvals.ts`, `rubricJudge.ts` and `cli.ts`, copied literally into Decided.
- `@anthropic-ai/claude-agent-sdk` 0.3.286 `sdk.d.ts` (read 2026-09-30). The options `tools`, `disallowedTools`, `allowedTools` ("to restrict which tools are available, use the `tools` option instead"), `settingSources` ("Pass `[]` to disable filesystem settings"), `permissionMode: 'dontAsk'` ("deny if not pre-approved"), `hooks`/`PreToolUse` with `permissionDecision: 'deny'`, `outputFormat` (`json_schema`), `maxTurns`, `maxBudgetUsd`, `abortController` and `systemPrompt` custom string. The result subtypes `success`, `error_max_turns`, `error_max_budget_usd`, `error_max_structured_output_retries`, `error_during_execution`, with `structured_output`, `total_cost_usd`, `duration_ms` and `num_turns`. The `init` message fields `tools`, `mcp_servers`, `cwd`, `model`, `permissionMode` and `plugins`.
- `.tasks/eval-set.md` (paused): the eval case format and the draft accuracy rule.
- `code.claude.com/docs/en/agent-sdk/overview` (fetched 2026-09-30): the note on claude.ai login for third-party products, quoted in Unresolved 1. `code.claude.com/docs/en/headless`: "bare mode doesn't use your subscription login", and "In bare mode, Claude Code never reads OAuth credentials or the system keychain".
- User in this conversation, 2026-09-30: "eu quero primeiro ver funcionando alguma coisa e refinar as perguntas depois", and "bloco 3 no example primeiro".

This task is the record of decision. If a linked document diverges, ask before building.

## Unresolved

| # | Kind | Question | Until answered |
|---|---|---|---|
| 1 | blocks go-live | May support analysts use Veteran on the operator's Enterprise seat? The Agent SDK docs say: "Unless previously approved, Anthropic does not allow third party developers to offer claude.ai login or rate limits for their products, including agents built on the Claude Agent SDK." Only the owner of the Enterprise contract can answer this, together with design *Needs an RFC 1* | Doesn't affect this block: the operator runs `ask` on their own login, like any Claude Code use. It blocks block 8 (support channel) and the real profile's pilot |
| 2 | open | What does accuracy count? This is block 2's Unresolved 2 | Written as `correct` plus `byBranch` where it applies (17) |
| 3 | open | How is stdout laid out for a language other than `pt-BR`? | Headings exist only in `pt-BR`. Any other `profile.language` makes `ask` exit `1` naming the language. The only profiles are `pt-BR` |
| 4 | open | `ask` reading `snapshot/` while `veteran snapshot` replaces it | Unguarded. One operator runs both by hand, and the replace is a rename |
| 5 | open | What does `veteran eval` leave when it is interrupted mid-run? | The transcripts of finished cases stay, and no partial summary is printed |
| 6 | open | What is the `effort` for the agent and the judge? | Left at the SDK default (`medium` on Opus 5.5) and recorded in the transcript's `init` line. The eval decides whether to raise it |
| 7 | open | How many example eval cases, and which questions? | At least 5 real cases over Playground's three business areas in `overview.md`. Content is chosen while building, since it is public and reversible |
