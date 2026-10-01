# Output validation pipeline (fail closed) Verification

**Verdict**: PASS. 26 of 26 checks are proven at 4cbd1c5. C25's live proof, PENDING in round 1, is now green. The orchestrator ran it at 4cbd1c5 and the verifier read the log. No check fails. Remaining gaps are low-severity test or doc fixes, or user decisions (see Gaps).
**Profile**: light. Step 1 (binding sources vs ui), step 4 (fault injection, including on the surfaces the fix created), the `Coverage` join recomputation and the `Test policy` verdicts did not run under this profile. The checklist has no `Test policy` section.
**Diff range**: 7193ca2..4cbd1c5 (HEAD). Fix under review: 4cbd1c5.
**Round**: 2 - scoped (round 1 was full, at e274013)
**Verifier**: independent sub-agent (author != verifier). Read-only: the only file written in the repository is this one. Before writing, `git status --porcelain` showed only this file as untracked. One throwaway experiment ran from the session scratchpad (see "New Landing rows"), and its temp directory was removed.

## Proof run - verified at 4cbd1c5

One batched invocation, run in full at HEAD:

`node --test --test-reporter=spec --test-name-pattern "^C([0-9]|1[0-9]|2[0-6]) " test/validate.test.ts test/pipeline.test.ts test/judge.test.ts test/leak.test.ts test/docs.test.ts`. It ran 43 tests: 43 passed, 0 failed, exit 0. Every block 4 test appears in the output on its own line as passed. That is 42 tests. The one stray hit is block 3's `docs.test.ts` "C22 the READMEs ...", which is not counted. The four tests new in round 2 appear individually as passed:

- `test/pipeline.test.ts:325` "C11 the agent and the judge switch off claude.ai connectors ..." (371 ms)
- `test/pipeline.test.ts:334` "C19 a judge whose SDK child still holds its working directory ..." (602 ms)
- `test/validate.test.ts:164` "C16 gitleaks exiting 42 without the canary, without a report or with an unreadable report ..." (1155 ms)
- `test/leak.test.ts:80` "C25 the example's eval files hold no secret, by the snapshot's canary-checked scan" (1192 ms)

## Checks

Rows for checks whose proofs sit in files the fix touched (`test/pipeline.test.ts`, `test/validate.test.ts`, `test/leak.test.ts`) have fresh citations at 4cbd1c5. The other rows' evidence is unchanged and is carried from e274013, but their proofs re-ran green at 4cbd1c5.

| Check | Claim | Proof run (4cbd1c5) | Evidence (file:line - assertion) | Result | Provenance |
|---|---|---|---|---|---|
| C1 | Exactly the user-facing fields are checked, never `internalReferences`/`versionCaveat`; each finding names field and rule | batch, 2 tests passed | `test/validate.test.ts:51` - per-field `deepEqual(... [{ field, rule: "file-path", match: "src/app.ts" }])` over 7 paths; `:53` internalReferences gives `[]`; `:60-61` caveat printed unchecked | PASS | evidence carried from e274013 (lines 39-62 unchanged by the fix) |
| C2 | Backtick fails with `code` | batch, passed | `test/validate.test.ts:65` | PASS | carried from e274013 |
| C3 | 4 paths flagged, 4 values pass | batch, passed | `test/validate.test.ts:69` | PASS | carried from e274013 |
| C4 | 4 identifiers flagged, 5 pass | batch, passed | `test/validate.test.ts:73` | PASS | carried from e274013 |
| C5 | 2 SQL shapes flagged, 2 phrases pass | batch, passed | `test/validate.test.ts:77` | PASS | carried from e274013 |
| C6 | 4 stack traces flagged, 1 passes | batch, passed | `test/validate.test.ts:81-85` | PASS | carried from e274013 |
| C7 | Token and AWS key fail with `secret`; scan in the Landing shape | batch, 2 tests passed (real gitleaks, 3.0 s) | `test/validate.test.ts:102` - `[["caveats[0]","secret"],["dependsOn[0]","secret"]]`; `:131` `args[0] === "stdin"`; `:133` `--config`; `:134-135` empty temp ignore dir; `:136` - `for (const flag of ["--ignore-gitleaks-allow", "--redact", "--no-banner", "--no-color"]) assert.ok(call.args.includes(flag), flag)`; `:137` - `assert.match(call.cwd, /veteran-secrets-/, ...)`; `:138-139` json, `42`; `:140` no `GITLEAKS_*`; `:141` stdin shape with canary | PASS | verified at 4cbd1c5 |
| C8 | `config-store` deny term | batch, passed | `test/validate.test.ts:144-146` | PASS | carried from e274013 |
| C9 | email fails | batch, passed | `test/validate.test.ts:150` | PASS | carried from e274013 |
| C10 | blank `denyTerms[i]` fails the load with other errors | batch, passed | `test/validate.test.ts:155-159` | PASS | carried from e274013 |
| C11 | One judge call in the Landing shape, question + user-facing fields, no `internalReferences`; `true` fails; deterministic failure runs no judge | batch, 4 C11 tests passed | `test/pipeline.test.ts:32-37` model, `tools []`, `settingSources []`, `maxTurns 1`, `0.25`, `dontAsk`; `:38-46` - literal `outputFormat` with `additionalProperties: false`, `required: ["revealsImplementation", "reason"]`; `:47` `enabledPlugins` deep-equals `DISABLED_PLUGINS`; `:54-55` hook exercised: `Read` -> `"deny"`, `StructuredOutput` -> `undefined`; `:59-60` all 7 user-facing fields in the prompt, including `branches[0].condition` and a non-null `clarifyingQuestion`; `:62` no `INTERNAL-REF`; `:63-64` env carries `KEEP_ME` and drops an injected `ANTHROPIC_API_KEY`; `:72` judge `true` triggers a regeneration; `:78` deterministic failure gives no judge call; `:85-88` unisolated judge init gives the fallback; `:329-330` `strictMcpConfig === true` and `ENABLE_CLAUDEAI_MCP_SERVERS === "false"` on the agent and validation-judge calls | PASS | verified at 4cbd1c5 |
| C12 | Both judges end at the deadline, 0.25, `timed out`; `runEvals` passes `timeoutMs` | batch, 3 tests passed | `test/judge.test.ts:15-21`, `:28-32`, `:43-44` | PASS | carried from e274013 (file untouched) |
| C13 | One regeneration, `resume`, same limits, prompt names findings or reason | batch, 2 tests passed | `test/pipeline.test.ts:95` `calls.length === 2`; `:98` `resume === "sess-A"`; `:100-104` same options, 40, 1, own abortController; `:105` `- answer: identifier ("OrderService.Cancel")`; `:112` `- judge: cita o nome de uma tabela` | PASS | verified at 4cbd1c5 (citations refreshed) |
| C14 | Passing attempt 2 exits 0, renders it, nothing from attempt 1 | batch, passed | `test/pipeline.test.ts:118-120` | PASS | verified at 4cbd1c5 (citations refreshed) |
| C15 | Fallback literal on attempt 2 failure or regeneration error, no caveat, ids only on stderr | batch, 3 tests passed | `test/pipeline.test.ts:126-131` literal fallback + escalation, no caveat, `attempt 1: deterministic identifier; attempt 2: deterministic file-path`; `:137-139` judge verdict id, not reason; `:151-153` regeneration error kinds give the fallback | PASS | verified at 4cbd1c5 (citations refreshed) |
| C16 | 6 no-verdict validators go straight to the fallback, no regeneration, named | batch, 3 tests passed | `test/pipeline.test.ts:166-170` gitleaks missing / exit error / exit 0 without canary: code 1, fallback, named, `calls.length === 1`, no judge; `:181-185` judge error / timeout / off-schema: same; `:191` real gitleaks verdict; `test/validate.test.ts:167-170,185` - exit 42 with a report lacking the canary, no report, an unreadable report and a non-array report each hit `assert.rejects(...)` with `/did not report the canary/`, `/wrote no report/`, `/unreadable report/`, `/unexpected report/` | PASS | verified at 4cbd1c5 |
| C17 | `answer` non-null only when one attempt passed both stages | batch, passed | `test/pipeline.test.ts:209-210` | PASS | verified at 4cbd1c5 (citations refreshed) |
| C18 | Agent error on attempt 1: exit 1, no judge, no regeneration, no fallback | batch, passed | `test/pipeline.test.ts:215-219` - four kinds: `error_max_turns`, timeout (`hang`), schema, API 529; `:224-228` each `code === 1`, `stdout === ""`, matching stderr, `calls.length === 1`, `judgeCalls.length === 0` | PASS | verified at 4cbd1c5 |
| C19 | Summary holds ordered `validation`, `attempts`, `fallback`, `answer`, summed cost; both attempts' messages | batch, 3 tests passed | `test/pipeline.test.ts:242-259` order, literal entries, `attempts 2`, `fallback false`, `answer SECOND`, `0.22`; `:266-272` fallback summary; `:348-349` - with the judge cwd held by a live child: `code === 0` and the transcript's last line `type === "summary"` | PASS | verified at 4cbd1c5 |
| C20 | stderr's last line carries summed cost | batch, passed | `test/pipeline.test.ts:282` | PASS | verified at 4cbd1c5 (citations refreshed) |
| C21 | Adversarial and real both run and are graded; accuracy counts only real | batch, passed | `test/leak.test.ts:33-45` | PASS | carried from e274013 (lines above the fix's change) |
| C22 | Leak/fallback rules and summary line | batch, 2 tests passed | `test/leak.test.ts:53-59`, `:66,68` | PASS | carried from e274013 |
| C23 | Process exits within 5 s of last stderr line | batch, passed | `test/pipeline.test.ts:310-313` | PASS | verified at 4cbd1c5 (citations refreshed) |
| C24 | `ask` stops reading at `result` | batch, passed | `test/pipeline.test.ts:320-322` | PASS | verified at 4cbd1c5 (citations refreshed) |
| C25 | >=5 adversarial cases, one per tag, no secret; live `veteran eval` exits 0 with the new summary over every case | unit: batch, 2 tests passed. live: run by the orchestrator at 4cbd1c5, log read by the verifier (`scratchpad/live2.log`, ends `exit 0`) | unit: `test/leak.test.ts:74-77` count and 5 tags; `:85` - `await scanForSecrets(join(root, "scan"), join(root, "work"))`, which throws on a finding or a missing canary (`src/snapshot/scan.ts:107-108`). live: `test/live.test.ts:182-186` - `status === 0`, 13 lines, each case line matches `correct=` / `FAILED: ` / `FALLBACK: `, summary regex. The log shows `✔ C21 and C25 live ... (621442 ms)`, 12 case lines all graded (`correct=...`, none `FAILED:` or `FALLBACK:`), 6 `ADVERSARIAL`, and `accuracy 4/6 (67%) · leaks 0/12 (0%) · cost $2.3383 · p50 41.1s · p95 51.9s` | PASS | verified at 4cbd1c5 (live by the orchestrator) |
| C26 | Docs describe validation, fallback, leak rate, gitleaks for `ask` | batch, passed | `test/docs.test.ts:23-38` | PASS | carried from e274013 (file untouched) |

## Live suite - run by the orchestrator at 4cbd1c5, log read by the verifier

`scratchpad/live2.log`: 6 tests, 6 passed, 0 failed, `exit 0`. All block 3 live tests are now green (C1, C7, C9 x2, C10), along with "C21 and C25 live".

Compared with the pre-fix run (`scratchpad/live.log`, `exit 1`): block 3 live C1 and C10 failed there with `EPERM ... veteran-validate-*`. The eval printed 12 `FAILED:` lines, 3 for `unexpected MCP servers: claude.ai ...` (six connectors) and 9 for `EPERM` on the validation judge's temp dir, ending in `accuracy 0/6 (0%) · leaks 0/0 (n/a)`. Both causes are gone in live2.log. Note that "C21 and C25 live" **passed** in the pre-fix run even though every case failed, because `test/live.test.ts:185` accepts `FAILED:` lines. The C25 verdict here rests on the log content (every line graded), not on the test's exit status alone. That tolerance is block 3 9e (out of scope), but it is why the round 1 caution was warranted.

## New Landing rows - verified at 4cbd1c5

| Row | Literal shape vs code | Asserted by a test | Still fail-closed |
|---|---|---|---|
| claude.ai connectors off | Matches. `src/agent/sdk.ts:36` `strictMcpConfig: true` in `hardenedOptions`; `:24` `ENABLE_CLAUDEAI_MCP_SERVERS: "false"` in `agentEnv`, set after the `...source` spread so a caller's value is overridden. Used by the agent (`src/agent/ask.ts:94`), the validation judge (`src/validate/judge.ts:60`) and the rubric judge (`src/evals/rubricJudge.ts:75`) | Partly. `test/pipeline.test.ts:328-331` asserts both values on the agent call and the validation-judge call. **The rubric judge is not asserted** (gap 1) | Yes. `initProblems` still pushes `unexpected MCP servers` for any non-empty `mcp_servers` (`src/agent/sdk.ts:64-66`). The agent aborts on it (`src/agent/ask.ts:115-123`) and both judges return an isolation error (`src/validate/judge.ts:76-79`, `src/evals/rubricJudge.ts:91-94`). Block 3's `test/ask.test.ts:118` (`mcp_servers: [{ name: "linear" }]` -> `/unexpected MCP servers: linear/`) passed in `npm test` at 4cbd1c5 |
| Judge temp dirs removed best effort | Matches the literal options. `src/agent/sdk.ts:160-166` `rmSync(dir, { recursive, force, maxRetries: 5, retryDelay: 200 })` in a `try` with an empty `catch`. Called from `finally` in `src/validate/judge.ts:99`, `src/evals/rubricJudge.ts:114` and `src/validate/secrets.ts:86` | Yes. `test/pipeline.test.ts:341-349` holds the judge cwd with a live child process and asserts exit 0 plus a final `summary`. The verifier checked that this setup really makes removal fail on this machine: a scratch script spawning a child with `cwd` in a temp dir made the pre-fix call `rmSync(dir, { recursive, force, maxRetries: 3 })` throw `EPERM` in 1 ms. The test therefore discriminates against the pre-fix code | Yes. `removeQuietly` runs only in `finally` blocks that neither `return` nor `throw`, so it cannot replace a verdict or swallow an error raised in `try`. A `SecretScanError` (no verdict) still propagates from `secrets.ts`, and the judges' verdict/error is computed before `finally` runs. An ignored removal error therefore cannot let an unvalidated answer through. Leftovers are empty directories: 35 `veteran-validate-*` and 12 `veteran-judge-*` in the OS temp dir held 0 files when checked. A leftover `veteran-secrets-*` would hold only the redacted report |

Precision observation on the second row: the same experiment shows that `EPERM` on a held directory is not retried here (it fails in 1 ms), and Node's `retryDelay` is a linear backoff, not "200 ms apart". So the "5 retries" buy nothing in the observed case, and leaving the directory behind is the normal outcome. The Landing accepts this ("any error ignored"), so it is not a failure.

## Round 1 gaps re-judged - verified at 4cbd1c5

| # | Round 1 gap | Status | Evidence |
|---|---|---|---|
| 1 | C25 live proof pending; live C1 failing | **Closed** | `scratchpad/live2.log` `exit 0`, all 6 live tests pass, every eval case graded (see Live suite). Live C1 had failed on the judge-dir `EPERM`, which the second Landing row fixes |
| 2 | Leak measurement fails open on an ungraded answer (`src/evals/runEvals.ts:104`) | **Still open - user decision** | Unchanged: `if (!judged.verdict) return { ...run, delivered: true, costUsd, failure: judged.error }` counts in `delivered` and never as a leak. The task does not decide this case |
| 3 | C11 hardening assertion vacuous; `enabledPlugins` not asserted; hook only counted | **Closed** | `test/pipeline.test.ts:28` injects `ANTHROPIC_API_KEY`; `:63-64` env defined (`KEEP_ME`) and key dropped; `:47` `enabledPlugins`; `:54-55` hook decisions exercised |
| 4 | C7 `--no-color` and child `cwd` unasserted; `--report-path` implicit | **Closed** for the named parts | `test/validate.test.ts:136-137`. `--report-path` is still asserted only implicitly (the scan throws without a report). That is acceptable, because `test/validate.test.ts:168` now proves "no report" is a no-verdict path |
| 5 | Exit 42 without canary / missing / unreadable report not hit | **Closed** | `test/validate.test.ts:164-187`, 4 cases including the non-array report (`src/validate/secrets.ts:64,69,71,83`) |
| 6 | C11 prompt checked against 5 of 7 fields; schema imported; `additionalProperties` unasserted | **Closed** | `test/pipeline.test.ts:59` all 7 (non-null `clarifyingQuestion` at `:26`); `:38-46` literal schema |
| 7 | C18 covers one error kind | **Closed** | `test/pipeline.test.ts:215-228`, four kinds, each with `stdout === ""` |
| 8 | C25 "no secret" via `gitleaks dir` without canary | **Closed** | `test/leak.test.ts:80-86` uses the canary-checked `scanForSecrets` |
| 9 | *(observation)* `.tasks/headless-poc.md` not amended though Impact says Unresolved 8 / 9a-9c are answered | **Still open - observation / user decision** | 4cbd1c5 does not touch `.tasks/headless-poc.md`. C26 binds only `.design/veteran.md` |

## Superseded block 3 assertions - carried from e274013

Unchanged by the fix (it touched none of `test/ask.test.ts`, `test/eval.test.ts`, `test/live.test.ts`). Round 1's judgement stands: the changes are stricter or follow criteria 19, 21, 22 and 25, and none weakens a test.

## Swept rows resolving to existing - verified at 4cbd1c5

- authorization: the agent's reach is existing. It holds: `boundaryHook(snapshot, denials)` and the `init` check are at `src/agent/ask.ts:105` and `:115-123`, and the fix's change adds a restriction here, not a relaxation.
- concurrency: `eval` runs cases sequentially. Carried from e274013, because `src/evals/runEvals.ts` is untouched by the fix.

## Gaps (ranked)

1. **Fix needed (test, low).** The rubric judge's connectors-off settings are not asserted. The Landing row says "for the agent and both judges", but `test/pipeline.test.ts:328` iterates only `fake.calls[0]` and `fake.judgeCalls[0]` (the validation judge). The code is right (`src/evals/rubricJudge.ts:75` spreads `hardenedOptions`), but nothing would catch the rubric judge dropping it.
2. **User decision.** An ungraded delivered answer counts as delivered and never as a leak (`src/evals/runEvals.ts:104`). For a "0 leaks" gate, a rubric-judge failure reads as "no leak". Carried from round 1.
3. **Fix needed (doc, low).** At `.checks/output-validation.md:31` a blank line separates the two new Landing rows (`:32-33`) from the table's header. In rendered Markdown they are not table rows but a stray pipe-delimited paragraph.
4. **Observation.** `test/pipeline.test.ts:47` compares `enabledPlugins` with `DISABLED_PLUGINS` imported from the implementation, so the expected value cannot be read at the assertion. The constant is a block 3 decision, so this is weak on its face but low risk.
5. **Observation.** `test/leak.test.ts:71`'s name still says "and no secret", but the secret scan moved to `:80`.
6. **Observation / user decision.** `.tasks/headless-poc.md` was not amended (round 1 item 9).
7. **Observation (out of scope, block 3 9e).** `test/live.test.ts:185` accepts `FAILED:` lines, so "C21 and C25 live" passed in the pre-fix run with every case failed.

## Gate - verified at 4cbd1c5

- `npm run typecheck` (`tsc --noEmit`): exit 0
- `npm test`: 117 tests, 111 passed, 0 failed, 6 skipped (the `VETERAN_LIVE` suite). Exit 0.
- Live suite: run by the orchestrator at 4cbd1c5 (`scratchpad/live2.log`), 6 passed, 0 failed, `exit 0`. Not run by the verifier.
