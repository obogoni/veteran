# Headless PoC (`veteran ask` / `veteran eval`) Verification

**Verdict**: PASS (23 of 23 checks proven)
**Profile**: light (no profile declared in the repository). Step 1 (ui), the Coverage join recompute, the Test policy verdicts and fault injection were skipped as the profile says. Steps 2, 3 and 5 ran. Proofs ran in full at HEAD. Checks were re-judged within the round 2 scope.
**Diff range**: `1bbc8e4..5838f44` (feature). Round 2 scope: fix diff `f186dd1..5838f44`, plus C7 (round 1 FAIL) and every round 1 finding
**Round**: 2 - scoped
**Verifier**: independent sub-agent (author != verifier). Read-only on source; this file is the only write.

## Binding sources - carried from f186dd1

| Source | Opened | Contradiction | Uncovered |
|---|---|---|---|
| `.tasks/headless-poc.md` (record of decision) | yes (round 1) | none hidden. Still for the user to confirm: `StructuredOutput` in C7's tool set (Landing: "Renegotiated in the user's absence"). The new Landing row "Verifier round 1 fixes" adds guards and does not change a Decided shape. The judge's `maxBudgetUsd 0.25` and 120 s abort go beyond the Decided judge shape, which set neither. They are recorded as guards, not decisions (`src/evals/rubricJudge.ts:12-14`). | - |
| `.tasks/eval-set.md` | yes (round 1) | none | - |
| `.design/veteran.md` *Configuration isolation* | yes (round 1) | none | - |

## Checks - proofs verified at 5838f44

Unit proofs ran in one invocation: `node --test --test-reporter=tap test/ask.test.ts test/boundary.test.ts test/eval.test.ts test/docs.test.ts`, exit 0, 38 tests, 38 pass, 0 skipped. Every named test below appears individually as `ok`.
Live proofs ran in one invocation: `VETERAN_LIVE=1 node --test test/live.test.ts`, exit 0, 6 tests, 6 pass, 366 s, on the operator's Claude Code login.

The **Re-judged** column says `5838f44` for each check re-judged in the round 2 scope and gives refreshed citations. `carried` means the verdict is carried from f186dd1: its proof re-ran green at HEAD, and its citations were refreshed where lines moved.

| Check | Re-judged | Proof run | Evidence | Result |
|---|---|---|---|---|
| C1 | carried | unit `ok 1`, `ok 2`; live `✔ C1 live` | `ask.test.ts:25` `assert.equal(result.stdout, \`${expected}\n\`)` · `:33` empty lists print no heading · `live.test.ts:68` `status === 0`, `:70` `stdout.trimEnd().endsWith(caveat)`, `:71` `/^Depende do caso:$/m` | PASS |
| C2 | carried | unit `ok 3` | `ask.test.ts:44` `stdout.startsWith("Pergunta para você:\nQual é o tipo do cartão?\n\nDepende do tipo do cartão.")` | PASS |
| C3 | carried | unit `ok 4` | `ask.test.ts:51-52` `!stdout/stderr.includes("INTERNAL-REF")`, `:54` transcript includes `INTERNAL-REF-CardService.cs:42` | PASS |
| C4 | carried | unit `ok 5` | `ask.test.ts:62` `code === 1`, `:63` `/did not match the expected schema/`, `:64` `stdout === ""` | PASS |
| C5 | carried | unit `ok 6` | `ask.test.ts:75` usage regex, `:76` `fake.calls.length === 0` | PASS |
| C6 | carried | unit `ok 7`, `ok 8` | `ask.test.ts:85` ``/run `veteran snapshot` first/``, `:87` `fake.calls.length === 0` | PASS |
| C7 | **5838f44** | unit `ok 9`, `ok 10`; live `✔ C7 live` | Abort now covers every field. `src/agent/sdk.ts:66-74` compares `cwd` (by real path, `samePath` `:82-94`), `model` and `permissionMode`, and `src/agent/ask.ts:115-120` passes all three. `ask.test.ts:114-121`: cases for an extra tool, a missing tool (`/unexpected tool set \[Glob, Grep, Read\]/`), MCP, `cwd: tempDir("elsewhere")` → `/unexpected cwd /`, `model` → `/unexpected model "claude-sonnet-5-5", expected "claude-opus-5-5"/`, `permissionMode` → `/unexpected permission mode "bypassPermissions", expected "dontAsk"/`; asserted at `:126` `code === 1`, `:127` `match(stderr, message)`, `:129` `stdout === ""`. Options: `ask.test.ts:104-111`. Live: `live.test.ts:79` tools, `:80` `mcp_servers []`, `:81` `init.cwd === join(EXAMPLE,"snapshot")`, `:82-83` model and permissionMode. The real-path comparison also passed live against the 8.3 form: the C9/C10 temp profiles' `init.cwd` is `C:\Users\OTVIOB~1\...\snapshot`, and all six judge sessions (cwd from `mkdtemp(tmpdir())`) passed `initProblems`, because every C21 line carries a verdict and none reads `FAILED: judge session is not isolated`. | **PASS** (round 1 FAIL closed) |
| C8 | **5838f44** | unit `ok 24`, `ok 25` | New denied cases `boundary.test.ts:33` `**/../x`, `:34` `src/**/../../x`, `:35` `src\..\..\profile.yaml`, `:36` `%USERPROFILE%\x.txt`, `:37` `$HOME/x.txt`, `:38` `${HOME}/**`, `:39` UNC; asserted by `:56` `assert.ok(denialReason(snapshot, tool, input))`. New allowed case `:51` (real-path form of the snapshot), asserted by `:73` `=== undefined`. Hook output `:65-68` `permissionDecision: "deny"` and the recorded denial. Code: `src/agent/boundary.ts:40-42` (the `~`, env-expansion and `..`-segment rules), `:46-48` (the given or real root form). | PASS |
| C9 | **5838f44** | live `✔ C9 live` (both tests) | The new test `live.test.ts:122` runs the real SDK with `hardenedOptions`, `READ_TOOLS` and `boundaryHook(snap, denials)`. `:150` `assert.ok(denials.some((denial) => denial.tool === "Read"))` and `:151` `!seen.join("\n").includes(marker)` both passed, so a real `PreToolUse` call reached the hook, was denied, and the content never entered the session. The original test `:103-104` (content absent) passed again. Its denial half is **still vacuous**: this run's transcript `%TEMP%/veteran-profile-ldIpKb/transcripts/20260930T221253329Z-4a7d639c.jsonl` shows 2 Grep, 1 Read inside the snapshot and a refusal, with `hookDenials: []` and `permission_denials: []`. The new test covers that gap. Residual: the new test uses a cooperative prompt and `model: "claude-sonnet-5-5"` instead of `ask()`. It cannot tell the hook's deny apart from the built-in `dontAsk` refusal of an out-of-cwd read, although `:150` proves the hook fired. The wiring through `ask()` stays covered only by `ask.test.ts:111` `hooks.PreToolUse.length === 1`. | PASS |
| C10 | **5838f44** | unit `ok 11`, `ok 12`; live `✔ C10 live` | `live.test.ts:161-164` the snapshot's `.claude/settings.json` now carries a `SessionStart` command hook; `:175` `!existsSync(join(profile,"snapshot","HOOK-RAN"))`, `:176` not in ROOT either; `:170` no marker on stdout; `:172` none in the answer; `:174` `init.plugins deepEqual []`. Unit `ask.test.ts:139` `settingSources []`, `:144` plugins off, `:153` a plugin in `init` aborts. | PASS (round 1 Finding 7a fixed) |
| C11 | carried | unit `ok 13` | `ask.test.ts:162` `/the agent stopped: ${subtype}/`, `:168` `/API error 529: Overloaded/` | PASS |
| C12 | **5838f44** | unit `ok 14`-`ok 17` | `ask.test.ts:177` `/timed out after 1 s/`, `:179` `abortController.signal.aborted === true`; stuck SDK: `:187` `/timed out after 1 s/`, `:188` `Date.now() - started < 5000`, `:190` `summary.subtype === "aborted"`; late timeout: `:196` `code === 0`, `:197` `/^Depende do tipo do cartão\./`; default `:202` `TIMEOUT_MS === 300_000`. Code: `src/agent/ask.ts:101-106` races `iterator.next()` against `deadline`, `:132` keeps the result, `:146-147`. | PASS (round 1 Finding 5 fixed in process; see new risk R1) |
| C13 | carried | unit `ok 18` | `ask.test.ts:209-210` options, `:212-213` summary | PASS |
| C23 | **5838f44** | unit `ok 21`, `ok 22`, `ok 23`, `ok 37`; live C7 | Mixed-case keys: `ask.test.ts:270-271` `anthropic_api_key`, `Anthropic_Auth_Token`; `:279` `assert.ok(!["ANTHROPIC_API_KEY","ANTHROPIC_AUTH_TOKEN","ANTHROPIC_BASE_URL"].includes(key.toUpperCase()))` for every passed key; `:281` `KEEP_ME` kept. Code `src/agent/sdk.ts:25-27`. Judge: `eval.test.ts:188` (upper-case keys; it shares `agentEnv`). Hint: `ask.test.ts:294`; no hint on login-themed answers or a 529: `:303-304` `!stderr.includes("/login")`. Code `sdk.ts:100-104`, `ask.ts:161` (the error text only). `apiKeySource`: `live.test.ts:84` `typeof init.apiKeySource === "string"`, `:85` not `ANTHROPIC_API_KEY`; this run's transcripts record `none`. | PASS (round 1 Findings 3, 7b and 8b fixed) |
| C14 | carried | unit `ok 19` | `ask.test.ts:227` `files.length === 1`, `:228` name regex, `:230-232` order, `:236` every field, `:240` subtype, `:241` `validation []` | PASS |
| C15 | **5838f44** | unit `ok 20`; live C1 | `ask.test.ts:253` exact line for success and a limit; timeout path `:260` `last.startsWith(\`transcript: ${transcript} · cost: $0.0000 (estimated) · \`)`, `:261` `/ · \d+\.\d s$/`; `live.test.ts:72` | PASS (round 1 Finding 7d fixed) |
| C16 | carried | unit `ok 27` | `eval.test.ts:48` `fake.calls.length === 4`, `:49` `fake.maxActive() === 1`, `:57-60` judge prompt includes `RUBRIC-MARKER`, question, reference, branch text | PASS |
| C17 | **5838f44** | unit `ok 28`-`ok 30`; live C21 | `eval.test.ts:73` exact deepEqual, with case `c` now `byBranch=fail` (no `n/a`); code `src/evals/runEvals.ts:37-38` prints pass/fail for every item, as criterion 17 says. Accuracy still ignores `byBranch` when there are no expected branches (`:84` `/^a  correct=fail .* NOT ACCURATE$/m`). `:90-95` nearestRank. | PASS (round 1 Finding 6 fixed; see note N2) |
| C18 | **5838f44** | unit `ok 31`, `ok 32` | limit `eval.test.ts:104`; timeout `:115` `/^a  FAILED: timed out after 1 s  \$0\.0000  \d+\.\ds$/`; schema `:116` `/^b  FAILED: the answer did not match the expected schema/`; next case runs `:117`; `:113` `code === 0`; `:118` `accuracy 1\/3` | PASS (round 1 Finding 7c fixed: 3 of 3 kinds) |
| C19 | carried | unit `ok 33`, `ok 34`, `ok 38` | `eval.test.ts:136` `code === 1`, `:137` `calls.length === 0`, `:149` each `file:line` message | PASS |
| C20 | carried | unit `ok 35` | `eval.test.ts:167` `calls.length === 2`, `:169` `/2 adversarial skipped$/m` | PASS |
| C21 | carried (re-run) | unit `ok 36`; live `✔ C21 live` | `eval.test.ts:175` `real.length >= 5`, `:178` the rubric headings; `live.test.ts:182` `status === 0`, `:184` 7 lines, `:186` summary regex. Output below. | PASS |
| C22 | carried | unit `ok 26` | `docs.test.ts:9-10` example README `node src/cli.ts ask "`/`eval`; `:13-18` README ask, eval, login sentence, `never reads an API key`, `estimated USD 1.00`, plan usage | PASS |

### C21 live eval output (this run, 5838f44)

```
pg-workspaces-1  correct=pass businessLevel=pass byBranch=pass admitsUncertainty=pass noLeak=pass  $0.2179  33.7s  ACCURATE
pg-workspaces-2  correct=pass businessLevel=pass byBranch=pass admitsUncertainty=fail noLeak=pass  $0.1533  32.6s  ACCURATE
pg-tasks-1  correct=pass businessLevel=pass byBranch=fail admitsUncertainty=pass noLeak=pass  $0.1974  34.8s  NOT ACCURATE
pg-tasks-2  correct=pass businessLevel=pass byBranch=fail admitsUncertainty=pass noLeak=pass  $0.2669  46.1s  NOT ACCURATE
pg-agents-1  correct=pass businessLevel=pass byBranch=pass admitsUncertainty=fail noLeak=pass  $0.1562  30.7s  ACCURATE
pg-agents-2  correct=pass businessLevel=pass byBranch=fail admitsUncertainty=pass noLeak=pass  $0.2481  41.5s  NOT ACCURATE
accuracy 3/6 (50%) · cost $1.2399 · p50 33.7s · p95 46.1s · 0 adversarial skipped
```

All 7 example transcripts from this run (C1/C7 and the 6 eval cases) show tools `[Glob, Grep, Read, StructuredOutput]`, `cwd` `M:\obogoni\veteran\profiles\example\snapshot`, model `claude-opus-5-5`, `permissionMode` `dontAsk`, `plugins []`, `mcp_servers []`, `apiKeySource` `none`, `hookDenials []` and `error null`. C21 asks only for exit 0, so 50% accuracy is data, not a failure.

## Round 1 findings - status at 5838f44

| # | Finding | Status |
|---|---|---|
| 1 | C7 abort ignored cwd/model/permissionMode | **fixed**: `sdk.ts:66-74`, `ask.test.ts:118-120` |
| 2 | C9 denial half vacuous | **fixed** by the new live test `live.test.ts:122-152`. The original test is still vacuous on its own denial half (this run: `hookDenials []`); see the residual under C9 |
| 3 | Lower-case env keys on Windows | **fixed**: `sdk.ts:25-27`, `ask.test.ts:270-279` |
| 4 | `**/..`, env-expansion globs, `M:foo` | **fixed** for `..` segments and `%VAR%`/`$VAR`/`${VAR}` (`boundary.ts:41-42`, `boundary.test.ts:33-38`). `M:foo` (same-drive relative) is **still open**, low severity, accepted in round 1 as resolving to the child's cwd; no test |
| 5 | Timeout relies on the SDK honouring abort; a late timeout discarded a result | **fixed in process**: `ask.ts:101-106`, `:132`; `ask.test.ts:182-197`. See new risk R1 for the process level |
| 6 | C17 `byBranch=n/a` | **fixed**: `runEvals.ts:37-38`, `eval.test.ts:76` |
| 7a | C10 settings.json with no instruction | **fixed**: `live.test.ts:161-164`, `:175-176` |
| 7b | `apiKeySource` assertion passed on a missing field | **fixed**: `live.test.ts:84` |
| 7c | C18 covered only the limit case | **fixed**: `eval.test.ts:108-118` |
| 7d | C15 not asserted on the timeout path | **fixed**: `ask.test.ts:256-261` |
| 7e | C12 300 s default proven through the constant | **accepted as recorded** (the checklist's proof note allows the injected timeout) |
| 8a | Judge without timeout/budget | **fixed in code** (`rubricJudge.ts:68-69`, `:80-81`), but **untested** and not deadline-raced; see R2 |
| 8b | Login-hint heuristic matched the model's text | **fixed**: `ask.ts:161` passes only the error; `sdk.ts:103`; `ask.test.ts:297-305` |
| 9 | `StructuredOutput` renegotiation | **still open for the user to confirm** (recorded in Landing) |

## New correctness risks in the fix (not fixed; read-only)

- **R1 (medium-low) - the CLI process can outlive the deadline.** `ask()` now returns at the deadline (`src/agent/ask.ts:102-105`), and then fires `iterator.return()` without awaiting it (`:140`). `src/cli.ts:10` only sets `process.exitCode` and never calls `process.exit`. If a real SDK child ignores the abort, its handles keep Node alive after stderr is printed. The fake in `ask.test.ts:182` is a never-settling promise, which holds no handle, so the proof cannot see this. The round 1 claim "a stuck SDK that ignores the abort still ends the run" holds for the function, not for the `veteran ask` process.
- **R2 (low) - the judge timeout is abort-only and untested.** `rubricJudge.ts:71` still uses a plain `for await` with no race, which is the exact pattern round 1 flagged for `ask`, so a judge that ignores the abort still hangs `eval`. If the SDK ends the stream quietly on abort, the error reads `judge ended without a result` (`:100`), not `timed out`. No test asserts the judge's `abortController`, `maxBudgetUsd` or timeout (`grep` for `JUDGE_TIMEOUT|JUDGE_MAX_BUDGET|maxBudgetUsd` in `test/eval.test.ts` finds none). Also, `runCase` does not pass `timeoutMs` to the judge (`runEvals.ts:86`).
- **R3 (low) - a result followed by a stalled stream waits out the full timeout.** After `result` arrives, the loop keeps waiting for `done` (`ask.ts:101-111`), so a stall costs up to 300 s of latency before the valid answer prints. This is correct, just slow.
- **R4 (informational) - fail-closed false denials.** `boundary.ts:41` denies any target with `$` followed by a letter, `{` or `(`, or with a `%x%` pair (for example a repository folder named `$Resources`, or `50%off%.txt`). `:42` treats `,`, `{` and `}` as segment separators. This is intended fail-closed behaviour, but a legitimate path like that becomes unreadable. Glob metacharacters that could in theory match `..` (`??`, `[.][.]`) are not denied, but glob engines do not list `.`/`..` entries.
- **R5 (informational) - dead assignment.** `ask.ts:104` `timedOut = !error` is always `true`, because `error` is only set just before a `break` (`:122-123`).

## Swept rows resolving to existing constraints - carried from f186dd1

| Row | Constraint cited | In the code |
|---|---|---|
| data lifecycle | the example's transcripts are ignored by git | yes: `.gitignore:10`; `git status --porcelain` after the live run shows only this file |
| concurrency | cases run sequentially | yes: `src/evals/runEvals.ts` awaits each case in a `for` loop; C16 asserts `maxActive() === 1` |

## Notes

- N1: `live.test.ts:185` accepts `FAILED: ` lines, so C21 would stay green even if every judge session failed isolation. This run had no such line.
- N2: A case without `expectedBranches` now prints the judge's `byBranch=fail` next to `ACCURATE` (`eval.test.ts:76`). This matches criterion 17 literally, but it can confuse whoever reads the report.

## Gate - verified at 5838f44

- `npm run typecheck`: exit 0.
- `npm test` (`node --test test/*.test.ts`, block 1 included): exit 0, 76 tests, 70 passed, 0 failed, 6 skipped (the live tests without `VETERAN_LIVE`).
- `VETERAN_LIVE=1 node --test test/live.test.ts`: exit 0, 6 passed, 0 failed, 366 s.
