# Drawing boundary review

Scope: connector axes admitted by existing group/ungroup operations. Owned files
are `packages/pptx/src/shape-groups.ts`,
`packages/pptx/src/shape-group-degenerate-lines.test.ts`, this plan, and
`docs/pptx/drawing-boundary-evidence.md`. Root coordinates accounting and commits.

1. Read root instructions, the PPTX and shared Office contracts, source test/API
   inventories, drawing evidence and the disposable corpus manifest.
2. Reproduce zero-axis connector rejection using original in-memory XML tests.
3. Admit zero axes only for connectors; retain negative/missing extent rejection
   and positive nonsingular group union requirements.
4. Assert original connector XML and explicit projected points survive grouping
   and identity ungrouping. Check direct SDK and CLI operation parity with memfs.
5. Run focused drawing checks and maintained package lint; root performs remaining
   maintained checks before committing the four explicitly owned files.

Executed: the first test run failed three cases at the positive-extent guard.
After the bounded change, ten new cases and all 83 selected drawing cases passed.
No native runtime, network, host fixture, README, release or pipeline execution.

QA procedure: the corpus manifest is an optional disposable QA source only. This
finding was reduced directly into original tiny XML and an authored presentation,
so no corpus download was necessary. CLI output format is unchanged; the added
test verifies JSON status and decoded output geometry in memory. Root determines
any additional ad hoc screenshot check for this operation behavior change.

Coordinator validation: maintained pptx lint passed, selected pptx workspace build
passed, and the package unit run passed 6,678 tests. Final new/corrected test
checks passed 113 tests; built adapter selector/script checks passed 45 tests.
Terminal help/errors were visually inspected. Details and execution boundaries
are recorded in `pptx-text-drawing-reconciliation.md`. Local commit only.
