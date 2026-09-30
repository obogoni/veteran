# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Veteran answers business-rule questions from non-technical people (support) using a read-only agent over a filtered snapshot of a codebase. Answers use business terms and never include code, internal names or secrets. The full design, including a roadmap of 8 blocks and a table of literal decisions, is in `.design/veteran.md`. Read it before starting a new block. The decisions there carry their exact shape, so copy them instead of re-deriving them. Only block 1 (profile + filtered snapshot) exists so far, so there is no `ask`/`eval` command and no Agent SDK dependency yet.

## Commands

TypeScript runs directly on Node 24+ (type stripping). There is no build step.

```sh
npm test                                                  # all suites: node --test test/*.test.ts
node --test --test-name-pattern "C17" test/snapshot.test.ts   # a single test (names start with their checklist ID)
npm run typecheck                                         # tsc --noEmit
VETERAN_PROFILE_DIR=profiles/example node src/cli.ts snapshot
```

The tests need `git` and `gitleaks` (8.19 or later) on `PATH`. `test/example.test.ts` also clones `github.com/obogoni/playground` over the network. The CLI's only command is `veteran snapshot`, which exits `1` with the reason on stderr for any failure.

## Architecture

- `src/profile/loadProfile.ts` reads `<VETERAN_PROFILE_DIR>/profile.yaml` and validates every field, reporting all errors in one run. Relative paths resolve against the profile directory, not the cwd. It also rejects `excludePaths` entries that start with `!`.
- `src/snapshot/buildSnapshot.ts` orchestrates the snapshot: resolve `ref` to a SHA → copy into a `.snapshot-staging-*` directory inside the profile dir → scan → atomically swap it in as `snapshot/`. The previous snapshot is replaced only on success, and the staging directory is always removed. The steps (`copy`/`scan`/`replace`) and the `Scanner` can be injected through `SnapshotOptions`, so tests can force each step to fail.
- `src/snapshot/git.ts` reads the repository **read-only**, with `rev-parse`, `ls-tree` and a persistent `cat-file` reader. The copy comes from the committed tree at `ref`, never from the working tree. The source repo's working tree, index and HEAD must never be touched.
- `src/snapshot/glob.ts` implements the custom `excludePaths` dialect: `*` stays within one segment, `**` crosses segments, a directory match excludes its subtree, matching is case-sensitive, and there is no negation. `.git`, symlinks (mode 120000) and submodules are always skipped.
- `src/snapshot/scan.ts` runs gitleaks with hardening that is easy to break by accident:
  - `--config config/gitleaks.toml` is always passed, so a `.gitleaks.toml` inside the scanned code is never loaded.
  - It scans `<staging>/scan`, one level **above** `tree/`, because gitleaks reads a `.gitleaksignore` at the scan root even when `--gitleaks-ignore-path` points elsewhere.
  - It also passes `--ignore-gitleaks-allow`, redacts findings and strips `GITLEAKS_*` env vars.
  - Each run plants a fresh canary secret, because gitleaks exits `0` when it cannot read its target. If the canary is not reported, the scan counts as incomplete and the snapshot is aborted.

  Every one of these points is fail-closed on purpose. Keep them.
- Windows: renames retry on transient `EPERM`/`EACCES`/`EBUSY` (antivirus/indexer locks), and `rmSync` uses `maxRetries`.

Tests build throwaway repos and profiles in the OS temp directory through `test/helpers.ts` (`makeRepo`, `commitFiles`, `commitRawEntry` for symlink/gitlink entries, `makeProfile`, `runCli`).

## Workflow and conventions

- Each roadmap block goes through the same stages. The block is planned into `.tasks/<block>.md` with numbered criteria (tlc-plan). It is implemented against a checklist in `.checks/<block>.md` (tlc-implement). An independent verifier then records its report in `.checks/<block>.verified.md`. Test names carry the checklist ID (e.g. `C28 ...`), so keep that link when you add or change tests.
- One GitHub issue per roadmap block. Commit directly to `main`, with no topic branches or PRs. Use Conventional Commits (`feat:`, `test:`, `docs:`, `build:`).
- This repository is personal and public. Real profiles hold target-codebase knowledge and live outside it: `.gitignore` ignores `profiles/*` except `profiles/example/`. Names, data or details from the target (employer) codebase must never go into files, commits or issues.
- Docs, code, commits and issues are in English. End-user answers follow the profile's `language`.
- Profile fields `language`, `instructions`, `denyTerms` and `versionCaveat` are validated now but have no consumer until blocks 3–4.
