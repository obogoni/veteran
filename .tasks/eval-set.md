# Eval set (real + adversarial) and rubric

> Build this with **tlc-implement**.
> Every criterion below becomes a check with a proof, referenced by its number. Nothing under
> `Unresolved` gets settled while building.

## Intent

Nobody can tell today whether an answer about a business rule is right. The design doc sets a gate before the pilot (≥ 80% accuracy on the real eval set, 0 secret leaks on the adversarial set), but there is nothing to measure against. The existing functional-explanation skill in the target codebase has 13 evals that check format only: no reference answers and no adversarial cases. The failure that started the project was an unbranched "yes" to a question whose real answer depends on the card type, and a format check cannot catch it. Without a reference set, blocks 3 and 4 would ship an agent whose quality is a guess, and spike 6 has no contradiction cases to run.

When this ships, the real profile, kept outside this repository, holds `evals/*.jsonl` with at least 40 real support questions and at least 20 adversarial ones. Each real question carries the answer confirmed as correct, and some also carry the expected branches and a contradiction follow-up. The profile also holds `evals/rubric.md`, which the rubric judge of block 3 applies. It also snapshots the target codebase, which block 1 left to the operator "alongside block 2". This repository gains only the documented format. No question, answer or name from the target codebase enters it.

13 criteria in 5 slices · 3 one-way doors · 5 open, of which 0 block

## Criteria

### The real profile snapshots the target codebase

1. Given the real profile directory with a `profile.yaml` whose `ref` is the target's main branch, when `veteran snapshot` runs with `VETERAN_PROFILE_DIR` pointing at it, then it exits `0` and prints the block 1 summary line with the resolved SHA.
2. Always, no file of the real profile is tracked by this repository or listed by `git status --porcelain --untracked-files=all` in it. The profile directory is either outside the working tree or under an ignored `profiles/<name>/`.

### Real cases carry the confirmed answer

3. Every non-empty line of every `<VETERAN_PROFILE_DIR>/evals/*.jsonl` parses as one JSON object with exactly the fields in Decided *Eval case format*: required fields present with the stated types and non-empty strings, optional fields either absent or well-formed, and no other field.
4. Every `id` is unique across all `evals/*.jsonl` files of the profile.
5. At least 40 cases have `adversarial: false`. Each one's `question` comes from support ↔ developer chat history, and its `referenceAnswer` is the answer confirmed as correct in that thread. When the thread corrected an earlier reply, the corrected answer is used, never the first one.
6. The card-return question from the design doc's *Problem* is present as a real case with `expectedBranches` of at least 2 entries and a `followUp` whose `message` contradicts an unbranched answer.
7. At least 10 real cases carry `followUp`. These are the contradiction cases spike 6 runs.

### Adversarial cases cover every attack the issue names

8. At least 20 cases have `adversarial: true`. Each carries at least one of the tags `code-request`, `table-request`, `secret-request`, `injection`, `excluded-area`, and each of these five tags appears on at least one case. Their `referenceAnswer` describes the expected behaviour (for example: refuses briefly and offers the functional explanation), not an answer to the request.
9. Always, `gitleaks dir <VETERAN_PROFILE_DIR>/evals --config config/gitleaks.toml --no-banner` reports no finding. A `secret-request` case asks for a secret without containing one.

### The rubric defines what the judge scores

10. `<VETERAN_PROFILE_DIR>/evals/rubric.md` defines exactly the items `correct`, `businessLevel`, `byBranch`, `admitsUncertainty` and `noLeak`, in that order. Each item has a pass condition, a fail condition and the cases it applies to (`byBranch` only to cases with `expectedBranches`; `noLeak` to every case).
11. `rubric.md` states which items make a real case count toward accuracy: `correct` and, where it applies, `byBranch`.

### The format is public; the content is not

12. `README.md` has an *Eval set* section with the location (`<VETERAN_PROFILE_DIR>/evals/*.jsonl` and `evals/rubric.md`), every field of the case format with its type and whether it is optional, the five adversarial tags, and one example line whose content is about the example profile's codebase.
13. `.design/veteran.md` *Open 1* is replaced by a pointer to this task's *Eval case format*, and *Needs a spike 1* says its 10 contradiction cases are the eval cases that carry `followUp`.

## Out of scope

- A command that validates or runs the eval files. `veteran eval` and its loader are block 3, which decides what a malformed line does at run time. Criteria 3, 4, 8 and 9 are proved here by the verifier.
- An eval set for `profiles/example/`. Block 3 adds one if its tests need a runnable fixture from a fresh clone.
- Accuracy, leak rate, cost and latency numbers. Blocks 3 and 4 measure them against this set.
- A per-case list of strings that must not appear in the answer. Not in the source. Leaks are judged by `noLeak` here and by the deterministic validator in block 4.
- Answers per customer version. This is Boundary Out in the design doc. Reference answers describe the main branch.

## Observable

| Surface | Decision | Landing |
| --- | --- | --- |
| collection `evals/*.jsonl` | grouping criterion | n/a - the runner reads every `*.jsonl`; the `adversarial` flag and `tags` carry the meaning, the file split carries none |
| collection `evals/*.jsonl` | naming | 4; the id format is free |
| collection `evals/*.jsonl` | ordering | n/a - no result depends on line order |
| collection `evals/*.jsonl` | duplicates | 4 (ids); near-duplicate questions Unresolved 5 |
| collection `evals/*.jsonl` | the exception that does not fit | 5 (a thread with no confirmed answer yields no case; a correction yields the corrected answer); a real request for code or a table is `adversarial: true` (8) |
| document `evals/rubric.md` | structure, depth | 10, 11 |
| document `evals/rubric.md` | what the reader does next | n/a here - the reader is block 3's rubric judge, which decides its output |
| document `README.md` *Eval set* | structure, what the reader does next | 12 - a profile author writes cases from it |
| command `veteran snapshot` | output, exit codes | existing - block 1, exercised by 1 |

## Swept

- validation: 3, 4, 8
- failure modes: n/a - nothing runs these files in this block; block 3 owns the loader's failure behaviour
- idempotency and retry: n/a - static files
- authorization: n/a - local files with the operator's permissions
- concurrency and ordering: n/a - no process reads or writes the set concurrently in this block
- data lifecycle: 2 (never enters this repository), 9 (no secret in the set); personal and customer names Unresolved 4
- external-dependency failure: 1 - existing block 1 behaviour for `git` and `gitleaks`
- state transitions: n/a - a case has no lifecycle
- observability: n/a - the set is data; blocks 3 and 4 report metrics over it

## Impact

| Front | What changes |
|---|---|
| domain | new term: `EvalCase` - one line of `<VETERAN_PROFILE_DIR>/evals/*.jsonl` in the Decided format; read by block 3's `veteran eval` and spike 6 |
| domain | new term: `Rubric` - `<VETERAN_PROFILE_DIR>/evals/rubric.md`, the five pass/fail items block 3's rubric judge applies |
| docs | `.design/veteran.md` *Open 1* and *Needs a spike 1* amended (13): the spike needed contradiction cases that the proposed format could not express |
| stored data | nothing to migrate |
| tooling | nothing new; the real profile needs `git` and `gitleaks` as in block 1 |

## Decided

| Decision | Shape | Alternative rejected |
|---|---|---|
| Eval case format | JSONL, one object per line: `{ id: string, question: string, referenceAnswer: string, expectedBranches?: { condition: string, behavior: string }[], followUp?: { message: string, referenceAnswer: string }, tags: string[], adversarial: boolean }` | The design doc's proposal without `followUp` - it cannot express the contradiction cases spike 6 runs. `expectedBranches` as `string[]` of conditions only - the real failure was a wrong behaviour per branch, and the judge cannot score behaviour it was never given |
| Location | `<VETERAN_PROFILE_DIR>/evals/*.jsonl` and `<VETERAN_PROFILE_DIR>/evals/rubric.md`, inside the profile, never in this repository | Rubric in this repository - the source places it in the profile, and this keeps a profile self-contained |
| Rubric items | exactly `correct`, `businessLevel`, `byBranch`, `admitsUncertainty`, `noLeak`, each pass/fail. Block 3's judge output binds to these keys | A numeric score per item - no single run can say what a 3 means, so the 80% gate would have nothing to count |

## Sources

- Issue #2, `Block 2: Eval set (real + adversarial) and rubric`: the counts, the three adversarial families, the five rubric items, and "lives in the profile directory, outside this repo".
- `.design/veteran.md`, *Roadmap* row 2, *Success* ("≥ 80% accuracy on the real eval set and 0 secret leaks on the adversarial set"), *Open 1* (the proposed format, "decided while building block 2"), *Needs a spike 1* ("running 10 contradiction cases from the eval set"), *Problem* (the card-return case), and the *Adds* line for `runEvals.ts` (`<VETERAN_PROFILE_DIR>/evals/*.jsonl`).
- `.tasks/profile-snapshot.md` *Out of scope*: "authoring [the real profile] is the operator's work alongside block 2".

This task is the record of decision. If a linked document diverges, ask before building.

## Unresolved

| # | Kind | Question | Until answered |
|---|---|---|---|
| 1 | open | Should block 2 already mine the contradiction cases (`followUp`), or should spike 6 add them later? | Written as now (6, 7, Decided *Eval case format*), because the operator reads the same chat threads anyway and adding the field later means mining them twice |
| 2 | open | What does "accuracy" count for the 80% gate? | Written in 11 as `correct` plus `byBranch` where it applies. `businessLevel` and `admitsUncertainty` are reported but do not gate. `noLeak` feeds the leak rate |
| 3 | open | Is the reference the answer confirmed as correct rather than "the answer a developer gave"? | Written as confirmed (5). In the motivating case the developer's first answer was the wrong one |
| 4 | open | Do questions keep customer and person names from the chat history? | Replaced by a role ("o cliente", "a analista") when copied into a case. The questions are sent to the API in block 3, and per-customer answers are out of scope |
| 5 | open | Are near-duplicate questions allowed, and is at least one case per adversarial tag enough? | Near-duplicates allowed, since variations in wording are a real test. One per tag is the minimum (8) |
