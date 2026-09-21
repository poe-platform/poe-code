# Current BIFF writer qualification procedure

Preserve existing worktree edits. Do not edit README files, commit, push or publish. Primary source and temporary evidence belong only in `out`. Unit fixtures are original, in memory; use memfs for file effects. Native tools are separate manual QA oracles.

1. Authenticate `out/ssconvert-lifecycle/gnumeric-1.12.61.tar.xz` against SHA-256 `2ac135d856572713c1a408b76b50a59f2a9769ed21f1213446b5af255df20a12`. Inspect source before accepting reported defects. In particular, native writes unique SST counts in both fields; do not change this based solely on the general BIFF specification.
2. Reproduce oversized manual page-break save failures using original in-memory metadata. Native `excel_write_PAGE_BREAK` caps to `(maximum_record_length - 4) / entry_size`, preserving manual order and excluding automatic breaks. Verify BIFF7, BIFF8 and each DSF stream. Require failing-before evidence, then maintained workspace checks.
3. A different agent independently tests and fixes style rotation using native version-specific mappings. Review that agent's QA procedure and retained negative controls; root owns integration, exports and Git.
4. Requalify the available native oracle's binary/version, dependency libraries, plugin list and C/UTC locale. Export original bounded workbooks with version limits, formulas/caches, non-ASCII strings, names, print settings, rotation boundaries, comments and merges. Reopen all three files natively and each extracted DSF stream. Check independent reader CFB integrity and values/styles. Compare manual page-break caps with native export. Invalid/truncated CFB must fail; signatures alone are insufficient.
5. Run uncached selected workspace build closure, maintained ssconvert test/lint, and maintained safe-bash ssconvert command selection against the final candidate. Record hashes of changed source/test files. Broader checks are required if this work expands into shared infrastructure; never report a focused run as a broad gate.
6. Inspect a CLI screenshot for visible diagnostic changes using the maintained screenshot route. Record unavailable runtime, realm, replay or reader cells separately; do not invent passes. Record every remaining mismatch in this document, without equating prior QA notes to current verification.

## Initial evidence

- Source archive hash independently verified in this turn.
- Five original page-break tests: before repair three profile tests fail with `Excel BIFF record is too large`; two automatic-filter/order controls pass. After repair all five pass.
- The default Docker context has no daemon. Explicit `colima` context has the existing `ssconvert-statistics-qa` oracle, whose `/out/ssconvert-statistics-oracle/prefix/bin/ssconvert --version` returns 1.12.61. Its full current profile still needs capture; the separate old lifecycle profile is not evidence of this binary's dependencies.

## Qualification results

The permanent [current receipt](../ssconvert/biff-write-current-verification.json) captures source hashes, reference libraries/plugins/packages/locale, original fixture recipes, native/independent-reader results and remaining mismatches. Candidate content hash: `87243720a920a1ca63084ae8f39a1ad56924804516d17aa942a3a58af96cb693`, covering 340 source/test/manifest files; hashes were rechecked after the final gates without changes. Git HEAD remains `b97c4938a469ee70e09bd08a0e5fcf7e868ca04c`; this candidate includes preserved uncommitted edits and has no new commit or remote delivery.

Additional failing-before cases exposed five importer replay style defects and six wrong-opcode failures. Native defines horizontal page breaks as `0x1b`, vertical as `0x1a`; both writer and importer incorrectly used the inverse, so product roundtrip alone hid the defect. Raw independent opcode/position assertions now pass. Three further failing cases proved excess extent warnings across axes and sheets. Native GOffice `error_info_list_default` selects the oldest prepended warning; the writer now reports the first extent warning only. Row-only and simultaneous column/row CLI captures match native exit status and stderr in all six cells.

Final maintained checks:

- Fresh full ssconvert workspace: `npm test --workspace=@poe-code/ssconvert -- --maxWorkers=1`, 165 files / 4,362 tests passed, zero skipped, unchanged timeouts.
- `npm run lint --workspace=@poe-code/ssconvert`: ESLint and strict runtime/test TypeScript passed.
- `npm run build:workspaces -- --workspace=@poe-platform/safe-bash --no-cache`: maintained dependency closure, 18 builds and native npm stages passed.
- Maintained safe-bash reporter with `--import tsx --test-concurrency=1` and the four ssconvert command files: 52 tests passed, zero skipped. Covers shared SDK/CLI bytes, memfs effects, errors and workbook XML replay/checkpoint data.
- Current independent reviewer: 30 original in-memory tests pass. Root current regression file: 15 cases pass. Neither new cohort spawns native utilities or creates disk files.

Manual native QA: all three profiles, plus both extracted DSF streams, reopen with exit 0 and empty diagnostics for original and explicit-recalc output (ten runtime cells). xlrd 2.0.2 and olefile 0.47 independently read the versions, compare values/styles/merges/page-break arrays and find no CFB parsing issues in the six whole containers. Explicit `--recalc` matches all measured 13 populated positions and six styled positions; missing formula caches in the original manual-calculation input still differ at five positions per stream without `--recalc`. Comments, global `Answer=42`, date system and merges survive native reopening in the bounded fixture. BIFF7 comment encoding loses Ω/author as measured; do not call that Unicode/author preservation. A truncated CFB negative control is rejected natively with exit 1 and `E Inconsistent block allocation table`; xlrd also rejects, and the native negative destination is absent.

The shared screenshot route captured the actual built engine help and BIFF7 row-loss diagnostic in `out`; both images were visually inspected. It uses the same screenshot renderer as `screenshot-poe-code`, while invoking the domain command engine rather than the root poe-code CLI. Help's long `--export-file-per-sheet` description clips at the image edge; it is unchanged by this task. The loss warning is fully visible.

## Failures and incomplete coverage

An initial workspace run observed two independent failing-before underline tests during the worker's repair; 4,338 passed, two failed. An initial reporter invocation omitted `--import tsx` and all four test files failed to load; the corrected complete selection passed. The independent worker corrected a test-only tuple inference TypeScript failure before final checks.

The concurrent final workspace run failed one numerical QTukey test after 6,450 ms exceeded its unchanged 5,000 ms timeout; 4,361 tests passed. Process inspection showed competing test/build activity, including another workspace. No competing process was changed. The entire workspace was rerun with one worker, retaining test membership and timeouts; all 4,362 pass. This is a complete workspace rerun, not a focused rerun promoted to a broad gate. Timing observations do not establish a performance guarantee.

Full requested native parity remains incomplete. Non-comment objects/charts, rich text, external-workbook links, alternate BIFF7 codepages, exact palette/default/property/print/protection/validation records, large formula/name/array continuation, unknown-function engine conversion, and the other mismatch groups remain recorded in the receipt. Empty explicitly declared page-break objects are unmeasured. Foreign realms, browser/workerd hosts, arbitrary concurrent cancellation, full shell checkpoint restoration and RSS guarantees remain unverified. No unavailable cell is counted as a pass. Repository-wide `npm test`, root lint and root build were not run for these focused codec repairs; the full maintained workspace route and selected cross-workspace closure are reported separately.

Purge only this turn's `out/xls-biff-write-current` scratch after reducing its results/profile/hashes into the permanent receipt. Preserve prior native/source artifacts and all unrelated edits. Historical QA documents retain their original evidence; they are not upgraded to current passes.
