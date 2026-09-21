# Independent BIFF writer review QA

## Reference and ownership

Review the released Gnumeric 1.12.61 primary source in `out/ssconvert-lifecycle/gnumeric-1.12.61`. Authenticate its archive with `shasum -a 256 out/ssconvert-lifecycle/gnumeric-1.12.61.tar.xz`; required digest is `2ac135d856572713c1a408b76b50a59f2a9769ed21f1213446b5af255df20a12`. Native executables are separate QA oracles only. Root owns command integration, exports, Git and delivery. This independent review owns the original in-memory regression file and internal style repairs only.

## Deterministic regression procedure

1. Read `rotation_to_excel_v7`, `rotation_to_excel_v8`, `map_underline_to_xl` and `excel_write_FONT` in `plugins/excel/ms-excel-write.c`, and underline enum values in `src/style.h`.
2. Before repairing code, run the original in-memory `biff-write-current-review.test.ts` cases. Include boundary pairs 45/46, 135/136, 225/226 and 315/316; stacked text -1; BIFF8 rotation 270, 315 and wrap 360. Assert raw XF fields against independently supplied expected numbers, with unchanged frozen input and no warnings.
3. Before repairing font records, add both revisions' original fixtures for underline enums 0 through 4 and bold fonts. Assert raw FONT underline bytes, weight and flags.
4. Re-run the three BIFF writer test files. Run maintained package `npm run test --workspace=@poe-code/ssconvert` and `npm run lint --workspace=@poe-code/ssconvert` after final edits. These commands execute fresh Vitest/ESLint/TypeScript work directly; this regression suite performs no disk fixture I/O, native invocation or LLM query.

## Manual independent interoperability procedure

1. Through the actual SDK byte-I/O engine, create original fixtures with cells containing nontrivial rotation, stacked text, bold accounting underlines and unrelated numerical/string controls. Save BIFF7, BIFF8 and DSF outputs only under `out`.
2. Independently enumerate CFB directory/FAT and assert separate DSF `Book` and `Workbook` streams. Extract XF and FONT fields from each stream; expect revision-specific rotation and common underline mapping.
3. Reopen each candidate with the separately profiled native 1.12.61 oracle and an independent reader. Verify style values and unrelated control values, diagnostic bytes and exit statuses. For DSF, inspect each extracted stream as a separate workbook rather than accepting only the preferred stream.
4. Root runs the exact final-candidate maintained build/test/lint gates plus actual CLI/SDK, safe-bash original/checkpoint/replay, realm/host, cancellation, budget and negative-authority checks. Inspect CLI screenshots if visible diagnostics change. Record failed, skipped, unavailable and unsupported cells separately.
5. Purge temporary run logs/evidence in `out` after preserving necessary reproducible minimized cases. Do not alter README files, push or publish.

## Verified review observations

- Archive authentication passed with the required SHA-256.
- The initial rotation-only regression produced 9 failures and 7 passes; after repair all 16 passed.
- The added accounting-underline cases failed in both revisions before repair (`3/4` instead of `33/34`); final focused writer suite passed 85 tests across three files.
- Maintained workspace test before the final font additions passed 164 files and 4333 tests. This is a prior-revision observation, not final-candidate gate evidence.
- After final style edits, maintained `npm run test --workspace=@poe-code/ssconvert` passed 165 files and 4340 tests, including root's concurrently added five cases. Maintained workspace lint passed after final style edits. No runtime edits followed these checks in this review.
- Follow-up read-only review of root's reader/page-break repairs added six independent reader cases after the preceding gates: inject raw XF bytes 90/91/180/255 and FONT bytes 1/2/33/34 into in-memory streams, asserting native mappings and unchanged numerical controls. All 24 independent review tests passed. Root must repeat final gates after these additions; the preceding workspace count is not evidence for this later test revision.
- Follow-up maintained lint failed once because the new test tuple array inferred possibly undefined `encoded` under strict indexed access. The test declaration was corrected with `as const`; this was a test typing defect, not a runtime mismatch.
- Final read-only review of root's warning and page-break-axis repairs added six cases: row-only overflow for BIFF7/BIFF8/DSF, retained final valid row in each stream, and valid earlier sheets followed by overflowing later sheets. All 30 independent review tests passed. Root's final maintained gates must include these latest bytes. Native horizontal opcode is `0x1b`; vertical is `0x1a`.

## Unverified coverage and remaining review limits

This agent has not executed native reopening, independent-reader interoperability, DSF extracted-stream reopening, original/checkpoint/replay, host/realm boundary cases or CLI screenshots. Root coordinates those required cells. The review does not establish complete formula operand-class/token translation, external-workbook links, arbitrary object/chart fidelity, print-record parity or exact global diagnostic ordering. Source comparisons and raw record tests are deterministic semantic checks; no performance bound has been measured.

The source writes an empty PAGE_BREAK record if called with a non-null empty page-break object, while the candidate skips empty records. Whether the native XML reader constructs that object for an empty declared page-break element remains unmeasured; this is a review question, not a validated differential failure.
