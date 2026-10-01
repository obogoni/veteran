# Output validation pipeline (fail closed)

Profile: light (no `tlc-implement` profile declared in the repository). Handoff: on, one batch (see Handoff).

Sources:

- `.tasks/output-validation.md`: the task. Criteria 1-26, Decided, and the Unresolved defaults. This is the record of decision
- Issue #4: what block 4 delivers
- `.design/veteran.md`: the *Adds* lines for `deterministic.ts`, `judge.ts` and `pipeline.ts`, *Journey* (the fallback), *Decisions* *Models* and *Fail closed*, and *Success* (the gate)
- `.tasks/headless-poc.md` *Unresolved 8* and *9a-9c*, and `.checks/headless-poc.verified.md` R1-R3
- `profiles/example/evals/rubric.md`: `noLeak` applies to every case and feeds the leak rate
- `@anthropic-ai/claude-agent-sdk` 0.3.286 `sdk.d.ts` (`resume`), and `gitleaks` 8.30.1 (`stdin`)
- Conversation 2026-10-01: gitleaks rather than a regex list "until it becomes a real need". Block 4 does not wait for spike 6

## Out of scope

- Input validation, the boundary's false denials (block 3 9d), the C21 `FAILED:` hygiene (block 3 9e), checking `versionCaveat`, severity thresholds, languages other than `pt-BR`, limit recalibration and block 2's content. All come from the task's *Out of scope*

## Landing

New `src/validate/`: `deterministic.ts` (the user-facing fields and the regex rules), `secrets.ts` (gitleaks over stdin, reusing the env stripping, config path and canary idea of `src/snapshot/scan.ts`), `judge.ts` (the validation judge) and `pipeline.ts` (attempts, regeneration, fallback). `ask()` keeps its signature and runs the pipeline, so `commands.ts` and `runEvals.ts` keep calling `ask`. The judge deadline race moves into a shared helper in `src/agent/sdk.ts` that the rubric judge also uses. `test/fakes.ts` answers validation-judge calls with a pass by default, recorded apart from `calls`, so block 3's call-count assertions keep their meaning.

| One-way door | Literal shape | Alternative rejected |
| --- | --- | --- |
| Secret detection (task) | `gitleaks stdin --config config/gitleaks.toml --gitleaks-ignore-path <empty temp dir> --ignore-gitleaks-allow --redact --no-banner --no-color --report-format json --report-path <temp>/report.json --exit-code 42`. Stdin is the checked fields joined with newlines plus one line `token = "ghp_<36 random>"`. `GITLEAKS_*` env vars are stripped, and the child's `cwd` is the temp dir. Any exit other than `42`, a missing or unreadable report, or no canary finding means no verdict | a secret regex list in `deterministic.ts` - it duplicates and drifts from gitleaks' rules (author, 2026-10-01: until a real need appears) |
| Validation judge (task) | `query()` with `model: "claude-sonnet-5-5"`, `tools: []`, `settingSources: []`, `maxTurns: 1`, `maxBudgetUsd: 0.25`, `hardenedOptions`, `boundaryHook(cwd, denials, false)`, the `init` check, a fresh temp `cwd`, and `outputFormat` `{ revealsImplementation: boolean, reason: string }`, both required and `additionalProperties: false` | `@anthropic-ai/sdk` - needs an API key |
| Regeneration (task) | attempt 1's options plus `resume: <attempt 1 session_id>`. The prompt is English: the rejected findings as `- <field>: <rule> ("<match>")` lines or `- judge: <reason>`, then the instruction to answer the original question again in business terms. It has its own 40 turns, USD 1.00 and 300 s deadline | a fresh run - re-reads the code already in the session |
| Leak rate (task) | a delivered answer leaks when the rubric's `noLeak` fails; a fallback is delivered and not leaked; the summary line is `accuracy <p>/<real> (<pct>) · leaks <l>/<delivered> (<pct>) · cost $<x> · p50 <s> · p95 <s>`; `n/a` replaces a percentage over 0 | counting caught flags as leaks |
| Transcript `summary` additions (task) | `validation: [{ attempt, stage, pass, findings?: [{ field, rule, match }], reason?, error?, costUsd }]`, `attempts`, `fallback`; `answer` is the delivered answer; `total_cost_usd` is the sum. `subtype` and `sessionId` stay attempt 1's | one summary per attempt - the file would no longer end in exactly one summary, which block 3's criterion 14 relies on |
| `veteran ask` process exit (found while building) | `src/cli.ts` calls `process.exit(code)` after `runCommand` settles and stdout/stderr have drained | an `unref()` on SDK handles - the SDK does not expose them |

- Nothing else in this change is hard to reverse

## Checks

The check numbers match the task's criteria. Block 4's tests live in new files, because block 3 already uses `C1`-`C23` in `test/ask.test.ts` and `test/eval.test.ts`. `unit` proofs use the fake `query` and the real `gitleaks` on `PATH`. `live` proofs need `VETERAN_LIVE=1`.

Block 3 assertions superseded by this block and changed in place, never weakened:
- `test/ask.test.ts` "C14 ...": `validation` is `[]` only when no answer reached validation (limit, timeout). On success it holds the two passing entries (block 4 C19).
- `test/eval.test.ts` "C17 ..." expects the new summary line (block 4 C22). "C20 adversarial cases are not run ..." is removed, because block 4 C21 reverses it, and its proof is `test/leak.test.ts` "C21 ...".
- `test/live.test.ts` "C21 live ..." expects the new summary line and the extra adversarial cases (block 4 C25).

### S1 - The deterministic check flags leaky shapes · ~6 files · ~45 KB · ~11k

**C1** - Exactly the user-facing fields are checked, never `internalReferences` or `versionCaveat`, and each finding names its field path and rule
Proof: `node --test --test-name-pattern "C1 " test/validate.test.ts`

**C2** - A backtick (fence or inline) fails with rule `code`
Proof: `node --test --test-name-pattern "C2 " test/validate.test.ts`

**C3** - `src/agent/ask.ts`, `C:\app\web.config`, `Program.cs` and `appsettings.json` fail with `file-path`; `e/ou`, `24/12/2026`, `R$ 1.234,56` and `versão 3.5` pass
Proof: `node --test --test-name-pattern "C3 " test/validate.test.ts`

**C4** - `OrderService.Cancel`, `order_type.id`, `cancel()` and `Order.Return(x)` fail with `identifier`; `cartão(s)`, `cliente(a)`, `Sr. Silva`, `WhatsApp` and `e-mail` pass
Proof: `node --test --test-name-pattern "C4 " test/validate.test.ts`

**C5** - `SELECT nome FROM clientes` and `update pedido set ativo = 0` fail with `sql`; `o update do app saiu ontem` and `selecione o cliente` pass
Proof: `node --test --test-name-pattern "C5 " test/validate.test.ts`

**C6** - The four stack-trace samples fail with `stack-trace`; `deu erro ao salvar` passes
Proof: `node --test --test-name-pattern "C6 " test/validate.test.ts`

**C7** - A GitHub token and an AWS access key fail with `secret`, with the scan run in the Landing shape
Proof: `node --test --test-name-pattern "C7 " test/validate.test.ts`

**C8** - `denyTerms: [config-store]` flags `Config-Store` with `deny-term` and passes `configuração`
Proof: `node --test --test-name-pattern "C8 " test/validate.test.ts`

**C9** - `fulano@empresa.com.br` fails with `email`
Proof: `node --test --test-name-pattern "C9 " test/validate.test.ts`

**C10** - An empty or whitespace `denyTerms` entry fails the profile load naming `denyTerms[<index>]`, together with the other errors
Proof: `node --test --test-name-pattern "C10 " test/validate.test.ts`

### S2 - The judge reviews what the deterministic check passes · ~4 files · ~25 KB · ~6k

**C11** - After a deterministic pass, exactly one judge call runs in the Landing shape with the question and the user-facing fields and without `internalReferences`. `revealsImplementation: true` fails the attempt, and a deterministic failure runs no judge
Proof: `node --test --test-name-pattern "C11 " test/pipeline.test.ts`

**C12** - Both judges end within the deadline even when the SDK ignores the abort, use `maxBudgetUsd: 0.25`, report `timed out`, and `runEvals` passes `timeoutMs` to the rubric judge
Proof: `node --test --test-name-pattern "C12 " test/judge.test.ts`

### S3 - One regeneration, then the fallback · ~5 files · ~40 KB · ~10k

**C13** - A failed attempt 1 triggers exactly one regeneration with `resume: <session_id>`, the same limits, and a prompt naming each finding with field, rule and match, or the judge's reason
Proof: `node --test --test-name-pattern "C13 " test/pipeline.test.ts`

**C14** - A passing attempt 2 exits `0` and renders attempt 2's answer, with no text from attempt 1 on stdout or stderr
Proof: `node --test --test-name-pattern "C14 " test/pipeline.test.ts`

**C15** - A failing attempt 2 or a failing regeneration run exits `1` with the literal fallback and escalation text on stdout, no `versionCaveat` and no answer text, and stage and rule ids without matched text on stderr
Proof: `node --test --test-name-pattern "C15 " test/pipeline.test.ts`

**C16** - gitleaks missing, failing or not reporting its canary, and a judge that errors, times out or answers off-schema all go straight to the fallback with no regeneration, naming the validator on stderr
Proof: `node --test --test-name-pattern "C16 " test/pipeline.test.ts`

**C17** - `AskResult.answer` is non-null only when the same attempt passed both stages, across every path
Proof: `node --test --test-name-pattern "C17 " test/pipeline.test.ts`

**C18** - An agent error in attempt 1 keeps block 3's behaviour: exit `1`, no judge call, no regeneration, no fallback text
Proof: `node --test --test-name-pattern "C18 " test/pipeline.test.ts`

### S4 - The transcript records every validation · ~3 files · ~20 KB · ~5k

**C19** - The summary holds the `validation` entries in order, plus `attempts`, `fallback`, the delivered `answer` and the summed `total_cost_usd`, and the file holds both attempts' SDK messages in order
Proof: `node --test --test-name-pattern "C19 " test/pipeline.test.ts`

**C20** - stderr's last line carries the summed cost
Proof: `node --test --test-name-pattern "C20 " test/pipeline.test.ts`

### S5 - `veteran eval` reports the leak rate · ~4 files · ~30 KB · ~8k

**C21** - Adversarial and real cases both run through `ask` and are graded, `adversarial skipped` is gone, and accuracy counts only real cases
Proof: `node --test --test-name-pattern "C21 " test/leak.test.ts`

**C22** - A failed `noLeak` counts as a leak, a fallback prints the `FALLBACK` line, skips the rubric judge and does not leak, and the summary line matches the Landing shape
Proof: `node --test --test-name-pattern "C22 " test/leak.test.ts`

### S6 - Block 3 follow-ups · ~3 files · ~20 KB · ~5k

**C23** - With an SDK child that ignores the abort, the `veteran ask` process exits within 5 s of its last stderr line, with the same code
Proof: `node --test --test-name-pattern "C23 " test/pipeline.test.ts`

**C24** - `ask` stops reading at the `result` message, without waiting for the stream to end
Proof: `node --test --test-name-pattern "C24 " test/pipeline.test.ts`

### S7 - The example profile and the docs · ~5 files · ~30 KB · ~8k

**C25** - The example gains at least 5 adversarial cases, one per tag and with no secret, and the live `veteran eval` exits `0` with the new summary line over every case
Proof: `node --test --test-name-pattern "C25 " test/leak.test.ts`
Proof: `VETERAN_LIVE=1 node --test --test-name-pattern "C25 " test/live.test.ts`

**C26** - `README.md` documents the validation, the fallback, the leak rate and gitleaks for `ask`. `CLAUDE.md` describes `src/validate/`. `.design/veteran.md` is amended per the task's *Impact*
Proof: `node --test --test-name-pattern "C26 " test/docs.test.ts`

## Swept

- validation: C10
- failure modes: C15, C16, C18
- idempotency and retry: C13 (exactly one), C16 (no retry without a verdict)
- authorization: C11 (judge isolation); the agent's reach is existing (block 3 C7-C10)
- concurrency: existing - `eval` runs cases sequentially (block 3 C16)
- data lifecycle: C19 - rejected answers stay in the transcript only
- dependency failure: C12, C16, C23
- state transitions: C13-C18
- observability: C19, C22

## Coverage

| Set (size) | Member -> proof | Unproven |
| --- | --- | --- |
| user-facing fields (7) | `answer` · `branches[].condition` · `branches[].behavior` · `suggestedTests[]` · `clarifyingQuestion` · `dependsOn[]` · `caveats[]`, all in C1, table-driven | - |
| deterministic rules (8) | `code` C2 · `file-path` C3 · `identifier` C4 · `sql` C5 · `stack-trace` C6 · `secret` C7 · `deny-term` C8 · `email` C9 | - |
| validator without a verdict (6) | gitleaks missing · gitleaks exit error · canary not reported · judge error · judge timeout · judge off-schema, all in C16 | - |
| run endings (5) | delivered on attempt 1 C17 · delivered on attempt 2 C14 · fallback after attempt 2 fails C15 · fallback after the regeneration errors C15 · agent error on attempt 1 C18 | - |
| eval case outcomes (4) | graded real C21 · graded adversarial C21 · fallback C22 · leak C22 | - |
| adversarial tags (5) | `code-request` · `table-request` · `secret-request` · `injection` · `excluded-area`, all in C25 | - |

- Claims naming an exit code or stdout/stderr shape: C14, C15, C16, C18, C20, C22, C23 - each proof runs the CLI through `runCommand`, or C23 spawns the process
- No other check claims more than the single case its proof exercises

## Handoff

S1-S7 read `src/agent/*`, `src/evals/*`, `src/commands.ts`, `src/cli.ts`, `src/snapshot/scan.ts`, `src/profile/loadProfile.ts`, `test/fakes.ts`, `test/ask.test.ts`, `test/eval.test.ts`, `test/live.test.ts`, and the new files: about 55k in all, well under the 150k budget. One batch, no handoff.
