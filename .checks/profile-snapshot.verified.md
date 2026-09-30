# Project profile + filtered snapshot Verification

**Verdict**: PASS (29/29 checks proven, Gate green), with findings below that should be closed
**Profile**: light (the project declares none)
**Diff range**: cde1cc4..78c1dd1
**Round**: 1 - full
**Verifier**: independent sub-agent (author != verifier)

Environment: Node v24.9.0, gitleaks 8.30.1 (verified binary, prepended to PATH; C24 strips PATH itself via `pathWithoutGitleaks()`), Windows 11, Git Bash. Real tree `git status --porcelain` empty before and after the runs.

## Binding sources

Did not run: step 1 runs only under `ui`, and the checklist marks no source as binding.

## Proof run

One invocation, filter before the files so it applies:

```
node --test --test-reporter=spec --test-name-pattern="^C([1-9]|1[0-9]|2[0-9]) " \
  test/profile.test.ts test/glob.test.ts test/snapshot.test.ts test/scan.test.ts test/example.test.ts
```

Result: `tests 29 / pass 29 / fail 0`, exit 0. Each of C1-C29 appears in the output by name as passed. The two unnamed tests (`globs: * stays within a segment...`, `excludePaths entries that could silently match nothing...`) were filtered out, which confirms the filter works. (A first run with the flag placed *after* the files ignored the filter and ran 31 tests. Worth knowing when copying the proof commands.)

All six test files are added by this diff (`git diff --diff-filter=A --name-only cde1cc4..HEAD -- test`). Every proof resolves to a test this feature added.

## Checks

| Check | Claim | Proof run | Evidence | Result |
|---|---|---|---|---|
| C1 | unset/empty env var: non-zero, names var, cwd gains nothing | `^C1 ` passed | `test/profile.test.ts:13-15`: `assert.notEqual(result.status, 0)`; `assert.match(result.stderr, /VETERAN_PROFILE_DIR/)`; `assert.deepEqual(readdirSync(cwd), [])`, looped over `[undefined, ""]` (:10) | PASS |
| C2 | missing profile.yaml: non-zero, absolute path | `^C2 ` passed | `test/profile.test.ts:22-23`: `notEqual(status, 0)`; `result.stderr.includes(join(dir, "profile.yaml"))` | PASS |
| C3 | invalid YAML: non-zero, absolute path | `^C3 ` passed | `test/profile.test.ts:30-32`: same path assertion plus `/Invalid YAML/` | PASS |
| C4 | all 8 fields named in one run, no git (git absent from PATH) | `^C4 ` passed | `test/profile.test.ts:38` `runCli(dir, { env: { PATH: "", Path: "" } })`; `:40` `for (const field of FIELDS) assert.match(result.stderr, new RegExp(\`- ${field}: missing\`))` over the literal 8-name list at `:7`; `:41` `assert.doesNotMatch(result.stderr, /git/i)` | PASS |
| C5 | three wrong-type shapes are named | `^C5 ` passed | `test/profile.test.ts:49-51`: `/- name: expected a non-empty string/` (list given), `/- excludePaths: expected a list of strings/` (string given), `/- denyTerms: expected a list of strings/` (`["ok", 3]`) | PASS |
| C6 | relative repoPath resolves against profile dir | `^C6 ` passed | `test/snapshot.test.ts:24` `makeProfile("./repo")`, `:29` cwd elsewhere; `:30` `assert.equal(result.status, 0)`; `:31` `filesOf(...snapshot) == ["a.txt"]` | PASS |
| C7 | relative instructions resolve; missing entry named | `^C7 ` passed | `test/profile.test.ts:57` cwd elsewhere; `:59` `/instructions\[1\] "missing\.md": file not found/`; `:60` `doesNotMatch(/instructions\[0\]/)` | PASS |
| C8 | non-repo (incl. plain dir inside a repo): non-zero, path named, snapshot unchanged | `^C8 ` passed | `test/snapshot.test.ts:38` loops `[tempDir, inner]`; `:42` `stderr.includes(\`repoPath is not a git repository: ${repoPath}\`)`; `:43` `exists(snapshot) === false` | PASS (see G4) |
| C9 | bad ref: non-zero, ref named, snapshot unchanged | `^C9 ` passed | `test/snapshot.test.ts:55` `/ref does not resolve to a commit .*: no-such-branch/`; `:56` `deepEqual(readTree(snapshot), before)` with a prior snapshot (`:50`) | PASS |
| C11 | exact tracked set, byte-identical, CRLF/binary, no untracked/uncommitted | `^C11 ` passed | `test/snapshot.test.ts:75` `filesOf == ["README.md","run.sh","src/crlf.txt","src/data.bin"]` (excludes `untracked.txt`); `:77` `README.md == "hello\n"` (uncommitted edit absent); `:78` CRLF buffer; `:79` `BINARY` (literal at `:21`) | PASS |
| C12 | glob dialect: 4 task examples plus literal `?` | `^C12 ` passed | `test/glob.test.ts:7-15` table of literal `[pattern, path, excluded]`; `:18` `assert.equal(compileExcludes([pattern])(path), excluded)` | PASS |
| C13 | the snapshot applies the dialect | `^C13 ` passed | `test/snapshot.test.ts:96` `filesOf == ["Docs/a.txt","ab.txt","certs/key.pem","keep/main.ts"]` | PASS (see G6) |
| C14 | no `.git` at any depth; gitlink not written | `^C14 ` passed | `test/snapshot.test.ts:106` `keys.every(key => !key.split("/").includes(".git"))`; `:107` `exists(snapshot/vendor/sub) === false` | PASS (see G8) |
| C15 | inside + outside symlinks absent, `2 symlinks omitted` | `^C15 ` passed | `test/snapshot.test.ts:119` `[...tree.keys()].sort() == ["real.txt"]`; `:120` `/2 symlinks omitted/` | PASS |
| C16 | second run replaces wholesale (deleted + newly excluded absent) | `^C16 ` passed | `test/snapshot.test.ts:127` first set of three; `:134` `filesOf == ["keep.txt"]` | PASS |
| C17 | HEAD, branch, porcelain identical after success and failure | `^C17 ` passed | `test/snapshot.test.ts:146` and `:150` `deepEqual(repoState(repo), before)`; `repoState` = `rev-parse HEAD`, `symbolic-ref --short HEAD`, `status --porcelain --untracked-files=all` (`helpers.ts:148-150`, claim names these) | PASS (see G7) |
| C18 | non-zero; repo-relative path + `github-pat`; value in neither stream | `^C18 ` passed | `test/scan.test.ts:28` `notEqual(status, 0)`; `:29` `/src\/settings\.ts:1 \(rule github-pat\)/`; `:30` `!stderr.includes(secret) && !stdout.includes(secret)` | PASS (see G1) |
| C19 | after abort snapshot byte-identical; absent when none | `^C19 ` passed | `test/scan.test.ts:37` `exists(fresh/snapshot) === false`; `:41` `deepEqual(readTree(snapshot), before)` | PASS |
| C20 | secret only in excluded path exits 0 | `^C20 ` passed | `test/scan.test.ts:47` `assert.equal(result.status, 0)` | PASS |
| C21 | tree `.gitleaks.toml` allowlist does not stop abort | `^C21 ` passed | `test/scan.test.ts:52` allowlist `paths ['.*']`, `regexes ['ghp_.*']`; `:55-56` non-zero + `/src\/settings\.ts:1 \(rule github-pat\)/` | PASS |
| C22 | root `.gitleaksignore` with every plausible fingerprint does not stop abort | `^C22 ` passed | `test/scan.test.ts:60-61` fingerprints `src/…`, `tree/src/…`, `scan/tree/src/…` `:github-pat:1`; `:65-66` non-zero + finding | PASS (see G5) |
| C23 | `gitleaks:allow` comment does not stop abort | `^C23 ` passed | `test/scan.test.ts:71` `// gitleaks:allow` on the secret line; `:73-74` non-zero + finding | PASS |
| C24 | gitleaks absent: non-zero, "scan did not complete", snapshot unchanged | `^C24 ` passed | `test/scan.test.ts:81` PATH = git's dir only; `:83` `/secret scan did not complete \(gitleaks not found on PATH\)/`; `:84` `deepEqual(readTree(snapshot), before)` | PASS |
| C25 | scanner error or silent exit 0 aborts with "scan did not complete", snapshot unchanged | `^C25 ` passed | `test/scan.test.ts:91` scripts `exit(1)`, `exit(0)`, `exit(42)` with no report; `:95-97` `assert.rejects(buildSnapshot(...), /secret scan did not complete/)`; `:100` `deepEqual(readTree(snapshot), before)` | PASS (see G2) |
| C26 | failure at copy / scan / replace: no `.snapshot-*`, snapshot unchanged | `^C26 ` passed | `test/snapshot.test.ts:161-170` three injected failures; `:172` `rejects(..., new RegExp(\`${step} failed\`))`; `:173` `readdirSync(dir).filter(startsWith(".snapshot-")) == []`; `:174` `deepEqual(readTree(snapshot), before)` | PASS (see G3) |
| C27 | one stdout line: 40-hex SHA + counts matching fixture | `^C27 ` passed | `test/snapshot.test.ts:184` `assert.equal(result.stdout, \`snapshot ${sha}: 2 files copied, 1 excluded, 1 symlinks omitted, 0 submodules omitted\n\`)` | PASS |
| C28 | clone per README, exit 0, `.specs/` at pinned ref, absent from snapshot | `^C28 ` passed (network clone, ~13 s) | `test/example.test.ts:14` README has clone command; `:21` `excludePaths.includes(".specs")`; `:22` `ls-tree ref .specs` non-empty; `:25` `status === 0`; `:27` `exists(snapshot/.specs) === false` | PASS (see G9, G10) |
| C29 | check-ignore on the six paths | `^C29 ` passed | `test/example.test.ts:39-47` ignored: `profiles/acme/profile.yaml`, `…/snapshot/a.txt`, `…/transcripts/a.jsonl`, `…/repo/README.md`, `.snapshot-staging-abc/…`; `:48-49` not ignored: `profiles/example/profile.yaml`, `profiles/example/README.md` | PASS (see G11) |

## Swept rows resolving to existing

None. Every Swept row points at a check or says *not in scope*, so there is nothing to read against the code.

## Coverage join

Did not run: the join recompute is `standard`/`ui` only.

## Test policy rows

Did not run: `standard`/`ui` only. The checklist has no `Test policy` section anyway.

## Faults injected

Did not run: `standard`/`ui` only.

## Findings (ranked)

- **G1 - C18 assertion does not pin "repo-relative"** (`test/scan.test.ts:29`, also `:56`, `:66`, `:74`). `/src\/settings\.ts:1 \(rule github-pat\)/` is unanchored. It would also match `tree/src/settings.ts:1`, `scan/tree/src/settings.ts:1`, or an absolute staging path. The code prints `  - <path>:<line> (rule …)` (`src/snapshot/scan.ts:37`, path from `relative(treeRoot, file)` at `:102`). A regression that relativises against `scanRoot` or leaks the staging path would stay green. Anchor it, for example `/^  - src\/settings\.ts:1 \(rule github-pat\)$/m`.
- **G2 - C25 level gap, and the checklist's own note is false.** The claim is about the command aborting with a message. The proof calls `buildSnapshot` in-process and asserts only the rejection (`test/scan.test.ts:95-97`), with no exit status and no stderr. The checklist's Coverage note says every output-naming proof runs the CLI "except C26". C25 is a second exception that was never declared. The CLI path is only covered transitively by `src/cli.ts:22`.
- **G3 - C26 "replace" failure skips the risky branch** (`test/snapshot.test.ts:169`). The stub replaces the whole `replaceSnapshot`, so it rejects before any rename. The code that actually carries the claim is never exercised: `src/snapshot/buildSnapshot.ts:115-121`, which renames `snapshot` to `.snapshot-old-*`, then fails on `tree` to `snapshot`, then restores the old one. The Landing names this behaviour ("restore old if moved"), and it is the only path where a `.snapshot-old-*` entry or a missing `snapshot/` could be left behind. The claim covers more than the proof exercises.
- **G4 - C8 "snapshot/ unchanged" is proven only for the absent case** (`test/snapshot.test.ts:43`). No prior snapshot exists, so an implementation that deleted an existing `snapshot/` before failing on `repoPath` would pass. C9 does this correctly (`:50`, `:56`).
- **G5 - Checklist precision and Landing drift around the scan root.** Landing says staging holds `tree/` and `canary.txt` and that gitleaks scans the staging root. The code scans `<staging>/scan` holding `tree/` and `canary.txt`, with `ignore/` and `report.json` in `<staging>` (`src/snapshot/buildSnapshot.ts:53-57`, `src/snapshot/scan.ts:51-54`). The isolation is the same, but the one-way-door row does not match the code. Separately, C22's "every plausible form" is not a precise value: the test uses three relative forms (`test/scan.test.ts:60`). This is defensible because the real fingerprint's absolute staging path is random per run, but the checklist should list the forms.
- **G6 - C13 precision gap: "those paths" is not C12's patterns.** The snapshot-level proof uses `config`, `*.pem`, `deep/**/*.pem`, `a?.txt`, `docs/**` (`test/snapshot.test.ts:93`). `config/**`, `**/*.pem` and the positive literal `a?.txt` are exercised only at unit level (`test/glob.test.ts`). The assertion is readable and correct for what it runs.
- **G7 - C17's failed run fails before the copy** (`test/snapshot.test.ts:148`, bad ref). A failure after staging exists, such as a scan abort, is not checked for leaving `repoPath` intact. The claim literally holds ("a failed one"), but the proof exercises the least interesting failure.
- **G8 - C14's `.git` half is near-vacuous.** The fixture cannot place a `.git` segment in the tree, so `:106` holds for any tree-object-based copier. The `.git`-segment guard in the code (`src/snapshot/buildSnapshot.ts:78-83`) is never reached by a test. It would only catch a checkout/`cp` implementation.
- **G9 - C28 expected values are not readable at the assertion.** The clone URL is taken from the README by regex (`test/example.test.ts:13`, `:18`) and never compared with `https://github.com/obogoni/playground`. The ref is read from `profile.yaml` (`:20`) and never compared with `60ff14809dc31c700f9f987add96aae48f72cb97`. Both files do currently hold those values (verified by reading), but the proof would stay green if either changed.
- **G10 - C28 copy filter is broken on Windows** (`test/example.test.ts:17`). `!/[\/](repo|snapshot)$/.test(source)` only matches `/`, and on Windows `source` uses `\`. Verified: the regex returns `false` for `M:\a\profiles\example\repo`. It passed here only because `profiles/example/repo` and `snapshot` do not exist locally. After a developer follows README step 1, the test copies the clone and `git clone` into the non-empty `repo/` fails. Use `[\\/]`.
- **G11 - C29 checks files inside the directories, not the directories themselves** (`test/example.test.ts:41-43`). Low: running `git check-ignore --no-index` on the literal directory paths also reports them ignored (verified). Task criterion 20's "any `<name>`" is narrowed to `acme` by the checklist, which is an accepted narrowing.
- **G12 - C1 narrows task criterion 1** ("creates no file or directory") to the working directory only (`test/profile.test.ts:15`). Low; it is a checklist choice, not a failing proof.

## Gate

`npx tsc --noEmit` - exit 0.
