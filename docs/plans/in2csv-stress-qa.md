# Independent in2csv stress QA

After building the csvkit domain package, run the focused file with `node --import tsx --test packages/safe-bash/tests/commands/in2csv-stress.test.ts`. The maintained safe-bash `npm test` route does not filter on `SAFE_BASH_TEST_RG`; do not assume that variable narrows its inventory. Tests execute registered literal commands through Shell with injected capabilities and MemoryFileSystem; they never invoke native tools or create host files.

Compare stdout, stderr, status and VFS state for source format-priority rules, unsupported extension rejection before input acquisition, ragged CSV fast-path output, ignored workbook flags, named-input NUL handling, JSON `.js` inference, and output-before-failure for non-Excel sheet writing. The last case is frozen in `docs/csvkit/operation-observations-20260917.json` under `write-sheets-csv`.

Original reproduction: the existing CSV converter rejects any `--write-sheets` before producing stdout, while the frozen reference produces `a\nx\n` then `ValueError: read of closed file`. This case must fail before the fix and pass afterward.

Initial focused run: five tests, four passed, one failed exactly on the stdout/status/diagnostic mismatch above. A broad maintained run was interrupted before test execution after discovering the selector did not apply; it is not a verification pass.

Workbook binary decoding, DBF driver semantics, JSON inference and locale formatting are not established by these cases. Independently measure and test those surfaces before claiming compatibility; absent evidence remains a blocker.

Independent GeoJSON stress: pinned reference measurements are recorded in `docs/csvkit/in2csv-geojson-stress-reference.json`. Thirteen cases cover nested list Python repr (including OrderedDict children), null/list properties, non-array features, malformed feature/geometry, and string/null/map/integer Point coordinates. First reproduce list/malformed-property failures, then fix only the GeoJSON importer. Coordinate null/map/integer failures were separately reproduced before replacing explicit blockers with measured diagnostics. These cases compare complete output/status and ensure no VFS files appear.

After the first GeoJSON fixes, the complete focused file passed seven tests; coordinate diagnostics were then added and the original blocker reproduced. Rebuild csvkit, rerun the complete file and package lint after the final diagnostic fix.

An additional raw JSON `-0` integer regression was measured, reproduced and fixed for both scalar IDs and nested list values. The final focused suite has eight tests. Package lint initially reached test typechecking and failed on the integration owner's `src/in2csv.test.ts` line 44; root was notified to repair that owned file.

Final descriptor integration review adds a ninth actual Shell test: export selected workbook sheets into MemoryFileSystem, replace an existing longer CSV by truncating it, compare both side-file byte payloads and stdout, and preserve original workbook bytes. All nine tests passed without rebuilding during root aggregate checks.

Cleanup review: side-file destination cleanup enrolls before acquisition, awaits a pending open, blocks writes after close admission, drains the admitted write, and closes cooperatively. The safe-bash descriptor adapter independently registers its root cleanup before capability/open acquisition. A concrete ownership issue was reported to root: the command adapter enrolls all csvkit cleanup callbacks under stdout as well as root, so stdout consumer closure can close an admitted sibling side-file destination and globally close Runtime. This conflicts with destination-specific ownership requirements; root owns the adapter correction and its verification.
