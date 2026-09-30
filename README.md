# Veteran

Veteran is meant to be the "veteran senior developer" that non-technical people can ask about business rules that are only documented in the code. It answers in business terms and never hands out code, internal names or secrets. Everything specific to one codebase lives in a **profile** kept outside this repository.

The full design is in [`.design/veteran.md`](.design/veteran.md), and the roadmap is tracked as one GitHub issue per block.

## Status

Block 1 of 8 is done: **profile + filtered snapshot**. Veteran cannot answer questions yet. That starts with block 3 (headless PoC).

What works today:

- **Profiles.** `profile.yaml` is loaded from `VETERAN_PROFILE_DIR` and validated. Every invalid field is reported in a single run.
- **`veteran snapshot`.** It copies the committed tree at the profile's `ref` into `<VETERAN_PROFILE_DIR>/snapshot/`.
  - `excludePaths`, `.git`, symlinks and submodules are physically left out.
  - The copy is scanned with gitleaks, and any finding or scan failure aborts it.
  - The previous snapshot is replaced only when the new one is clean.
  - The source repository is never modified.
- **Example profile** over [obogoni/playground](https://github.com/obogoni/playground), in [`profiles/example/`](profiles/example/).

## Requirements

- Node.js 24 or later. TypeScript runs directly, with no build step.
- `git` on `PATH`.
- [gitleaks](https://github.com/gitleaks/gitleaks) 8.19 or later on `PATH` (tested with 8.30.1). On Windows: `winget install Gitleaks.Gitleaks`.

## Quick start

From the repository root:

```sh
npm install
git clone https://github.com/obogoni/playground profiles/example/repo
VETERAN_PROFILE_DIR=profiles/example node src/cli.ts snapshot
```

On success it prints one line:

```
snapshot 60ff14809dc31c700f9f987add96aae48f72cb97: 430 files copied, 219 excluded, 0 symlinks omitted, 0 submodules omitted
```

On any failure it exits `1` and prints the reason to stderr. For a detected secret, the reason includes the file, line and rule, with the value redacted.

## Profiles

A profile is a directory holding a `profile.yaml`:

```yaml
name: playground
repoPath: ./repo            # relative paths resolve against the profile directory
ref: main                   # branch, tag or commit to snapshot
language: pt-BR             # language of end-user answers
instructions:               # .md files with project knowledge for the agent
  - instructions/overview.md
excludePaths:               # never copied into the snapshot
  - .specs
  - config/**
  - "**/*.pem"
denyTerms: []               # internal names answers must never contain
versionCaveat: "Behaviour of the current version; customer-specific builds may differ."
```

`language`, `instructions`, `denyTerms` and `versionCaveat` are validated now but only used from blocks 3 and 4 on.

`excludePaths` syntax:

- Paths are relative to the repository root, use `/` as separator, and are case-sensitive.
- Only `*` (within one path segment) and `**` (across segments) are wildcards. Every other character matches literally.
- A pattern that matches a directory excludes everything under it.
- `*.pem` matches only at the root. Use `**/*.pem` to match at any depth.
- There is no negation. An entry starting with `!` is rejected.

Real profiles never enter git: `.gitignore` ignores everything under `profiles/` except `profiles/example/`. Keep them outside the repository and point `VETERAN_PROFILE_DIR` at them.

## Development

```sh
npm test            # node:test suites; needs git and gitleaks, and one test clones Playground
npm run typecheck   # tsc --noEmit
```

Planning artifacts live next to the code:

- `.tasks/` holds the planned task for each block.
- `.checks/` holds the checklist and the independent verification report.
