# Independent BIFF writer stress procedure and verified coverage

Independent worker owns `biff-write-stress.test.ts`, repairs in formula/style internals, and this QA document. Root owns exporter registration, CLI/SDK wiring, virtual-command integration, builds and Git. No README changes, commits, pushes or publication performed by this worker.

## Procedure

1. Inspect current writer and authenticated Gnumeric 1.12.61 Excel source under `out/ssconvert-lifecycle/gnumeric-1.12.61`. The parent authenticated archive SHA-256 `2ac135d856572713c1a408b76b50a59f2a9769ed21f1213446b5af255df20a12`; this worker did not independently download another archive. Source evidence: `ms-formula-write.c` name token layouts and function preparation/emission; `ms-excel-read.c` twelve `excel97_func_desc` macro names; `ms-excel-write.c` palette saturation; `src/expr-name.c` local-name-before-workbook lookup.
2. Write original small in-memory failing cases before repairing each behavior. Unit tests use no filesystem or native utility; root's command writer tests separately exercise memfs and the actual engine. Keep primary source and generated temporary artifacts under `out`; this worker generated no persistent QA output.
3. Check BIFF7 and BIFF8 local-name priority and sheet id/name aliases, qualified NAME_X layouts, addin NAME_X/FuncVar layout, macro NAME/FuncVar layout, whole-axis row/column bounds, palette overflow warnings, output admission and cancellation reason identity.
4. Generate two original in-memory CFB streams totalling about 7.6 MB to cross the 109-header-FAT-entry threshold. Independently enumerate header/DIFAT FAT sector ids, marker values, directory/data chains and complete sector allocation; verify byte preservation and zero padding through the product reader too. This is allocation integrity evidence, not a claim that generic arbitrary CFB containers are supported.
5. Run focused Vitest and strict TypeScript/lint checks, then root runs maintained uncached workspace gates and separate native/independent-reader QA. For native differential QA, use only the isolated oracle profile/root-owned capture; do not spawn native utilities inside unit tests or introduce a runtime fallback.

## Verified repairs and checks

- Before repair, BIFF7/BIFF8 same-spelled sheet-local names incorrectly referenced the first global name (index 1 rather than 2). Lookup now resolves sheet ids/names before falling back to workbook names, matching native lookup.
- A second failing case proved qualified names used NAME rather than native NAME_X. The repaired layouts use BIFF8 external-sheet indices and BIFF7 native reserved fields/unique id. Qualified sheet lookup retains native workbook-name fallback.
- Before repair, unknown `FOO` and supported special `IFERROR` failed export. Addin names and the authenticated twelve newer-function macro names are exposed to root's globals writer. A finalization pass resolves earlier internal-sheet references after late addin discovery and assigns macro NAME indices after workbook names; finalization is idempotent.
- Whole-column/whole-row formulas originally failed. BIFF7 and BIFF8 now encode finite areas using their own version bounds; BIFF7 relative-axis bits are checked explicitly.
- Before repair, a 57-color palette failed saving. Style serialization now records warning diagnostics and maps excess custom colors to black, preserving native reserved default black/white slots. Root awaits these diagnostics.
- Independent stress suite: 10 tests passed in 34 ms in a focused run; DIFAT integrity case completes in tens of milliseconds. A first test implementation exceeded the default timeout due to generic deep comparison of multi-megabyte byte arrays; replacing assertion machinery with Node's byte-array comparison resolved it without increasing timeouts or reducing bytes/assertions.
- Focused ESLint for owned formula/style/stress modules and `tsc --noEmit -p packages/ssconvert/tsconfig.test.json` passed. Root must rerun maintained uncached build/test/lint gates after final integration.

## Remaining mismatches and unmeasured cases

- Native palette selection traverses a hash table and retains native default colors; this writer allocates custom colors in workbook order, with fixed standard color aliases. The exact chosen colors, palette indices, warning ordering/color ids and GLib warning envelope are not native-byte parity. Only saturation-to-black behavior and meaningful warning presence are verified here.
- Qualified NAME_X tokens and external-function expressions are not fully translated by the current product BIFF importer. Token-layout tests do not establish product importer roundtrip. Root's native reopening/independent-reader checks must establish interoperable names/formulas separately.
- Native differential measurements were not executed by this independent worker. Parent native/reader QA remains separate evidence; this document does not turn its unmeasured cases into passes.
- Large addin argument counts, external-workbook formulas/links, every reference boundary/truncation/cache combination, all shared/array formula patterns, every date/name scope, exact native unsupported-function diagnostics and save-failure behavior are not comprehensively measured by these ten stress cases.
- Object/chart/comment/printing fidelity and byte-exact native interoperability are outside this worker's owned runtime modules. Root-owned metadata tests and native QA are required; passing allocation tests or valid signatures do not establish those features.
- Cancellation is verified at entry for output records, CFB creation and formula compilation with exact thrown reason identity. These tests do not establish arbitrary concurrent asynchronous cancellation/preemption or an overall RSS bound.

## Final integration review

The parent requested another independent read-only review after print/comments/hyperlinks, long caches, BIFF7 per-sheet extern links and workbook-view integration. Root-owned `biff-write.ts` and `biff-write-metadata.ts` were inspected without editing them; new regressions stay in the independent stress test.

Verified additional passes: actual factory container-padding and record-node budgets; diagnostic-callback cancellation with exact borrowed reason identity; metadata work admission; invalid anchor syntax returns existing `invalid-request`, exit 1; late addin/macro tokens and workbook names are correctly finalized in both DSF streams, including internal-sheet link indices after addin index zero.

Concrete failing regressions sent to root for repairs:

- Two one-cell sheets bypass aggregate `cells: 1` and `sheets: 1` factory budgets. Per-sheet cell admission is insufficient.
- Comment `IW65537` is silently discarded in BIFF7 but encoded using truncated NOTE fields in BIFF8; neither produces a loss warning. Regression requires loss diagnostics and no invalid NOTE in either DSF stream.
- Workbook unsupported metadata is ignored, and retained raw BIFF CHART metadata is blanket-skipped because its source is `biff`, with no warning. Regression requires explicit diagnostic coverage for each lost record kind.
- Named `=IF(1,2,3,4)` compiles with a function-argument truncation warning but the parent writer discards its diagnostics. Cell/group warnings already surface. Regression requires the named-expression warning too.

Initial final-review test cohort: 29 tests; 17 passed, 12 failed across three profiles for the four issue families above. This is failing-before evidence, not a final passing gate. Parent retains repair and maintained-gate ownership.

The parent reports native SDK/XML differential export containing an unknown `FOO` is blocked by prewriter recalculation in the existing evaluator. This independently tested compiler/factory addin support does not establish engine export of unknown functions from recalculated input. Evaluator changes were outside the assigned scope; record this as an engine mismatch rather than silently counting the native addin path as passed.

Root repaired all four initial final-review issue families; an independent rerun verified all 29 stress cases pass in 43 ms. Admission now precedes metadata allocation, named warnings are awaited, comment bounds are prepared before drawing groups, and unsupported metadata is reported.

Repair inspection found a further diagnostics regression: writing an original empty workbook, reopening it with the product importer and saving it again emits 18 BIFF7 or 19 BIFF8 false unsupported-metadata warnings. The retained raw default print/header/footer, protection, row-height, WSBOOL and workbook-view records are represented again by writer output; BIFF8 also warns for its own generated self SUPBOOK. Two new original in-memory default-workbook roundtrip regressions fail with the exact warning arrays and were sent to root. Repair must preserve warnings for genuinely unsupported raw charts/metadata; restoring a blanket `source === "biff"` skip would discard the validated loss-warning fix. This is a concrete diagnostic mismatch, not a failure of CFB signatures or allocation.

Root repaired the false-warning regression by comparing retained raw opcode/payload bytes with records actually emitted in the appropriate workbook or sheet scope and normalizing center-only headers. Independent rerun: all 31 stress cases pass in 60 ms; genuine unsupported CHART and workbook metadata cases still warn. Review found no blanket raw-record exemption reintroduced.

The parent separately reports that independent xlrd exposed the zoom record incorrectly emitted as PANE (`0x41`), reproduced it with two failing regressions and changed writer/import metadata handling to SCL (`0xa0`). This worker added two independent tests proving a genuine ten-byte PANE record (including a zero second field) produces no zoom and does not cause a false zero-denominator error, while SCL `150/100` sets zoom 1.5 in both versions.

Final independent cohort: all 33 stress tests pass in 53 ms, with scoped stress-test ESLint and strict `tsconfig.test.json` TypeScript checks passing. No test timeout changes, support narrowing, filesystem/native unit fixtures, evaluator repairs or root-owned runtime edits were performed during these final reviews.

Remaining bounded resource concern: loss comparison currently expands all emitted record payloads to retained hex strings even when no raw records require comparison, and its work accounting counts records rather than payload bytes. Output-byte admission bounds the data, so this is not an unbounded-allocation claim. Avoiding comparison expansion for unqueried opcodes would reduce work/memory; no speculative runtime repair was performed by this worker.

Parent reports separate final native reopening of BIFF7, BIFF8, whole DSF and each extracted DSF stream returns exit 0 with empty stderr; independent xlrd reports no CFB issues for the four writer streams. This worker did not rerun those native utilities; parent capture remains the authority for those results.

## Final long-LABEL review

Parent measured native BIFF7 export of an original 65,536-byte cell LABEL: native succeeds, emits `Truncating string of 65536 bytes` and native reopening retains 65,535 bytes. The previous candidate save failure was reproduced before parent repaired the writer to await the warning and truncate. This worker reviewed only that bounded change and added two independent in-memory cases using fully frozen source workbook/sheet/cell/value objects:

- Cancellation inside the awaited truncation diagnostic rejects with the exact borrowed reason; the original 65,536-character value, final `Z` sentinel and object identities remain unchanged.
- Successful export emits exactly that warning, records a LABEL length of 65,535, and preserves all 65,535 retained `x` bytes across LABEL and consecutive CONTINUE records; the final `Z` sentinel remains in the unchanged original input only.

Parent reports xlrd reads only the initial 2,072 LABEL text bytes from both native and candidate in this fixture. This reader limitation is not a successful long-string interoperability pass; native reopening and independent byte/continuation validation provide distinct coverage. No native utilities were spawned by these unit tests, and no runtime files were edited during this review.

Final bounded-review verification: all 35 independent stress tests pass in 128 ms; scoped stress-test ESLint and strict `tsconfig.test.json` checks pass. Remaining gaps above remain explicit and are not counted as passes.
