# Project profile + filtered snapshot Verification

**Verdict**: PASS (29/29 checks proven, Gate green). N1 and N2 closed; no new findings
**Profile**: light (the project declares none)
**Diff range**: cde1cc4..76425f0 (fix: 2d36bb1..76425f0)
**Round**: 3 - scoped
**Verifier**: independent sub-agent (author != verifier)

Environment: Node v24.9.0, gitleaks 8.30.1 from the winget Links directory prepended to PATH (C24 and the CLI half of C25 build their own PATH through `pathWithoutGitleaks()`), Windows 11, Git Bash. The real tree's `git status --porcelain` was empty before and after the run.

Scope: the proofs re-ran in full at 76425f0. The fix (`git diff --stat 2d36bb1..76425f0`) touched `test/snapshot.test.ts` (C17 post-copy leg, +2 lines at `:163-166`), the gitleaks invocation row of `.checks/profile-snapshot.md` (`:32`) and this report. No `src/` file and no other test file changed. Citations in `test/snapshot.test.ts` above line 160 are unchanged; those below it shifted by +2 and were refreshed (C17, C26, C27, and the C14 helper). Everything else is carried from 2d36bb1.

## Binding sources - carried from 2d36bb1

Did not run: step 1 runs only under `ui`, and the checklist marks no source as binding.

## Proof run - verified at 76425f0

One invocation, with the filter placed before the files:

```
PATH="/c/Users/OtávioBogoni/AppData/Local/Microsoft/WinGet/Links:$PATH" node --test --test-reporter=spec --test-name-pattern="^C([1-9]|1[0-9]|2[0-9]) "   test/example.test.ts test/glob.test.ts test/profile.test.ts test/scan.test.ts test/snapshot.test.ts
```

Result: `tests 30 / pass 30 / fail 0`, 85 s (C28 clones from GitHub, 36.7 s). Every one of C1-C29 appears by name as passed. C25 appears twice, and both passed:
- `C25 a gitleaks that exits with an error makes veteran snapshot exit non-zero, snapshot unchanged`
- `C25 a scanner that errors, or exits 0 without the canary, aborts and leaves the snapshot unchanged`

The unnamed tests were filtered out, so the filter was applied (30 = 29 checks + the second C25).

## Checks - proofs verified at 76425f0; evidence marked per row

| Check | Claim | Proof run | Evidence | Result |
|---|---|---|---|---|
| C1 | unset/empty env var: non-zero, names var, cwd gains nothing | `^C1 ` passed at 76425f0 | carried from 2d36bb1: `test/profile.test.ts:13-15`: `assert.notEqual(result.status, 0)`; `assert.match(result.stderr, /VETERAN_PROFILE_DIR/)`; `assert.deepEqual(readdirSync(cwd), [])`, looped over `[undefined, ""]` (:10) | PASS |
| C2 | missing profile.yaml: non-zero, absolute path | `^C2 ` passed at 76425f0 | carried from 2d36bb1: `test/profile.test.ts:22-23`: `result.stderr.includes(join(dir, "profile.yaml"))` | PASS |
| C3 | invalid YAML: non-zero, absolute path | `^C3 ` passed at 76425f0 | carried from 2d36bb1: `test/profile.test.ts:30-32` | PASS |
| C4 | all 8 fields named in one run, git absent | `^C4 ` passed at 76425f0 | carried from 2d36bb1: `test/profile.test.ts:38` `PATH: ""`; `:40` `new RegExp(\`- ${field}: missing\`)` over the 8 literals at `:7`; `:41` `doesNotMatch(/git/i)` | PASS |
| C5 | three wrong-type shapes named | `^C5 ` passed at 76425f0 | carried from 2d36bb1: `test/profile.test.ts:49-51` | PASS |
| C6 | relative repoPath resolves against profile dir | `^C6 ` passed at 76425f0 | carried from 2d36bb1: `test/snapshot.test.ts:26` `makeProfile("./repo")`, `:31` cwd `tempDir("cwd")`; `:32` `assert.equal(result.status, 0)`; `:33` `filesOf(...) == ["a.txt"]` | PASS |
| C7 | relative instructions resolve; missing entry named | `^C7 ` passed at 76425f0 | carried from 2d36bb1: `test/profile.test.ts:57-60` | PASS |
| C8 | non-repo (incl. plain dir in a repo): non-zero, path named, snapshot unchanged | `^C8 ` passed at 76425f0 | carried from 2d36bb1: `test/snapshot.test.ts:40` loop over `[tempDir, inner]`; `:44` `stderr.includes(\`repoPath is not a git repository: ${repoPath}\`)`; new prior-snapshot case `:48` `runCli(dir).status === 0`, `:50` repoPath swapped to `inner`, `:51` `notEqual(status, 0)`, `:52` `deepEqual(readTree(snapshot), before)` | PASS |
| C9 | bad ref: non-zero, ref named, snapshot unchanged | `^C9 ` passed at 76425f0 | carried from 2d36bb1: `test/snapshot.test.ts:63` `/ref does not resolve to a commit .*: no-such-branch/`; `:64` `deepEqual(readTree(snapshot), before)` | PASS |
| C10 | `!` entry rejected by name | `^C10 ` passed at 76425f0 | carried from 2d36bb1 (`test/profile.test.ts`, untouched) | PASS |
| C11 | exact tracked set, byte-identical, CRLF/binary, no untracked/uncommitted | `^C11 ` passed at 76425f0 | carried from 2d36bb1: `test/snapshot.test.ts:83` `filesOf == ["README.md","run.sh","src/crlf.txt","src/data.bin"]`; `:85` `Buffer.from("hello\n")`; `:86` CRLF; `:87` `BINARY` (literal `:23`) | PASS |
| C12 | glob dialect: 4 task examples + literal `?` | `^C12 ` passed at 76425f0 | carried from 2d36bb1: `test/glob.test.ts:6-16` literal table; `:18` `assert.equal(compileExcludes([pattern])(path), excluded)` | PASS |
| C13 | snapshot applies one pattern of each named shape | `^C13 ` passed at 76425f0 | carried from 2d36bb1: `test/snapshot.test.ts:101` `excludePaths: ["config", "*.pem", "deep/**/*.pem", "a?.txt", "docs/**"]`, exactly the five shapes the reworded C13 names; `:104` `filesOf == ["Docs/a.txt","ab.txt","certs/key.pem","keep/main.ts"]` | PASS |
| C14 | no `.git` at any depth; gitlink not written | `^C14 ` passed at 76425f0 | carried from 2d36bb1 (helper line refreshed at 76425f0): `test/snapshot.test.ts:110` `commitCraftedGitDirs(repo)` (now `:215-230`); `:115` `keys.every(key => !key.split("/").includes(".git"))`; `:116` `exists(snapshot/vendor/sub) === false`; `:117` `/1 submodules omitted/` | PASS |
| C15 | inside + outside symlinks absent, `2 symlinks omitted` | `^C15 ` passed at 76425f0 | carried from 2d36bb1: `test/snapshot.test.ts:128` `[...tree.keys()].sort() == ["real.txt"]`; `:129` `/2 symlinks omitted/` | PASS |
| C16 | second run replaces wholesale | `^C16 ` passed at 76425f0 | carried from 2d36bb1: `test/snapshot.test.ts:136` first set of three; `:143` `filesOf == ["keep.txt"]` | PASS |
| C17 | HEAD, branch, porcelain identical after success and failure | `^C17 ` passed at 76425f0 | verified at 76425f0: pre-copy legs `test/snapshot.test.ts:155`, `:159` `deepEqual(repoState(repo), before)`; post-copy leg `:162` commits the leak, `:163` rewrites tracked `a.txt` to `"dirty again"`, `:164` adds `another-untracked.txt`, `:166` `assert.notEqual(beforeLeak.status, "")`, `:169` `notEqual(status, 0)`, `:170` `/gitleaks found/`, `:171` `deepEqual(repoState(repo), beforeLeak)`; `repoState` = `rev-parse HEAD`, `symbolic-ref --short HEAD`, `status --porcelain --untracked-files=all` (`test/helpers.ts:146-151`) | PASS |
| C18 | non-zero; repo-relative path + `github-pat`; value in neither stream | `^C18 ` passed at 76425f0 | carried from 2d36bb1: `test/scan.test.ts:31` `notEqual(status, 0)`; `:32` `assert.match(result.stderr, FINDING_LINE)` with `FINDING_LINE = /^  - src\/settings\.ts:1 \(rule github-pat\)$/m` (`:10`); `:33` `!stderr.includes(secret) && !stdout.includes(secret)` | PASS |
| C19 | after abort snapshot byte-identical; absent when none | `^C19 ` passed at 76425f0 | carried from 2d36bb1: `test/scan.test.ts:40` `exists(fresh/snapshot) === false`; `:44` `deepEqual(readTree(snapshot), before)` | PASS |
| C20 | secret only in excluded path exits 0 | `^C20 ` passed at 76425f0 | carried from 2d36bb1: `test/scan.test.ts:50` `assert.equal(result.status, 0)` | PASS |
| C21 | tree `.gitleaks.toml` cannot allowlist | `^C21 ` passed at 76425f0 | carried from 2d36bb1: `test/scan.test.ts:55` allowlist `paths ['.*']`, `regexes ['ghp_.*']`; `:58` non-zero; `:59` `FINDING_LINE` | PASS |
| C22 | root `.gitleaksignore` with `src/…`, `tree/src/…`, `scan/tree/src/…` cannot ignore | `^C22 ` passed at 76425f0 | carried from 2d36bb1: `test/scan.test.ts:63-64` exactly those three paths `+ ":github-pat:1"`; `:68` non-zero; `:69` `FINDING_LINE` | PASS |
| C23 | `gitleaks:allow` cannot silence | `^C23 ` passed at 76425f0 | carried from 2d36bb1: `test/scan.test.ts:74` `// gitleaks:allow`; `:76` non-zero; `:77` `FINDING_LINE` | PASS |
| C24 | gitleaks absent: non-zero, "scan did not complete", snapshot unchanged | `^C24 ` passed at 76425f0 | carried from 2d36bb1: `test/scan.test.ts:83-84` PATH = git's dir only; `:85` non-zero; `:86` `/secret scan did not complete \(gitleaks not found on PATH\)/`; `:87` `deepEqual(readTree(snapshot), before)` | PASS |
| C25 | error -> CLI non-zero; exit 0/42 without canary -> `buildSnapshot` rejects; both "scan did not complete", snapshot unchanged | both `^C25 ` tests passed at 76425f0 | carried from 2d36bb1: CLI half `test/scan.test.ts:95` node binary copied as `gitleaks(.exe)`, `:96-97` PATH puts it first; `:98` `notEqual(result.status, 0)`; `:99` `/secret scan did not complete \(gitleaks exited 1/`; `:100` `deepEqual(readTree(snapshot), before)`. In-process half `:107` `process.exit(1)`, `process.exit(0)`, `process.exit(42)`; `:111-115` `assert.rejects(buildSnapshot(...), /secret scan did not complete/)`; `:116` `deepEqual(..., before)` | PASS |
| C26 | failure at copy / scan / replace: no `.snapshot-*`, snapshot unchanged | `^C26 ` passed at 76425f0 | verified at 76425f0 (lines shifted +2): `test/snapshot.test.ts:183-196` four failures, including `"replace after moving"` (`:192`) which calls the real `replaceSnapshot(join(tree, "does-not-exist"), snapshot)` (`:194`); `:199` `rejects(..., step === "replace after moving" ? /ENOENT/ : new RegExp(\`${step} failed\`))`; `:200` `readdirSync(dir).filter(startsWith(".snapshot-")) == []`; `:201` `deepEqual(readTree(snapshot), before)` | PASS |
| C27 | one stdout line: 40-hex SHA + counts | `^C27 ` passed at 76425f0 | verified at 76425f0 (line shifted +2): `test/snapshot.test.ts:211` asserts `result.stdout` equals `snapshot ${sha}: 2 files copied, 1 excluded, 1 symlinks omitted, 0 submodules omitted` plus a newline | PASS |
| C28 | clone per README, exit 0, `.specs/` at pinned ref, absent from snapshot | `^C28 ` passed at 76425f0 (network) | carried from 2d36bb1: `test/example.test.ts:14` `assert.equal(clone?.[1], "https://github.com/obogoni/playground")`; `:21` `assert.equal(profile.ref, "60ff14809dc31c700f9f987add96aae48f72cb97")`; `:22` `excludePaths.includes(".specs")`; `:23` `ls-tree ref .specs` non-empty; `:26` `status === 0`; `:28` `exists(snapshot/.specs) === false` | PASS |
| C29 | check-ignore on the named paths | `^C29 ` passed at 76425f0 | carried from 2d36bb1: `test/example.test.ts:34` `check-ignore -q --no-index`; `:41-48` ignored, including the directories `profiles/example/snapshot/`, `…/transcripts/`, `…/repo/` (`:42-44`); `:50` `assert.equal(ignored(path), true)`; `:52-53` not ignored: `profiles/example/profile.yaml`, `profiles/example/README.md` | PASS |

## Reachability of the round 2 assertions - carried from 2d36bb1

- **C8 prior-snapshot case.** If the `repoPath` replace at `test/snapshot.test.ts:50` had not matched, the profile would still point at `outer`, the run would succeed as it did at `:48`, and `:51` would fail. So the failing run really targets `inner`. The case does not re-assert the stderr, but the loop at `:44` already covers naming the path.
- **C14 crafted tree.** I reproduced `commitCraftedGitDirs` in the scratchpad with the same `hash-object`, `mktree` and `commit-tree` sequence, then ran `git ls-tree -r --full-tree main`. The output lists `.git/config` and `lib/.git/hooks/x` next to `a.txt`, `lib/b.txt` and the `160000 vendor/sub` gitlink. So `listTree` now feeds `.git` segments into `copyTree`. They are skipped only by the guard at `src/snapshot/buildSnapshot.ts:78-83`. Without it, `:97-99` would write `snapshot/.git/config` and `:115` would fail. That guard is now reached.
- **C17 post-copy failure.** `/gitleaks found/` (now `:170`) is the `SecretsFoundError` from `src/snapshot/scan.ts:36`. It is raised after `steps.copy` (`buildSnapshot.ts:56-57`), so the failure is after staging and the copy. The state it compares against is re-judged under N1 below.
- **C25 CLI half.** The node binary copied as `gitleaks.exe` runs `node dir <scanRoot> …` and exits 1. `scan.ts:78` then produces `gitleaks exited 1: …`. The stub stands in for the binary on PATH, so the real `GITLEAKS` scanner path through `src/cli.ts` runs.
- **C26 "replace after moving".** (Test lines now +2.) A previous snapshot exists (now `:177`), so the real `replaceSnapshot` takes the move branch. `buildSnapshot.ts:115` renames `snapshot` to `<profile>/.snapshot-old-<hex>`, and `:117` fails with ENOENT on the missing source. ENOENT is not in `TRANSIENT_RENAME_CODES` (`:125`), so it is not retried. `:119` restores the old snapshot and `:120` rethrows. The old snapshot really is moved before the failure. If the restore at `:119` were dropped, now-`:200` would see a `.snapshot-old-*` entry and now-`:201` would fail on a missing `snapshot/`.

## Round 1 findings - carried from 2d36bb1

Line numbers in `test/snapshot.test.ts` at or after line 163 are as of 2d36bb1; add 2 for 76425f0 (G3: now `:192-196`; G7: now `:161-171`).

| Gap | Status | Evidence |
|---|---|---|
| G1 C18 path not anchored | closed | `test/scan.test.ts:10` `FINDING_LINE = /^  - src\/settings\.ts:1 \(rule github-pat\)$/m`, used at `:32`, `:59`, `:69`, `:77`. It matches the printed shape `  - ${path}:${line} (rule ${rule})` (`src/snapshot/scan.ts:37`), and a `tree/` or `scan/tree/` prefix or an absolute path now fails |
| G2 C25 level gap and undeclared exception | closed | CLI test `test/scan.test.ts:90-101` asserts `notEqual(result.status, 0)` (`:98`) and stderr (`:99`). The checklist now scopes C25 to the CLI for the error case and to `buildSnapshot` for the silent case, and the Coverage note declares the silent half as a second exception (`.checks/profile-snapshot.md:117`, `:165`) |
| G3 C26 replace skipped the risky branch | closed | `test/snapshot.test.ts:190-194` drives the real `replaceSnapshot` through its move-then-fail-then-restore path (see reachability); Coverage row now has 4 members (`.checks/profile-snapshot.md:163`) |
| G4 C8 unchanged only when absent | closed | `test/snapshot.test.ts:47-52`, `assert.deepEqual(readTree(join(dir, "snapshot")), before)` |
| G5 Landing drift / C22 precision | closed at 76425f0 via N2 (was partly closed at 2d36bb1) | The Scan root row now matches the code: `scan/tree/`, `scan/canary.txt`, `ignore/` and `report.json` (`.checks/profile-snapshot.md:30` vs `buildSnapshot.ts:53-57`, `scan.ts:51-54`). C22 lists the three forms (`:108`), and they match `test/scan.test.ts:63`. Still open: the *gitleaks invocation* row (`.checks/profile-snapshot.md:32`) reads `gitleaks dir <staging> … --gitleaks-ignore-path <scan dir>/ignore … --report-path <scan dir>/report.json`, but the code runs `dir <staging>/scan` with ignore and report in `<staging>` (`scan.ts:58-59`, `:52`, `:54`). The fix did not touch that row. Checklist-only; no test depends on it |
| G6 C13 precision | closed | C13 was reworded to the five shapes the test actually uses (`.checks/profile-snapshot.md:79` = `test/snapshot.test.ts:101`) |
| G7 C17 failure before copy only | closed (N1 closed at 76425f0) | `test/snapshot.test.ts:161-169` adds a failure after the copy |
| G8 C14 `.git` half vacuous | closed | Crafted tree puts `.git/config` and `lib/.git/hooks/x` into `ls-tree` output (reproduced); `:115` now discriminates |
| G9 C28 expected values not readable | closed | `test/example.test.ts:14` and `:21` compare against the literal URL and SHA |
| G10 C28 copy filter broken on Windows | closed | `test/example.test.ts:17` is now `[\\/]`. I read the regex source from the file and tested it: it returns `true` for `M:\a\profiles\example\repo` and `…\snapshot`, and `false` for `…\README.md` |
| G11 C29 files, not directories | closed | `test/example.test.ts:42-44` |
| G12 C1 only checks the working directory | accepted as-is | Checklist C1 (`.checks/profile-snapshot.md:41`) claims only "the working directory gains no entry". `test/profile.test.ts:15` `assert.deepEqual(readdirSync(cwd), [])` asserts exactly that. Against the checklist there is no gap. The narrowing from the task is a checklist choice, and step 1 does not run under `light` |

## Round 2 findings - verified at 76425f0

| Gap | Status | Evidence |
|---|---|---|
| N1 C17 post-copy leg ran against a clean working tree | closed | After the leak commit (`test/snapshot.test.ts:162`, whose `git add -A` commits the earlier dirt), `:163` rewrites the now-tracked `a.txt` from `"dirty"` to `"dirty again"`, a real modification, and `:164` writes a new `another-untracked.txt`. `:166` `assert.notEqual(beforeLeak.status, "")` fails the test if the tree is clean at that point; it passed at 76425f0, so `beforeLeak.status` is non-empty. `:171` `deepEqual(repoState(repo), beforeLeak)` therefore compares a dirty porcelain (tracked modification plus untracked file), and a post-copy `reset --hard`, `checkout -- .` or `clean` would change it and fail `:171`. HEAD and branch are still compared |
| N2 gitleaks invocation row did not match the code | closed | `.checks/profile-snapshot.md:32` now reads `gitleaks dir <staging>/scan ... --gitleaks-ignore-path <staging>/ignore ... --report-path <staging>/report.json`. Code: `src/snapshot/buildSnapshot.ts:53` `scanRoot = join(staging, "scan")`, `:57` `steps.scan(scanRoot, staging)`, `:42` forwards to `scanForSecrets(scanRoot, workDir, ...)`; `src/snapshot/scan.ts:58-59` `"dir", scanRoot`; `:52` `ignoreDir = join(workDir, "ignore")` passed at `:62-63`; `:54` `reportPath = join(workDir, "report.json")` passed at `:72-73`. With `workDir = staging` all three paths match the row, and the row now agrees with the Scan root row at `:30` |

## New findings - verified at 76425f0

None. The fix changes two fixture writes and adds one assertion (`test/snapshot.test.ts:163-166`); no `src/` file changed, and no other check is affected beyond the +2 line shift refreshed above.

## Swept rows resolving to existing - carried from 2d36bb1

None. Every Swept row points at a check or says *not in scope*.

## Coverage join - carried from 2d36bb1

Did not run: the join recompute is `standard`/`ui` only. (The `failing steps` row has 4 members, each with a C26 case, now at `test/snapshot.test.ts:183-196`. Round 3 touched no Coverage authority.)

## Test policy rows - carried from 2d36bb1

Did not run: `standard`/`ui` only; the checklist has no `Test policy` section.

## Faults injected - carried from 2d36bb1

Did not run: `standard`/`ui` only. Reachability of the new assertion surfaces was checked by reading and by scratch reproduction (above) instead. Round 3: the one new assertion (`test/snapshot.test.ts:166`) guards the fixture precondition itself and passed.

## Gate - verified at 76425f0

`npx tsc --noEmit` - exit 0.
