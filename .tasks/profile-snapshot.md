# Project profile + filtered snapshot

> Build this with **tlc-implement**.
> Every criterion below becomes a check with a proof, referenced by its number. Nothing under
> `Unresolved` gets settled while building.

## Intent

The agent Veteran will run reads a codebase that holds files nobody outside development should see: connection strings, gateway keys, configuration with credentials. A prompt instruction not to read them is not a guarantee - the source roadmap itself reports that failure - and a leaked secret cannot be undone. Everything specific to the target codebase must also stay out of this personal, public repository, yet today there is no place outside it to put that knowledge and nothing that produces a copy of the code the agent is allowed to read.

When this ships, an operator points `VETERAN_PROFILE_DIR` at a profile directory kept outside git and runs `veteran snapshot`. It copies the profile's `ref` into `<VETERAN_PROFILE_DIR>/snapshot/` with every `excludePaths` match physically absent, and refuses to produce a snapshot at all if gitleaks finds a secret in what remains. An example profile over a small public codebase shows the whole flow working from a fresh clone.

20 criteria in 4 slices · 6 one-way doors · 6 open, of which 0 block

## Criteria

### The profile loads, or says exactly what is wrong

1. When `veteran snapshot` runs with `VETERAN_PROFILE_DIR` unset or empty, then it exits non-zero, prints that `VETERAN_PROFILE_DIR` is not set, and creates no file or directory.
2. Given `<VETERAN_PROFILE_DIR>/profile.yaml` does not exist or is not valid YAML, when `veteran snapshot` runs, then it exits non-zero and the message contains the absolute path of that `profile.yaml`.
3. Given `profile.yaml` lacks any of `name`, `repoPath`, `ref`, `language`, `instructions`, `excludePaths`, `denyTerms`, `versionCaveat`, or one of them has the wrong type (`instructions`, `excludePaths`, `denyTerms` are lists of strings; the rest are strings), when `veteran snapshot` runs, then it exits non-zero naming **every** offending field in one run, and runs no git command.
4. Given `repoPath` or an `instructions` entry is a relative path, then it resolves against `VETERAN_PROFILE_DIR`, not the current working directory; given an `instructions` entry resolves to a file that does not exist, the run exits non-zero naming that entry.
5. Given `repoPath` is not a git repository, or `ref` does not resolve to a commit in it, when `veteran snapshot` runs, then it exits non-zero naming the path or the ref, and `snapshot/` is unchanged.
6. Given an `excludePaths` entry starts with `!`, when `veteran snapshot` runs, then it exits non-zero naming the entry - negation does not exist in this syntax, and a pattern that reads like it does must not be silently taken as literal.

### The snapshot is the committed tree at `ref`, minus the exclusions

7. Given a valid profile, when `veteran snapshot` exits 0, then `<VETERAN_PROFILE_DIR>/snapshot/` contains exactly the files tracked at `ref` that match no `excludePaths` entry, each byte-identical to its blob at `ref`; untracked files and uncommitted changes in `repoPath` are absent.
8. `excludePaths` entries match repo-relative paths with `/` as separator, case-sensitively: `*` does not cross `/`, `**` does, and a pattern that matches a directory excludes its whole subtree. Concretely: `config` and `config/**` both exclude `config/app/secrets.json`; `*.pem` excludes `key.pem` but not `certs/key.pem`; `**/*.pem` excludes both; `Config/**` does not exclude `config/a.txt`.
9. Always, `snapshot/` contains no `.git` entry at any depth, because the history holds the content of excluded paths.
10. Always, `snapshot/` contains no symbolic links: a symlink tracked at `ref` is omitted, whether it points inside or outside the repository, and counted in the summary (criterion 18).
11. Given a previous `snapshot/` exists, when a run exits 0, then the previous content is replaced wholesale: a file present in the old snapshot that is deleted at the new `ref`, or that now matches an `excludePaths` entry, is absent.
12. Always, `veteran snapshot` leaves `repoPath` as it found it: `HEAD`, the checked-out branch and `git status --porcelain` are identical before and after the run, including a failed one.

### A secret anywhere in the snapshot stops it

13. Given a file tracked at `ref`, matching no `excludePaths` entry, contains a secret the gitleaks default ruleset detects, when `veteran snapshot` runs, then it exits non-zero, prints the file's repo-relative path and the gitleaks rule id with the secret value redacted, and `snapshot/` is byte-identical to its state before the run (absent if it did not exist).
14. Given the same secret sits only in a path matching an `excludePaths` entry, when `veteran snapshot` runs, then it exits 0.
15. Given the tree at `ref` also ships a `.gitleaks.toml` or `.gitleaksignore` that allowlists that secret, or the secret's line carries a `gitleaks:allow` comment, when `veteran snapshot` runs, then the outcome is still the one in criterion 13.
16. If `gitleaks` is not on `PATH` or exits with an error rather than a finding, then `veteran snapshot` exits non-zero stating that the scan did not complete, and `snapshot/` is byte-identical to its state before the run.
17. If any step fails after the copy begins (copy, scan, replace), then no staging directory remains under `VETERAN_PROFILE_DIR` and `snapshot/` is byte-identical to its state before the run.
18. When a run exits 0, then it prints one summary line with the commit SHA `ref` resolved to, the number of files copied, the number of files excluded and the number of symlinks omitted.

### The example profile works; real profiles cannot be committed

19. Given a fresh clone of this repository and `https://github.com/obogoni/playground` cloned into `profiles/example/repo/` as `profiles/example/README.md` instructs, with the example profile at `repoPath: ./repo` and `ref: 60ff14809dc31c700f9f987add96aae48f72cb97`, when `VETERAN_PROFILE_DIR=profiles/example veteran snapshot` runs, then it exits 0 and `.specs/` - present at that `ref` and listed in the example's `excludePaths` - is absent from `profiles/example/snapshot/`.
20. `git check-ignore` reports `profiles/<name>/profile.yaml` as ignored for any `<name>` other than `example`, and reports `profiles/example/snapshot/`, `profiles/example/transcripts/` and the fetched example codebase as ignored, while `profiles/example/profile.yaml` and `profiles/example/README.md` are not ignored.

## Out of scope

- Using `language`, `instructions`, `denyTerms` or `versionCaveat` - loaded and validated here, consumed by blocks 3 and 4.
- The real profile for the target codebase and its `excludePaths` list - lives outside this repository by decision; authoring it is the operator's work alongside block 2.
- A custom gitleaks ruleset or per-profile allowlist - not in the source; a false positive is resolved by adding the path to `excludePaths`.
- Built-in default exclusions (`.env`, `*.pem`, ...) - not in the source; gitleaks is the backstop.
- Per-customer branches or versions - Boundary Out in the design doc; `ref` is the main branch with a caveat.
- Running inside the container - block 5.

## Observable

| Surface | Decision | Landing |
| --- | --- | --- |
| command `veteran snapshot` | output format and verbosity | 18, 13; format Unresolved 4 |
| command `veteran snapshot` | every flag and its default | n/a - the source defines no flags; the profile is selected only by `VETERAN_PROFILE_DIR` |
| command `veteran snapshot` | exit codes | 1, 2, 3, 5, 6, 13, 16 (non-zero), 7 (0); distinct codes Unresolved 4 |
| command `veteran snapshot` | what it prints when it fails halfway | 13, 16, 17 |
| document `profiles/example/README.md` | structure, depth | 19 - one clone command, the env var, the run command |
| document `profiles/example/README.md` | what the reader does next | 19 |
| document `profile.yaml` | structure | 3, 8 |

## Swept

- validation: 2, 3, 4, 6
- failure modes: 13, 16, 17
- idempotency and retry: 11
- authorization: n/a - a local command running with the operator's filesystem permissions; no caller identity exists before block 8
- concurrency and ordering: Unresolved 6
- data lifecycle: 11, 17
- external-dependency failure: 5 (git), 16 (gitleaks)
- state transitions: n/a - a snapshot is either the previous one or the new one; there is no lifecycle beyond the replacement in 11 and 17
- observability: 18; snapshot duration on the 21 GB target is a service target measured when block 3 reports latency, not a criterion here

## Impact

| Front | What changes |
|---|---|
| domain | new term: `Profile` - everything specific to one target codebase, read from `<VETERAN_PROFILE_DIR>/profile.yaml`, never inside this repository except `profiles/example/` |
| domain | new term: `Snapshot` - the committed tree at the profile's `ref`, minus `excludePaths`, gitleaks-clean, at `<VETERAN_PROFILE_DIR>/snapshot/`; the only code the agent will ever read |
| domain | new term: `excludePaths` - repo-relative globs with the dialect in criterion 8 |
| stored data | nothing to migrate - the repository has no code yet |
| tooling | new runtime requirement on every machine that builds a snapshot: `git` and `gitleaks` on `PATH`; block 5's image inherits it |

## Decided

| Decision | Shape | Alternative rejected |
|---|---|---|
| Stack and entry point | TypeScript on Node; `package.json` exposes the `veteran` binary with the `snapshot` subcommand (later `ask`, `eval`) | Python SDK - the design doc chose one language for agent, validation and the pilot web chat |
| Profile contract | `profile.yaml` in `VETERAN_PROFILE_DIR`: `name: string`, `repoPath: string`, `ref: string`, `language: string` (e.g. `"pt-BR"`), `instructions: string[]` (`.md` files), `excludePaths: string[]`, `denyTerms: string[]`, `versionCaveat: string` | One profile per codebase inside the repo - only viable for public codebases, and this repository is public |
| `excludePaths` dialect | Simple glob, criterion 8: repo-relative, `/`, case-sensitive, `**` crosses directories, directory match excludes the subtree, no negation (`!` rejected, criterion 6) | `.gitignore` syntax - `!` lets one line re-include what another excluded, and unanchored patterns match at any depth, so a profile author can expose a path without seeing it (user choice, 2026-09-30) |
| Physical exclusion | The snapshot is a fresh tree built from `ref` with excluded paths never written, no `.git`, no symlinks (criteria 7, 9, 10) | Per-tool deny in the SDK - depends on the SDK obeying; a `.git` or a symlink would reopen every excluded path |
| Secret gate isolated from the target repo | `gitleaks dir <staging>` run with `--config config/gitleaks.toml`, committed in this repository (`[extend] useDefault = true`), `--gitleaks-ignore-path` pointing at a directory outside the snapshot, `--ignore-gitleaks-allow` and `--redact`; any finding or error aborts | Default invocation - gitleaks loads `.gitleaks.toml` from the scanned directory when `--config` is unset and honours `gitleaks:allow` comments, so the target repo could allowlist its own secrets (same class as `settingSources: []`) |
| Replace on success only | Build into a staging directory under `VETERAN_PROFILE_DIR`, scan it, then replace `snapshot/`; on any failure delete staging and leave `snapshot/` untouched (criteria 11, 13, 17) | Delete the previous snapshot on abort - takes down a snapshot that had already passed the scan (user choice, 2026-09-30) |

## Surface

| Route | In | Out | Status | Criteria |
|---|---|---|---|---|
| `veteran snapshot` | env `VETERAN_PROFILE_DIR`; `<dir>/profile.yaml` | `<dir>/snapshot/`; one summary line on stdout; errors on stderr | `0` success, non-zero on any failure | 1-18 |

## Sources

- Issue #1, `Block 1: Project profile + filtered snapshot` - what the block delivers.
- `.design/veteran.md`, rows *Profile* and *Path exclusion* in Decisions, and the *Adds* lines for `loadProfile.ts`, `buildSnapshot.ts`, `profiles/example/` and `.gitignore` - the profile shape and "physical exclusion + gitleaks aborts the snapshot", copied literally into `Decided`.
- gitleaks README (`github.com/gitleaks/gitleaks`, fetched 2026-09-30) - config precedence ending in "a `.gitleaks.toml` file within the target path", `--gitleaks-ignore-path` defaulting to `.`, `--ignore-gitleaks-allow`, `--redact`, exit code 1 for both a finding and an error.
- User answers in this conversation, 2026-09-30 - `excludePaths` uses the simple glob dialect; an aborted run leaves the previous snapshot intact; the example profile runs over the author's public `obogoni/playground` repository (~5 MB, 649 tracked files, TypeScript), pinned to `60ff148`. It carries no licence file; it is the author's own repository, cloned rather than vendored.

This task is the record of decision. If a linked document diverges, ask before building.

## Unresolved

| # | Kind | Question | Until answered |
|---|---|---|---|
| 1 | open | Do relative `repoPath` and `instructions` paths resolve against the profile directory? | Written as yes in criterion 4 - the only reading under which a profile directory can move between machines |
| 2 | open | Are tracked symlinks omitted rather than dereferenced? | Written as omitted in criterion 10 - dereferencing would need its own check that the target is inside the repo and not excluded |
| 3 | open | Does a missing `gitleaks` abort the run? | Written as abort in criterion 16 - fail closed, as everywhere else in the design |
| 4 | open | Summary line format and exit codes | Every failure exits `1`; the summary is plain text on one line; findings go to stderr, redacted. Distinct codes per failure class are not promised |
| 5 | open | Does a `!`-prefixed `excludePaths` entry fail validation? | Written as yes in criterion 6 |
| 6 | open | Two `veteran snapshot` runs on the same profile at once are not guarded, and nothing yet reads `snapshot/` during the replace | Unguarded; a single operator runs it by hand. Block 3 decides how `ask` behaves if it reads during a replace |
