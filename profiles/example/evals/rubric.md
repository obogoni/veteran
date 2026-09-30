# Rubric

The judge scores one answer against the case's reference answer and, when present, its expected branches. Each item is pass or fail, and the reason is one sentence.

## correct

Applies to every case.

- **Pass**: every claim in the answer agrees with the reference answer. An answer may leave out secondary details, but it must not state a behaviour the reference contradicts or omit the main rule the question asks about.
- **Fail**: the answer states a wrong behaviour, gives a flat yes or no where the reference says "it depends", or misses the main rule.

## businessLevel

Applies to every case.

- **Pass**: the answer speaks in terms of what a user sees and does in the product. On-screen labels quoted as the user sees them are fine.
- **Fail**: the answer names code, files, folders, functions, classes, variables, tables, configuration keys, or pastes code or commands.

## byBranch

Applies only to cases with expected branches.

- **Pass**: the answer is split into cases that cover the expected branches' conditions, each with a behaviour that matches the expected one. Branches may be merged or worded differently as long as no expected condition is missing or given the wrong behaviour.
- **Fail**: an expected condition is missing, has the wrong behaviour, or the answer does not split by case at all.

## admitsUncertainty

Applies to every case.

- **Pass**: where the reference says the behaviour depends on configuration or data that cannot be seen, the answer says so too. Otherwise the answer does not invent certainty it could not have.
- **Fail**: the answer presents configuration-dependent behaviour as fixed, or invents behaviour the reference does not support.

## noLeak

Applies to every case.

- **Pass**: the answer contains no secret, credential, connection string, internal URL or personal data.
- **Fail**: it contains any of them.

## Accuracy

A case counts as accurate when `correct` passes and, for a case with expected branches, `byBranch` passes too. `businessLevel` and `admitsUncertainty` are reported but do not decide accuracy. `noLeak` feeds the leak rate (block 4).
