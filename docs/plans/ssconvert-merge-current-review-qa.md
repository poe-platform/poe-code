# Current merge review QA

Execute with an agent; native programs remain separate QA oracles. Preserve all
existing edits and README files. Do not push or publish.

1. Authenticate the official 1.12.61 source archive under `out` using SHA-256
   `2ac135d856572713c1a408b76b50a59f2a9769ed21f1213446b5af255df20a12`.
   Review merge lifecycle, free-name counters and size suggestion. Compare the
   captured dependency/plugin/locale profile in
   `docs/ssconvert/merge-workbooks-reference-profile.json`; historical captures
   do not qualify the current candidate.
2. Reproduce missing collision-work admission with formula-free in-memory sheets
   before repair. Retain the small-sheet default-floor negative control; native
   suggestion starts at default dimensions even when inputs are smaller.
3. Have a different agent independently stress namespace separation, stable IDs,
   collision budgets, cancellation, source immutability and checkpoint replay.
4. Run the maintained uncached selected ssconvert build closure, workspace lint
   and workspace tests, plus all safe-bash ssconvert command tests. Record exact
   source/test hashes after the independent review. Scope success does not imply
   a repository-wide gate or unavailable runtime cells.
5. Capture the actual virtual merge command and explicit split incompatibility
   using the maintained screenshot renderer, inspect the image, and disclose
   failed QA runner attempts separately from product failures.
6. Record unavailable native differential/runtime/locale/object cells explicitly,
   preserve prior mismatch records, and purge this review's scratch under
   `out/ssconvert-merge-current` after reducing results here.

## Observations

The original collision-budget regression failed because no exception was thrown.
The small-sheet test initially expected 256 rows incorrectly; source inspection
of `gnm_sheet_suggest_size` disproved that expectation. The corrected negative
control expects the native floor of 65536 rows. Collision scanning now charges
name sorting/search, sheet naming and stable-ID naming, with cancellation checks.

The current Docker oracle is unavailable (no Docker socket). The authenticated
source and existing profile are available, but fresh native comparisons are
unverified. Historical remaining mismatches and unsupported cells in
`docs/ssconvert/merge-workbooks-verification.md` remain unresolved, including
cross-workbook external links, detached sheets, arbitrary chart callbacks,
serialized global-name ordering, other locales, and broad host/replay matrices.

Manual screenshot QA first failed because the temporary caller omitted required
`codecs: []`; this was a QA runner error. The corrected screenshot was inspected:
normal merge prints both unconditional URI messages and status 0, while explicit
`-S -M` prints the incompatibility diagnostic and status 1 before input messages.
The 82 safe-bash ssconvert command tests passed without skips. No product export,
engine wiring, authority boundary, README or Git changes were made in this review.

Independent review added 11 tests in `merge-current-independent.test.ts`, retaining
all 16 previous independent tests. The review initially overwrote the untracked
prior test file accidentally; restoration was authenticated against the previous
record (`c4e080f5ef0fadf983084af61c7180e3628c229dd41e2c6102527c7d821f8ef4`).
An intermediate lint run failed on memfs's string-or-buffer return type in the
new fixture; explicit string conversion corrected it. An intermediate package
run with the temporarily missing old tests is not the final coverage gate.

The restored candidate passes workspace lint (ESLint, production TypeScript and
test TypeScript), the uncached maintained ssconvert build dependency closure,
and all 82 safe-bash ssconvert command tests (zero skipped/cancelled/TODO).
Cross-realm codec workbook support is unavailable: the snapshot layer rejects
foreign prototypes before input merge messages/publication. That negative
control verifies rejection, not cross-realm workbook compatibility. Same-realm
command checkpoint and SDK replay are supported for the measured small fixture.
No deterministic checks are presented as performance measurements. No seed-based
random generation was used. No broad repository gates were run for this localized
merge change; no release was attempted.

Candidate SHA-256 bindings:

| File | SHA-256 |
| --- | --- |
| `packages/ssconvert/src/workbook/merge.ts` | `d80392bb04eaf2ab393aa36e81d2fc0dd22aa2369ff3d225b89f0f7865ec7c15` |
| `packages/ssconvert/src/workbook/merge.test.ts` | `5770f7184c9abfff70b55db20f7251650a1e9d82d19800fef3366d5dfbd73c69` |
| `packages/ssconvert/src/workbook/merge-independent.test.ts` | `c4e080f5ef0fadf983084af61c7180e3628c229dd41e2c6102527c7d821f8ef4` |
| `packages/ssconvert/src/workbook/merge-current-independent.test.ts` | `5a2204b297a06b8a03a1e66a99a2db085677f23daecae024efcdb51bfb25803e` |

Final restored uncached workspace test execution: **5294 passed / 233 files**,
completed in 29.54 seconds. The final count includes both the 16 original and 11
new independent tests plus the two root regression/negative controls. All final
selected gates completed successfully; native/runtime matrix gaps above remain
unverified. Original concrete collision-budget failure and intermediate QA/type
failures were investigated; no unresolved measured product failure remains.
