# Pretest Harness Clarifications

Date: August 28, 2026. Written before synthetic execution. Product executions: zero.

The original preseal `21ad8c589d7f138064616e8f37e748e6a2e7c200` remains immutable. This clarification changes no YQ API, CARRY, limits, or semantic expectation.

- An explicitly receipted new `src/commands/yq/*.md` documentation path is permitted alongside new `.ts` source. It produces no compiler outputs. All nested new paths remain explicitly enumerated; new declaration-only `.d.ts` inputs are refused. The original protocol's `.ts`-only source-addition wording was unnecessarily restrictive for the separately owned module README.
- The no-emit TypeScript negative outcome is exit 1 or 2 with exactly its declared fixture diagnostic; neither arbitrary nonzero nor a missing-module error is accepted. The raw compiler exit remains a fact. The worker itself still exits nonzero on any mismatch.
- `copyAndMoveRegularTree` is a lower-level fake-tree-testable copy/rename primitive. It produces movement facts, not an import capability. Only `materializeCandidate` after full candidate authorization enrolls a binding accepted by `assertBound` and the runtime import scope.
- A build receipt is a separately trusted root artifact with `candidateCommit`, `sourceMapSha256`, and `packageMapSha256`; additional build evidence fields are allowed there. Source authorization does not read or require completed build evidence, allowing pre-build authentication without pretending a build already happened. Candidate authorization requires that evidence and complete outputs before imports.
- Guard scopes are append-detecting snapshots, not adversarial filesystem transactions. Every source-declaration/program template remains uncompiled. Syntax checks of these Node harness helpers are not product/type execution.
