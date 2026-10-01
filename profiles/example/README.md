# Example profile

A working profile over [obogoni/playground](https://github.com/obogoni/playground), a small public codebase, pinned to one commit. Real profiles follow the same shape but live outside this repository.

All commands run from the repository root.

1. Clone the codebase next to this file (the `repo/` folder is ignored by git):

   ```sh
   git clone https://github.com/obogoni/playground profiles/example/repo
   ```

2. Make sure `git` and [gitleaks](https://github.com/gitleaks/gitleaks) (v8.19 or later, the release that added `gitleaks dir`; tested with 8.30.1) are on `PATH`.

3. Build the snapshot:

   ```sh
   npm install
   VETERAN_PROFILE_DIR=profiles/example node src/cli.ts snapshot
   ```

   On success it prints one line with the commit and the counts. `profiles/example/snapshot/` then holds the tree at `ref` without `.specs/` and `.vscode/`, which `excludePaths` removes.

4. Ask a question and run the eval set. Both need Claude Code logged in on this machine (`claude`, then `/login`) and never read an API key:

   ```sh
   VETERAN_PROFILE_DIR=profiles/example node src/cli.ts ask "Consigo sempre excluir um worktree pelo aplicativo?"
   VETERAN_PROFILE_DIR=profiles/example node src/cli.ts eval
   ```

   `veteran ask` prints the answer and writes a transcript to `profiles/example/transcripts/`. `veteran eval` runs the cases in [`evals/real.jsonl`](evals/real.jsonl) and [`evals/adversarial.jsonl`](evals/adversarial.jsonl), grades them against [`evals/rubric.md`](evals/rubric.md), and prints accuracy, the leak rate, cost and latency.
