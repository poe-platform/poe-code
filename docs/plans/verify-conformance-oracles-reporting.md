# Conformance reporting mutation evidence

Date: 2026-09-12. Base source SHA: `51f580428c75d2405c67b5fd719f88c54fab5d4f`, branch `main`; repairs below are working-tree changes atop that revision. Runtime: Node `v22.23.2`, ICU `78.2`, V8 `12.4.254.21-node.56`, `darwin/arm64`. Test262 remains pinned to `419d3e0a2273ba01a3bfcbec423f2801425b8e93`. This audit changes the runner's reporting contract, not the ECMAScript edition or host authority. The edition and specification qualification remain in `docs/plans/safejs-gap-closure-evidence.md`.

## Contract and ownership

Owner: `packages/safe-js/test/conformance/{report,command,corpus}.ts`. A completed selected report must correspond to its emitted header and entries, have counts recomputed from those entries, and account for each enumerated variant once. Corpus aggregation must use the complete original manifest; fixtures, unsupported outcomes, metadata errors and unexecuted variants must not become passes. These are harness/reporting requirements, not ECMAScript runtime defects.

## Reproduced defects and dispositions

All fixtures below are in-memory objects or `memfs` files; the unit controls write no filesystem fixtures.

| Counterexample | Actual before repair | Required behavior and repair |
| --- | --- | --- |
| Manifest repeats `sloppy` twice and report repeats the same passed mode | Accepted duplicate variants | Reject duplicate manifest modes before matching results |
| Manifest includes a zero-variant test beside a genuinely passing test | Accepted an all-green aggregate | Reject test files with no enumerated variants |
| Failed or unsupported row omits its reason | Accepted without case disposition | Validate shared closed execution-result schema |
| Fixture entry carries a passed result array | Silently discards the attached result | Reject results on non-test entries |
| A two-mode file fails before execution with `Missing harness` | File error retained, but no explicit aggregate list of the two unexecuted variants | Emit each manifest mode once in `unexecutedVariants`, with filename and reason; success stays false |
| Runner omits a result callback, repeats a result callback, or omits its header callback | Command returns 0 and writes a successful summary | Capture emitted receipts and compare header/entries with completed execution before summary; compare structured values without depending on property order |
| Stream contains a failed result while returned counts claim a pass | Command returns 0 and writes inconsistent summary | Recompute counts from result rows before summary |
| Returned report has `complete: false` | Command returns 0 | Require exact completed state before summary |
| Selected header lists a file or mode omitted consistently from both streamed and returned entries, with truthful smaller counts; or both contain a duplicate mode | Command returns 0 because stream and return agree | Snapshot the complete original manifest and selection before execution; require the returned full manifest to remain identical and reuse `aggregateReports` against the selected snapshot before summary |

Neighboring controls retain genuine passed receipts, valid unsupported reasons, and complete disjoint selections. Existing aggregate protections were also challenged with eight JSONL mutations: missing summary, truncated JSON, missing result, duplicate result, duplicate variant, unknown status, trailing abort and empty selected coverage. All are rejected with an aborted output and no aggregate success summary; these behaviors did not require repairs.

An additional corpus control enumerates two executable sources, a `_FIXTURE.js` source and a JSON fixture asset. Both bounded reports retain the identical complete original manifest and asset hash. The first selection alone is rejected as incomplete corpus coverage; combining the disjoint selections accounts for all four executable variants and passes. File execution errors remain nonpassing even beside passed variants: the command requires zero execution errors, and aggregation additionally requires the executed count to equal original enumeration before success.

## Reproducible red/green receipts

Times below are local `America/Chicago` on the date above.

- `npx vitest run packages/safe-js/test/conformance/report.test.ts`: 12:02:00, red **6 failed / 9 passed**. The six first-table report/accounting counterexamples above exposed missing rejection or missing explicit unexecuted accounting.
- `npx vitest run packages/safe-js/test/conformance/command.test.ts`: 12:02:35, red **3 failed / 29 passed**. All three stream mutations resolved with exit code 0 instead of rejecting. After repair: 12:02:44, **32 passed**.
- `npx vitest run packages/safe-js/test/conformance/report.test.ts packages/safe-js/test/conformance/command.test.ts packages/safe-js/test/conformance/corpus.test.ts`: 12:03:33, **58 passed**, 490 ms test execution.
- `npx vitest run packages/safe-js/test/conformance/command.test.ts`: 12:04:59, red **2 failed / 32 passed** for forged counts and incomplete returned state; both resolved with exit code 0. After repair: 12:05:16, **34 passed**.
- `npx vitest run packages/safe-js/test/conformance`: 12:05:29, **10 files / 195 tests passed**, 10.23 s total, 3.04 s test execution. This includes the execution agent's shared schema and worker-oracle controls.
- `npx vitest run packages/safe-js/test/conformance/command.test.ts`: 12:08:12, red **3 failed / 34 passed** for consistently missing selected file, missing mode and duplicated mode; all resolved with exit code 0. After using the original manifest snapshot and shared aggregate validation: 12:08:50, **41 passed**, including four further controls for unknown filenames, stale source hashes, fixture reclassification and a returned manifest with dropped files.
- `npx vitest run packages/safe-js/test/conformance`: 12:09:07, final **10 files / 202 tests passed**, 9.82 s total, 3.56 s test execution.
- `npx eslint packages/safe-js/test/conformance/report.ts packages/safe-js/test/conformance/report.test.ts packages/safe-js/test/conformance/command.ts packages/safe-js/test/conformance/command.test.ts packages/safe-js/test/conformance/corpus.test.ts`: exit **0** after the final repair.
- `git diff --check -- packages/safe-js/test/conformance/report.ts packages/safe-js/test/conformance/report.test.ts packages/safe-js/test/conformance/command.ts packages/safe-js/test/conformance/command.test.ts packages/safe-js/test/conformance/corpus.test.ts`: exit **0**.

There are no skips in these 202 unit controls. No budgets, runtime support or timeouts were weakened. Changes affect machine JSONL and internal accounting only; no human-facing CLI rendering changed. The final producer validation reuses the existing aggregate checker for counts, filenames, classifications, source hashes and variant modes. Duplicate selected names are rejected by set cardinality; unknown selected files cannot pass manifest membership; empty execution cannot return success.

## Trust boundary and delivery

The worker implementation, pinned source provenance and original corpus remain trusted. A syntactically valid fabricated `passed` receipt cannot independently prove that a fixture executed; these controls prevent accidental omission, duplication, malformed classifications and inconsistent producer summaries. Native feature availability is not inferred by the reporting layer and cannot convert a missing native control into a SafeJS result.

No runtime repair was made in this subtask. No commit, push or release was performed here; local validation is not a remote-main or publication receipt. Broader native controls, current-corpus spot checks and final disposition belong in the main evidence ledger.

Unrelated staged Safe Bash files remain staged: `packages/safe-bash/src/commands/text.ts`, `packages/safe-bash/tests/commands/helpers.ts`, and `packages/safe-bash/tests/commands/text.test.ts` (33 additions, 3 deletions in total). This subtask did not stage, unstage, restore or edit them. Other initial local changes were left untouched.
