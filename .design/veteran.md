# Veteran

> Plan this with **tlc-plan**.
> Decisions below carry the literal shape - copy them, do not re-derive them.

Veteran is the "veteran senior dev" who answers questions from non-technical people about business rules that are documented only in the code. It answers in business terms and never hands out code snippets, internal names or secrets. It is codebase-agnostic: everything specific to one project lives in a **profile** kept outside this repository.

## Situation

- Project: not shipped. The repository is empty (no commits) and its remote, `github.com/obogoni/veteran`, is personal.
- Decision: committed by the author on 2026-09-30, based on a 7-phase roadmap (eval set → headless PoC → hardening → service → bot → MCP → operate).
- In flight: the target codebase already has a "functional explanation" skill that developers run inside Claude Code. It has 13 format-only evals (no reference answers, no adversarial cases), and it ends every answer by offering "technical details on request". Veteran reuses its content (analysis flow, style rules, module map) as the first profile, but **drops the offer of technical details**.
- At stake: expensive to get wrong, but not a one-way door. The audience is internal (support), so leaking a table name is noise rather than an incident. Leaking a secret (connection string, gateway key) cannot be undone in any case. The code belongs to the employer, which constrains **where** the service may run (see Needs an RFC).

## Problem

This is a construction problem on top of a pain that already exists. Today, support asks a developer, the developer runs the skill in Claude Code and relays the answer. When the answer contradicts what support observes, the developer goes back to the AI and relays again. The developer has become a human proxy for a conversation support could have on its own.

The real case behind the project: support asked "does the card return option deactivate the card?". The answer was "yes". Support replied "it doesn't", and only then did it come out that the behavior depends on the card type. The failure was answering without splitting the cases. Leaking code was not the problem.

There is a second pain: before asking, support spends time **testing scenarios by hand**, because nobody tells them which variations matter.

Without Veteran, every question keeps costing a developer interruption, plus one more for each back-and-forth, and support keeps testing blind.

## Evidence

- Questions per week and developer minutes per question: **not measured by anyone**. The author's estimate is "a lot", but this is missing instrumentation, not evidence that the problem is small. Veteran itself will log conversations and escalations to measure it (see Success).
- Time support spends testing before asking: not measured, and only asking support during the pilot will tell.
- The target codebase is ~21 GB and has 100+ per-customer patch branches, with commits as recent as 2026-07. Behavior may differ per customer. That makes a caveat mandatory on every answer, and it means searches will be slow (tens of seconds to minutes).
- The existing skill was written by a single author across 8 commits: stable content that can be reused as a profile.

## Journey

Confirmed sequence: a support analyst asks a question in natural language → waits → gets an answer → continues the conversation alone until it is resolved or escalated to a developer.

- **Question sent:** acknowledge immediately ("looking into it, usually 1–2 min") and show progress. A silent wait of several minutes reads as a hang.
- **Behavior depends on type, configuration or data:** answer **by branch** ("type A: does not deactivate; type B: deactivates; checkout and loss: always deactivate"). Each branch becomes a **suggested test scenario**, which addresses the second pain.
- **Question too ambiguous to split into branches:** ask **one** clarifying question instead of picking a case.
- **Contradiction ("that's not what I see"):** support replies in the same conversation with the new context, and Veteran re-analyzes with the history. This is the core state of the product.
- **Observed behavior differs from the code:** the answer states what the code does in the current version and that the difference may be a defect or a customer-specific patch. It does not claim which.
- **Code does not cover it (behavior comes from configuration or data):** say "this depends on configuration/data", name which, and do not invent.
- **Request for code, a table, a file or a secret:** short refusal, and offer the functional explanation instead.
- **Validation fails twice:** fixed fallback ("I couldn't answer this safely, take it to a developer") plus escalation text ready to paste.
- **Conversation resumed the next day:** the conversation stays available for 7 days, then starts over.
- **Every answer** carries the version caveat: "behavior of the current version; customers with their own patch may differ".

## Verdict

Already committed - see Situation.

Cheaper paths considered:
- Give support Claude Code with the existing skill on a read-only clone. It removes the bottleneck in a day, but it hands support a shell and the whole codebase, and the skill offers technical details. That is exactly what this project exists to prevent. Discarded as the product.
- A curated FAQ written by developers. It does not cover the long tail, which is where the real case came from. It stays as roadmap Phase 7 (a knowledge base consulted first), not as a substitute.
- Buy: codebase Q&A products exist, but they target developers and show code. No survey was done. I know of none aimed at non-technical users with a no-code guarantee, and that was not verified.

## Success

- Worked if: over the first 4 weeks of the pilot, ≥ 70% of support conversations end without escalating to a developer.
- Early signal: in the first week, support confirms the by-branch answers in the test environment. If more than 1 in 5 answers comes back with "that's not what I see", the bet is going wrong.
- Review: 4 weeks after the pilot starts. Reviewed by: the author.
- Not measurable today: there is no "before" number. The proxy is a drop in "quick question" messages developers get in chat. The instrumentation (conversation log, escalation button and count, thumbs up/down) is part of this work.
- Before the pilot (a quality gate, not the success measure): ≥ 80% accuracy on the real eval set and 0 secret leaks on the adversarial set.

## Boundary

In: eval set, headless PoC, project profile, filtered code snapshot, sandbox, input and output validation, multi-turn conversation, and a minimal channel for support to use in the pilot.
Out:
- Answers per customer version or branch: answer against the main branch, with a caveat. It becomes its own discovery after the pilot.
- External audience (customers): would need a different level of validation and its own discovery.
- MCP server: comes after the service is stable (roadmap Phase 6).
- Curated knowledge base: Phase 7, fed by the pilot logs.
- Async queue, daily budget and SSO: pilot volume (a handful of analysts) does not justify them.

## Prior art

- The source roadmap (Phases 0–7): we take the ordering (evals before the product, sandbox before exposure) and the layered, fail-closed validation pipeline.
- The failure the roadmap itself reports: a prompt instruction is not a guarantee. Here that becomes **physical** path exclusion in the snapshot, not a rule in the prompt.
- The roadmap assumes a company with SSO, a queue and a corporate chat bot. We share neither the scale nor the SSO, so the shape stays a single process.
- Web search for comparable products: not checked. Only the Agent SDK documentation was consulted.

## Shape

The bet: **a single TypeScript process**, where the Agent SDK runs one read-only agent over a **filtered snapshot** of the codebase. All project-specific knowledge lives in an **external profile** outside the repository. The same `ask` function serves the CLI, the eval runner and later the pilot chat. Changing the transport later (CLI → HTTP → bot) is cheap; changing the answer shape (the schema) is expensive. That is why the schema is decided here.

### Adds

- `package.json`, `tsconfig.json`: Node/TypeScript project depending on `@anthropic-ai/claude-agent-sdk`.
- `src/profile/loadProfile.ts`: reads `<VETERAN_PROFILE_DIR>/profile.yaml` (fields in Decisions).
- `src/snapshot/buildSnapshot.ts`: `veteran snapshot` command. Copies the profile's `ref` into a staging directory applying `excludePaths` (no `.git`, no symlinks), runs gitleaks with Veteran's own configuration and **aborts** on any finding or scan error; only a clean staging replaces `<VETERAN_PROFILE_DIR>/snapshot/`.
- `config/gitleaks.toml`: Veteran's gitleaks configuration (`[extend] useDefault = true`), passed explicitly on every scan so no configuration is ever read from the snapshot.
- `src/agent/ask.ts`: `ask({ profile, question, sessionId? }) → VeteranAnswer` via `query()`, with the literal options in Decisions.
- `src/agent/answerSchema.ts`: JSON Schema for `VeteranAnswer`.
- `src/validate/deterministic.ts`: blocks code fences, file paths, CamelCase/snake_case identifiers with dots or parentheses, SQL keywords, stack-trace shapes, secret patterns and the profile's `denyTerms`. Secrets are found by `gitleaks stdin` with Veteran's configuration (`src/validate/secrets.ts`), not by a pattern list of its own (`.tasks/output-validation.md`).
- `src/validate/judge.ts`: one judge call ("does this reveal implementation details beyond business behavior?").
- `src/validate/pipeline.ts`: deterministic → judge → on failure regenerate once with feedback → on second failure, fallback. A check that cannot reach a verdict goes straight to the fallback. Never returns a flagged answer.
- `src/transcripts/writeTranscript.ts`: one JSONL per run in `<VETERAN_PROFILE_DIR>/transcripts/`, with the SDK messages, `total_cost_usd`, `duration_ms` and each validation result.
- `src/evals/runEvals.ts` + `src/evals/rubricJudge.ts`: `veteran eval` command. Runs `<VETERAN_PROFILE_DIR>/evals/*.jsonl` and reports accuracy, leak rate, cost and latency (p50/p95).
- `src/cli.ts`: `veteran ask "<question>" [--session <id>]`, `veteran eval`, `veteran snapshot`.
- `Dockerfile` + `compose.yaml`: non-root user, snapshot mounted read-only at `/repo`, network egress allowed only to `api.anthropic.com`. The image ships `gitleaks`, which `ask` runs on every answer.
- `profiles/example/`: an example profile over the author's public `obogoni/playground` repository, cloned into `profiles/example/repo/` and pinned to a commit. The real profile never enters git.
- `.gitignore`: ignores `profiles/*` except `profiles/example/`, plus the example's `repo/`, `snapshot/` and `transcripts/` (anchored there, since a bare `snapshot/` would also ignore `src/snapshot/`).

### Changes

Nothing. The repository is empty.

### Leaves

- Per-customer or per-version resolution, MCP, async queue, SSO and the curated knowledge base: listed in Boundary Out.
- The existing skill in the target codebase stays as is, for developers. Veteran only copies its content into the profile.

Every Journey state has a home: by-branch answers, test scenarios and the clarifying question → the `branches`, `suggestedTests` and `clarifyingQuestion` fields of the schema. Contradiction and next-day resume → `sessionId`/`resume`. Code requests and fallback → `pipeline.ts`. "Depends on configuration" → `dependsOn`. Version caveat → `versionCaveat`, filled from the profile, not by the model. Immediate acknowledgement and progress → the channel (Needs design).

The heavier alternative is the full roadmap: an async HTTP service with a queue and a separate worker, a corporate chat bot, SSO and a worktree per customer version. It wins when there are dozens of concurrent users or when per-customer answers become mandatory. Today the pilot is a handful of analysts and per-customer versions are out of scope. The light shape will not survive per-customer answers or high concurrency. What would force a rewrite is opening it to many teams at once, and even then `ask` and `pipeline` survive: only the transport changes.

Also in the field, for perspective and not as candidates: RAG over code embeddings, removed because "it depends on the type" requires following the flow, not finding similar snippets. Multi-agent orchestration, removed because the roadmap says to split only when an eval shows a failure that splitting fixes.

## Roadmap

| Block | Delivers | Clarity |
|---|---|---|
| 1. Profile + filtered snapshot | `veteran snapshot` produces a snapshot with no excluded paths and no detected secrets; the example profile works | clear |
| 2. Eval set | ≥ 40 real questions (from chat history, with the answer a developer gave) + ≥ 20 adversarial ones, and a rubric, in the real profile | clear |
| 3. Headless PoC | `veteran ask` answers in the schema and writes the transcript; `veteran eval` reports accuracy, cost and latency | clear |
| 4. Output validation | `pipeline.ts` failing closed; leak rate as a separate metric in `veteran eval` | clear |
| 5. Sandbox | `compose.yaml` runs `ask` as a non-root user, read-only, with egress only to the API | clear |
| 6. Multi-turn conversation | follow-ups with `resume` keep quality in the contradiction case | spike |
| 7. Where the pilot runs | an authorized decision on the machine/infrastructure that hosts the employer's code | rfc |
| 8. Support channel | support converses with no developer in the middle: acknowledgement, progress, branches, escalation | design |

## Decisions

| Decision | Choice | Why this | Alternative, and what would make it win | Reversibility |
|---|---|---|---|---|
| Language and runtime | TypeScript on Node, `@anthropic-ai/claude-agent-sdk` | One language for agent, validation and the pilot web chat | Python SDK, if the author prefers it; there is no code yet | costly |
| Authentication | Claude Code login under the company Enterprise plan; no API key (`ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`, `ANTHROPIC_BASE_URL` stripped from the agent env) | The author cannot use API credentials (2026-09-30) | An API key, if the pilot needs one (see Needs an RFC 1) | costly |
| Agent tools | `tools: ["Read", "Grep", "Glob"]`, `disallowedTools: ["Bash", "Write", "Edit", "WebFetch", "WebSearch"]` | What the agent cannot reach cannot leak; `allowedTools` alone does not restrict | None: a shell "just for grep" is the roadmap's anti-pattern | reversible |
| Configuration isolation | `settingSources: []`, `cwd: "/repo"` inside the container (block 5); running locally, `cwd` is `<VETERAN_PROFILE_DIR>/snapshot` and a `PreToolUse` hook denies reads outside it (`.tasks/headless-poc.md`) | The target codebase ships agent instruction files; loading them would be injection from the repository itself. Locally, the full repository sits at `repoPath` on the same machine, so `cwd` alone is not a boundary | None | reversible |
| Per-run limits | `maxTurns: 40`, `maxBudgetUsd: 1.00`, 5 min timeout in the caller | A large repository makes the agent wander; values are recalibrated from the eval p95 | Higher, if the eval shows truncated answers | reversible |
| Answer shape | `outputFormat: { type: "json_schema", schema }` with `VeteranAnswer = { answer: string, branches: {condition: string, behavior: string}[], suggestedTests: string[], clarifyingQuestion: string \| null, confidence: "high" \| "medium" \| "low", dependsOn: string[], caveats: string[], internalReferences: string[] }`; `versionCaveat` appended by the service | By-branch answers and test scenarios come from the schema, not free text; `internalReferences` never reaches support | Free text, if the schema degrades quality in the eval | costly |
| Conversation | SDK `resume: <sessionId>`; session valid for 7 days | Contradiction is the core state; the session keeps what was already read | Re-send a summarized history with each question, if spike 6 shows poor cost or quality | reversible |
| Path exclusion | Physical: `excludePaths` applied when copying the snapshot (no `.git`, no symlinks) + gitleaks aborts the snapshot. gitleaks runs as `gitleaks dir <staging> --config config/gitleaks.toml --gitleaks-ignore-path <empty dir outside the snapshot> --ignore-gitleaks-allow --redact` | "If the agent can't read it, no injection can extract it". Without `--config`, gitleaks loads a `.gitleaks.toml` from the scanned directory, and it honours `.gitleaksignore` and `gitleaks:allow` comments, so the target repository could allowlist its own secrets - the same injection `settingSources: []` closes for the agent. gitleaks also reads `.gitleaksignore` at the root of whatever it scans, despite `--gitleaks-ignore-path`, so it scans a directory one level above the tree; and it exits `0` when it cannot read its target, so a fresh canary secret planted per run must be reported for the scan to count | Per-tool deny: rejected, because it depends on the SDK obeying | costly |
| Profile | `profile.yaml`: `name`, `repoPath`, `ref`, `language: "pt-BR"`, `instructions: [.md files]`, `excludePaths: [glob]`, `denyTerms: [string]`, `versionCaveat: string`; directory via `VETERAN_PROFILE_DIR` | Agnostic by boundary, without generalizing before a 2nd codebase; the real profile stays out of the personal repo | One profile per codebase inside the repo: only for public codebases | costly |
| Models | Agent `claude-opus-5-5`; judges (validation and rubric) `claude-sonnet-5-5` | Reading code precisely is the bottleneck; the judge does a cheap classification | Opus judge, if agreement with developers stays below 80% | reversible |
| Fail closed | 1 regeneration with feedback; on second failure, or when a check reaches no verdict, fixed fallback + escalation text | Never deliver a flagged answer | None | reversible |
| Code version | Profile `ref` = main branch; `versionCaveat` on every answer | Resolving customer → branch doubles the infrastructure before accuracy is proven | Per-customer resolution, once the pilot shows errors caused by patches | reversible |
| Work tracking | One GitHub issue per Roadmap block, linking to this doc's section, with no names or data from the target codebase | The repository is personal and public | — | reversible |
| Artifact language | English for docs, code, commits and issues; answers to end users follow the profile's `language` | Public repository | — | reversible |

## Needs an RFC

1. Where the pilot runs and who authorizes it. The snapshot contains the employer's code, and running it on personal infrastructure is not acceptable without authorization. The options are the developer's workstation, a company VM or the company cloud. This blocks blocks 5 (in its final form) and 8, and the decision belongs to whoever owns the code, not to the author. It must also settle whether support may use Veteran on an Enterprise seat: the Agent SDK docs say that "unless previously approved, Anthropic does not allow third party developers to offer claude.ai login or rate limits for their products, including agents built on the Claude Agent SDK". Inside the container (block 5), how the login reaches the agent is also open.

## Needs a spike

1. Multi-turn conversation via `resume`: does a contradiction follow-up ("that's not what I see, it's type B") produce the correct answer at ≤ 50% of the cost of the first question? If yes, `resume` stays. If not, send a conversation summary with a fresh run. The spike stops after running 10 contradiction cases from the eval set.

## Needs design

1. Support channel (minimal web chat vs. corporate chat bot). The design has to answer these Journey states: immediate acknowledgement and progress during multi-minute waits, display of branches and test scenarios, the clarifying question, the fallback with an escalation button, and the conversation resumed the next day. It depends on RFC 1, because where it is hosted limits which channels are possible.

## Open

1. Eval set format: JSONL with `{ id, question, referenceAnswer, expectedBranches?, tags, adversarial: boolean }`. Decided while building block 2.
2. End-user answer language: `pt-BR`, from the profile.
3. Transcript retention: 90 days in the profile directory.

## Sources

- The 7-phase roadmap provided by the author (conversation of 2026-09-30): phase ordering, validation pipeline, sandbox recommendations.
- gitleaks README, `github.com/gitleaks/gitleaks` (read 2026-09-30): configuration precedence ending in "a `.gitleaks.toml` file within the target path", `--gitleaks-ignore-path` defaulting to `.`, `--ignore-gitleaks-allow`, `--redact`.
- Agent SDK TypeScript documentation, `code.claude.com/docs/en/agent-sdk/typescript`: `tools`, `disallowedTools`, `allowedTools` ("does not restrict Claude to only these tools"), `maxTurns`, `resume`, `outputFormat`/`structured_output`, `settingSources`, `maxBudgetUsd`, `total_cost_usd`, `duration_ms`.
- The existing functional-explanation skill in the target codebase, read locally and not quoted here: analysis flow, style rules and the 13 format evals.
- A real support ↔ developer conversation (screenshot provided by the author): the unbranched-answer case.
