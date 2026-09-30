# Project profile + filtered snapshot

Sources:

- `.tasks/profile-snapshot.md` - the task: criteria 1-20, Decided, Unresolved defaults (the record of decision)
- Issue #1 - what block 1 delivers
- `.design/veteran.md` - *Profile* and *Path exclusion* rows, *Adds* lines for block 1
- gitleaks 8.30.1 `dir --help` and probes run 2026-09-30 (scratchpad) - precedence of `--config`, `-i`, `--ignore-gitleaks-allow`; that `<scan root>/.gitleaksignore` is honoured even with `-i`, nested ones are not; that an unreadable target exits `0` with "no leaks found"
- Conversation 2026-09-30 - Playground as the example codebase; glob dialect; replace on success only

## Out of scope

- Using `language`, `instructions`, `denyTerms`, `versionCaveat` - blocks 3 and 4
- Adding `@anthropic-ai/claude-agent-sdk` - no caller before block 3
- Custom gitleaks rules, built-in default exclusions, per-customer refs, container - task Out of scope
- Cleaning staging directories left by a killed process - task criterion 17 covers failing steps; concurrent runs are unguarded (task Unresolved 6), so deleting another run's staging is not safe
- Files gitleaks skips because it cannot read them - every file in the scan root was just written by this process; the canary proves the scan ran, not that every file was read

## Landing

Greenfield: `package.json`, `src/profile/loadProfile.ts`, `src/snapshot/{glob,git,scan,buildSnapshot}.ts`, `src/cli.ts`, `config/gitleaks.toml`, `profiles/example/`, `.gitignore`, tests under `test/`. No existing convention to reuse; the design doc's *Adds* list is the layout.

| One-way door | Literal shape | Alternative rejected |
| --- | --- | --- |
| Stack, entry point (task) | TypeScript on Node; `package.json` `bin.veteran` → `src/cli.ts`; `veteran snapshot` | Python - design doc |
| TypeScript runs without a build | Node ≥ 24 native type stripping; `tsc --noEmit` with `erasableSyntaxOnly`, `allowImportingTsExtensions`; imports carry `.ts`; tests on `node:test` | `tsc` to `dist/` + vitest - a build step and two dev dependencies for a CLI whose only consumer is Node 24 (and the Docker image of block 5) |
| Profile contract (task) | `profile.yaml`: `name`, `repoPath`, `ref`, `language`, `versionCaveat` strings; `instructions`, `excludePaths`, `denyTerms` string lists; YAML parsed with the `yaml` package | one profile per codebase in the repo - public repo |
| `excludePaths` dialect (task) | only `*` (not crossing `/`) and `**` (crossing) are wildcards; every other character, including `?`, `[`, `{`, matches literally; case-sensitive; a match on any ancestor directory excludes the path; `!` prefix rejected | picomatch/minimatch - brings braces, extglobs and character classes the chosen dialect never promised, so a pattern would silently mean more than its author read |
| Snapshot read from git objects, not a checkout or archive | `git rev-parse --verify --end-of-options <ref>^{commit}`, `git ls-tree -r -z --full-tree <sha>`, `git cat-file --batch`; mode `120000` (symlink) and `160000` (submodule) never written | `git archive` - honours the target's `export-subst`/`export-ignore` attributes, so content would stop being byte-identical to the blob; a checkout mutates `repoPath` |
| Scan root isolated from the tree | staging is `<profile>/.snapshot-staging-<random>/` holding `tree/` (the future snapshot) and `canary.txt`; gitleaks scans the staging root, so the target's root `.gitleaksignore` sits at `tree/.gitleaksignore`, where gitleaks does not read it; on success `tree/` is renamed to `snapshot/` | scanning `tree/` with `-i <empty dir>` - probe showed gitleaks still honours `<scan root>/.gitleaksignore` |
| Canary proves the scan ran | a random GitHub-PAT-shaped token generated per run in `canary.txt`; the scan counts only if gitleaks exits with `--exit-code 42` and the JSON report lists the canary; any other finding aborts | trusting exit `0` - probe showed gitleaks exits `0` with "no leaks found" when it cannot read its target |
| gitleaks invocation (task) | `gitleaks dir <staging> --config config/gitleaks.toml --gitleaks-ignore-path <scan dir>/ignore --ignore-gitleaks-allow --redact --no-banner --no-color --exit-code 42 --report-format json --report-path <scan dir>/report.json`, `GITLEAKS_CONFIG*` removed from the child env | default invocation - task Decided |
| Replace on success only (task) | rename `snapshot/` → `.snapshot-old-<random>`, `tree/` → `snapshot/`, delete old; on failure delete staging, restore old if moved | delete old on abort - task Decided |

- Nothing else in this change is hard to reverse

## Checks

### S1 - The profile loads, or says exactly what is wrong · ~8 files · ~6k

**C1** - With `VETERAN_PROFILE_DIR` unset or empty, `veteran snapshot` exits non-zero, stderr names `VETERAN_PROFILE_DIR`, and the working directory gains no entry
Proof: `node --test --test-name-pattern="^C1 " test/profile.test.ts`

**C2** - A missing `profile.yaml` exits non-zero with its absolute path in stderr
Proof: `node --test --test-name-pattern="^C2 " test/profile.test.ts`

**C3** - An invalid-YAML `profile.yaml` exits non-zero with its absolute path in stderr
Proof: `node --test --test-name-pattern="^C3 " test/profile.test.ts`

**C4** - A `profile.yaml` missing all 8 fields names each of the 8 in one run, before any git command (proved with `git` absent from `PATH`)
Proof: `node --test --test-name-pattern="^C4 " test/profile.test.ts`

**C5** - A wrongly-typed field (string list given a string, string given a list, list with a non-string item) is named
Proof: `node --test --test-name-pattern="^C5 " test/profile.test.ts`

**C6** - A relative `repoPath` resolves against `VETERAN_PROFILE_DIR`, not the working directory
Proof: `node --test --test-name-pattern="^C6 " test/snapshot.test.ts`

**C7** - A relative `instructions` entry resolves against `VETERAN_PROFILE_DIR`; one that does not exist exits non-zero naming the entry
Proof: `node --test --test-name-pattern="^C7 " test/profile.test.ts`

**C8** - A `repoPath` that is not a git repository - including a plain directory inside another repository - exits non-zero naming the path, `snapshot/` unchanged
Proof: `node --test --test-name-pattern="^C8 " test/snapshot.test.ts`

**C9** - A `ref` that does not resolve to a commit exits non-zero naming the ref, `snapshot/` unchanged
Proof: `node --test --test-name-pattern="^C9 " test/snapshot.test.ts`

**C10** - An `excludePaths` entry starting with `!` exits non-zero naming the entry
Proof: `node --test --test-name-pattern="^C10 " test/profile.test.ts`

### S2 - The snapshot is the committed tree at `ref`, minus exclusions · ~5 files · ~8k

**C11** - `snapshot/` holds exactly the files tracked at `ref` matching no exclusion, each byte-identical to its blob (CRLF and binary content included); untracked files and uncommitted edits are absent
Proof: `node --test --test-name-pattern="^C11 " test/snapshot.test.ts`

**C12** - The glob dialect decides the task's four examples plus the literal-character rule: `config` and `config/**` exclude `config/app/secrets.json`; `*.pem` excludes `key.pem`, not `certs/key.pem`; `**/*.pem` excludes both; `Config/**` does not exclude `config/a.txt`; `a?.txt` does not exclude `ab.txt`
Proof: `node --test --test-name-pattern="^C12 " test/glob.test.ts`

**C13** - The glob dialect is applied by the snapshot itself: a repo with those paths yields a snapshot missing exactly the excluded ones
Proof: `node --test --test-name-pattern="^C13 " test/snapshot.test.ts`

**C14** - `snapshot/` contains no `.git` entry at any depth, and a submodule gitlink is not written
Proof: `node --test --test-name-pattern="^C14 " test/snapshot.test.ts`

**C15** - Symlinks tracked at `ref` (one to a path inside the repo, one outside) are absent from `snapshot/` and counted as `2 symlinks omitted`
Proof: `node --test --test-name-pattern="^C15 " test/snapshot.test.ts`

**C16** - A second successful run replaces `snapshot/` wholesale: a file deleted at the new `ref` and a file newly excluded are both absent
Proof: `node --test --test-name-pattern="^C16 " test/snapshot.test.ts`

**C17** - `HEAD`, the checked-out branch and `git status --porcelain` of `repoPath` are identical before and after a successful run and after a failed one
Proof: `node --test --test-name-pattern="^C17 " test/snapshot.test.ts`

### S3 - A secret anywhere in the snapshot stops it · ~4 files · ~6k

**C18** - A detectable secret in a non-excluded file exits non-zero; stderr carries its repo-relative path and rule id `github-pat`; the secret value appears in neither stdout nor stderr
Proof: `node --test --test-name-pattern="^C18 " test/scan.test.ts`

**C19** - After the C18 abort, `snapshot/` is byte-identical to its state before the run, and absent when there was none
Proof: `node --test --test-name-pattern="^C19 " test/scan.test.ts`

**C20** - The same secret only in an excluded path exits `0`
Proof: `node --test --test-name-pattern="^C20 " test/scan.test.ts`

**C21** - A `.gitleaks.toml` in the tree that allowlists the secret's path does not stop the abort
Proof: `node --test --test-name-pattern="^C21 " test/scan.test.ts`

**C22** - A root `.gitleaksignore` in the tree listing the secret's fingerprint in every plausible form does not stop the abort
Proof: `node --test --test-name-pattern="^C22 " test/scan.test.ts`

**C23** - A `gitleaks:allow` comment on the secret's line does not stop the abort
Proof: `node --test --test-name-pattern="^C23 " test/scan.test.ts`

**C24** - With `gitleaks` absent from `PATH`, the run exits non-zero, stderr says the scan did not complete, `snapshot/` unchanged
Proof: `node --test --test-name-pattern="^C24 " test/scan.test.ts`

**C25** - A scanner that exits with an error, or exits `0` without reporting the canary, aborts with "scan did not complete", `snapshot/` unchanged
Proof: `node --test --test-name-pattern="^C25 " test/scan.test.ts`

**C26** - A failure at each step after the copy begins - copy, scan, replace - leaves no `.snapshot-*` entry under `VETERAN_PROFILE_DIR` and `snapshot/` unchanged
Proof: `node --test --test-name-pattern="^C26 " test/snapshot.test.ts`

**C27** - A successful run prints one stdout line with the resolved 40-hex SHA and the counts of files copied, excluded and symlinks omitted, matching the fixture
Proof: `node --test --test-name-pattern="^C27 " test/snapshot.test.ts`

### S4 - The example works; real profiles cannot be committed · ~5 files · ~2k

**C28** - Cloning `https://github.com/obogoni/playground` into a copy of `profiles/example/repo/` as its README says, `veteran snapshot` exits `0`, and `.specs/` exists at the pinned `ref` and is absent from `snapshot/`
Proof: `node --test --test-name-pattern="^C28 " test/example.test.ts`

**C29** - `git check-ignore` ignores `profiles/acme/profile.yaml`, `profiles/example/snapshot/`, `profiles/example/transcripts/`, `profiles/example/repo/`, and does not ignore `profiles/example/profile.yaml` or `profiles/example/README.md`
Proof: `node --test --test-name-pattern="^C29 " test/example.test.ts`

**Gate** - `npx tsc --noEmit` exits `0`
Proof: `npx tsc --noEmit`

## Handoff

S1-S4 ≈ 22k by file size, all new code in one package - one batch, no handoff.

## Swept

- validation: C2, C3, C4, C5, C7, C10
- failure modes: C18, C24, C25, C26
- idempotency and retry: C16
- authorization: not in scope - local command with the operator's filesystem permissions (task)
- concurrency and ordering: not in scope - unguarded, task Unresolved 6
- data lifecycle: C16, C19, C26
- external-dependency failure: C8, C9 (git), C24, C25 (gitleaks)
- state transitions: not in scope - no lifecycle beyond replace (task)
- observability: C27

## Coverage

| Set (size) | Member -> proof | Unproven |
| --- | --- | --- |
| profile fields (8) | table-driven over all 8 in C4 | - |
| field kinds (2) | string C5 · string list C5 | - |
| glob cases (6) | `config` C12 · `config/**` C12 · `*.pem` C12 · `**/*.pem` C12 · case C12 · literal `?` C12 | - |
| tree entry modes (4) | blob C11 · executable blob C11 · symlink C15 · gitlink C14 | - |
| gitleaks bypasses (3) | `.gitleaks.toml` C21 · `.gitleaksignore` C22 · `gitleaks:allow` C23 | - |
| scan outcomes (4) | finding C18 · clean C20 · missing binary C24 · error / silent exit C25 | - |
| failing steps (3) | copy C26 · scan C26 · replace C26 | - |

- Claims naming an exit status or printed output: C1-C4, C7-C10, C18, C20, C24, C25, C27, C28 - each proof runs the `veteran` CLI as a child process except C26, which injects step failures into `buildSnapshot` because a real copy or rename failure cannot be forced portably
- No other check claims more than the single case its proof exercises
