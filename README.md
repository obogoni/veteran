# Veteran

Veteran is meant to be the "veteran senior developer" that non-technical people can ask about business rules that are only documented in the code. It answers in business terms and never hands out code, internal names or secrets. Everything specific to one codebase lives in a **profile** kept outside this repository.

The full design is in [`.design/veteran.md`](.design/veteran.md), and the roadmap is tracked as one GitHub issue per block.

## Status

Blocks 1 and 3 of 8 are done: **profile + filtered snapshot** and the **headless PoC** (`veteran ask` / `veteran eval`). Block 2 (the real eval set) is paused behind block 3. Output validation (block 4) is not there yet, so an answer is not yet checked for leaks before it is printed.

What works today:

- **Profiles.** `profile.yaml` is loaded from `VETERAN_PROFILE_DIR` and validated. Every invalid field is reported in a single run.
- **`veteran snapshot`.** It copies the committed tree at the profile's `ref` into `<VETERAN_PROFILE_DIR>/snapshot/`.
  - `excludePaths`, `.git`, symlinks and submodules are physically left out.
  - The copy is scanned with gitleaks, and any finding or scan failure aborts it.
  - The previous snapshot is replaced only when the new one is clean.
  - The source repository is never modified.
- **`veteran ask "<question>"`.** A read-only agent answers over the snapshot, in the profile's language and in business terms. The answer is split by case, with suggested tests, what it depends on, caveats and the profile's version caveat.
  - The agent only has `Read`, `Grep` and `Glob`, and a hook denies any read outside `snapshot/`.
  - No `CLAUDE.md`, settings, skills or plugins are loaded from the snapshot or from your home.
  - Each run writes a JSONL transcript to `<VETERAN_PROFILE_DIR>/transcripts/`.
- **`veteran eval`.** It runs the profile's eval cases through `ask`, grades each answer with a rubric judge, and reports accuracy, cost and p50/p95 latency.
- **Example profile** over [obogoni/playground](https://github.com/obogoni/playground), in [`profiles/example/`](profiles/example/), with 6 eval cases and a rubric.

## Requirements

- Node.js 24 or later. TypeScript runs directly, with no build step.
- `git` on `PATH`.
- [gitleaks](https://github.com/gitleaks/gitleaks) 8.19 or later on `PATH` (tested with 8.30.1). On Windows: `winget install Gitleaks.Gitleaks`.
- For `ask` and `eval`: [Claude Code](https://code.claude.com) logged in on the machine (`claude`, then `/login`) with the Enterprise account. Veteran never reads an API key. It strips `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN` and `ANTHROPIC_BASE_URL` from the agent's environment, so the run always uses the Claude Code login.

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

Then ask a question and run the eval set:

```sh
VETERAN_PROFILE_DIR=profiles/example node src/cli.ts ask "Posso abrir um agente direto pelo cartão de uma tarefa?"
VETERAN_PROFILE_DIR=profiles/example node src/cli.ts eval
```

`veteran ask` prints the answer on stdout. On stderr its last line gives the transcript path, the estimated cost and the duration. It exits `1` when the agent hits a limit (40 turns, an estimated USD 1.00, or 5 minutes) or when the answer does not match the schema.

`veteran eval` prints one line per case and a summary line. The summary gives accuracy, total cost and p50/p95 latency.

Cost: each `ask` stops at an **estimated USD 1.00** (the SDK's client-side estimate) and counts against the account's plan usage. An eval run costs one `ask` plus one judge call per case.

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

`language` sets the answer language (only `pt-BR` for now). `instructions` are appended to Veteran's system prompt. `versionCaveat` closes every answer. `denyTerms` is validated now and is used from block 4 on.

## Eval set

`veteran eval` reads `<VETERAN_PROFILE_DIR>/evals/*.jsonl`, one case per line, and `<VETERAN_PROFILE_DIR>/evals/rubric.md`:

```json
{"id": "pg-agents-1", "question": "Posso abrir um agente direto pelo cartão de uma tarefa?", "referenceAnswer": "Só quando a tarefa já tem pelo menos um worktree...", "expectedBranches": [{"condition": "A tarefa não tem nenhum worktree", "behavior": "O botão fica desativado"}], "tags": ["agents"], "adversarial": false}
```

- `id`, `question` and `referenceAnswer` are non-empty strings, and `id` is unique across the files.
- `tags` is a list of strings and `adversarial` is a boolean.
- `expectedBranches` (optional) is a list of `{ condition, behavior }`.
- `followUp` (optional) is `{ message, referenceAnswer }`, for the multi-turn spike.
- No other field is accepted. Every problem is reported in one run as `file:line`, before any agent starts.

The judge scores each answer on `correct`, `businessLevel`, `byBranch`, `admitsUncertainty` and `noLeak`. A case is accurate when `correct` passes and, for a case with expected branches, `byBranch` passes too. Adversarial cases are skipped until block 4.

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
VETERAN_LIVE=1 node --test test/live.test.ts   # runs the real agent on the Claude Code login; costs plan usage
npm run typecheck   # tsc --noEmit
```

Planning artifacts live next to the code:

- `.tasks/` holds the planned task for each block.
- `.checks/` holds the checklist and the independent verification report.
