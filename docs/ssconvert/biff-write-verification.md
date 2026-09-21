# BIFF writer verification — 2026-09-20

The three requested saver IDs are registered with distinct outputs: `excel_biff7` writes BIFF7 `Book`, `excel_biff8` writes BIFF8 `Workbook`, and `excel_dsf` writes both streams with a DSF workbook flag. Stable `.xls` default selection remains BIFF8. Full requested Gnumeric parity is **incomplete**. Non-comment objects/charts, rich text and external-workbook links remain unsupported; the complete mismatch catalog is in [the receipt](biff-write-verification.json).

Implementation stays in `packages/ssconvert/src/codecs/biff*.ts`; safe-bash uses the existing command/SDK engine with injected byte I/O. No native fallback or product dependency was added. Existing unrelated work was preserved. No README edits, commits, pushes or releases were performed.

## Regressions and independent review

Before registration/implementation, four command/SDK/default-selection cases failed for unavailable exporters. Subsequent failing regressions covered formula/name tokens, resource limits, caches, continuations, comments/styles/print, dual-stream limits and publication effects. The final independent agent cohort contains 35 passing stress cases; root owns 32 writer cases. Unit fixtures are original in-memory objects and memfs; new unit tests neither spawn native tools nor create disk files.

The independent worker validated and root repaired aggregate sheet/cell admission, named-formula warnings, out-of-version comment anchors, and silent workbook/raw chart loss. Further failing cases prevented false default-record loss warnings and separated SCL (`0xa0`) zoom from PANE (`0x41`). Retained raw records are recognized only when their exact opcode/payload is emitted in the appropriate workbook/sheet scope; genuine chart loss still warns. Frozen-input and exact cancellation-reason checks cover the final BIFF7 truncation repair. See [independent evidence](../plans/xls-biff-write-independent-stress.md).

## Native and independent-reader measurement

The official 1.12.61 archive was authenticated against SHA-256 `2ac135d856572713c1a408b76b50a59f2a9769ed21f1213446b5af255df20a12`; primary source remains only in out. The receipt captures the separate colima/Linux native binary, installed plugins/exporters, dependencies, locale and schema/library environment. Native QA used `LC_ALL=C`, `TZ=UTC`. Python QA used xlrd 2.0.2 and olefile 0.47 in an isolated task directory.

Measured coverage:

- Every sector of a roughly 7.6 MB dual-stream FAT/DIFAT container is independently checked by the stress tests. Native/olefile QA found no CFB defects in the small generated examples.
- BIFF7, BIFF8 and DSF whole files, plus both extracted DSF streams, reopen natively with exit 0 and empty diagnostics. Stream revisions are independently checked; these are not magic-byte-only tests.
- The original two-sheet advanced input preserves formulas including an addin, newer-function macro, cross-sheet reference, array literal and array group; merges, scoped names, explicit font, comments, row/column geometry and BIFF8 hyperlinks match the measured native export after native replay. BIFF7 hyperlinks are absent from both outputs, so the empty comparison is not a BIFF7 hyperlink implementation pass.
- Direct factory export of that XML lacks calculated caches/follower cells: independent-reader comparison records seven differing positions per stream. Native replay recalculates formulas, so matching replay XML does not prove matching original caches.
- A separate original fixture replaces the unknown addin with supported `SUM`. Actual shared-engine conversion succeeds for all three IDs with no diagnostics. Independently compared cell types/caches match native for all 17 positions per stream, including both DSF streams; native reopening of each stream exits 0 without diagnostics.
- Explicitly supplied number/string/boolean/error caches, 1900/1904 dates, default margins and native Normal Sans column-width bytes have regression coverage. Basic independent-reader captures verify supplied caches/date mode/names/comments in all four streams.
- Native column-loss warning text is captured. Exact row-loss native differential remains unmeasured; unit/source evidence alone is not a native comparison.
- Native BIFF7 truncates a 65,536-byte LABEL, prints `Truncating string of 65536 bytes`, and exits 0. Candidate behavior now matches; native candidate reopening preserves 65,535 bytes without diagnostics. xlrd reads only 2,072 bytes from both files, which remains a measured reader limitation rather than a complete text interoperability pass.
- Exporter listing and truncation diagnostic screenshots were generated in out and visually inspected. No screenshot tests were added.

Unknown `FOO` still fails in the existing evaluator before the shared engine reaches the writer. Direct compiler/factory addin translation is verified, but that does not establish command conversion of the original unknown-function input. Exact native bytes/defaults/properties, alternate BIFF7 codepages, broader drawings/charts/protection/validation, large token/name/array records and warning envelopes remain incomplete or unmeasured. Shared formulas are emitted individually as native does; comprehensive shared/array/data-table variants remain unmeasured. Existing importer limitations for NAME_X and array-literal translation also remain.

## Maintained checks

- `npm test --workspace=@poe-code/ssconvert`: 163 files, 4,317 tests passed, fresh execution.
- `npm run lint --workspace=@poe-code/ssconvert`: ESLint, strict runtime TypeScript and strict test TypeScript passed.
- `npm run build:workspaces -- --workspace=@poe-platform/safe-bash --no-cache`: maintained dependency closure, 18 builds passed, including native npm stages.
- Maintained `test-reporting.mjs` with the four ssconvert command test files: 52 tests passed after the final build; this includes shared command/SDK bytes, memfs effects and replay.
- Scoped ESLint for the safe-bash integration test passed. The independent agent separately passed scoped ESLint and strict test TypeScript.

The broad safe-bash invocation appended all discovered tests despite the supplied four paths. It exited 0: 44,933 tests, 44,100 passed, 831 skipped and two TODO failures. The TODO cases are existing csvformat numeric/null serialization and unavailable XLSX `/dev/fd/3` workflows; skipped/TODO cases are not compatibility passes. The complete gate summary is recorded separately in the receipt. Planning/QA procedures remain in [docs/plans](../plans/xls-biff-write-qa.md). Task-owned temporary evidence is purged only after results/hashes/profile are recorded; prior source/archive and other workers' out data remain untouched.
