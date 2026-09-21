# Excel 2003 SpreadsheetML QA procedure

Root owns registry, integration, exports and Git; preserve existing work and do
not push, publish or edit READMEs. A different agent stress tests and fixes the
importer after the initial implementation passes.

1. Authenticate the official Gnumeric 1.12.61 archive in `out` against
   `2ac135d856572713c1a408b76b50a59f2a9769ed21f1213446b5af255df20a12`.
   Inspect `plugins/excel/excel-xml-read.c` and its corpus. Capture the separate
   native oracle's binary, dependencies, plugins, locale and invocation profile.
2. Run the original in-memory sparse SDK regression before implementation.
   Unit file I/O uses memfs; native utilities are manual QA only.
3. Compare types/dates, sequential sparse indices, duplicate sheets/cells,
   Default inheritance, ignored Parent, formats, formula origins/caches, names,
   conditional merges, axes, selection, properties and ignored print settings.
4. Compare root-content probing with Gnumeric XML, namespace aliases/rebinding,
   malformed XML, unknown nodes, unsupported links/comments, cancellation and
   node/text/cell/sheet/work budgets. Unsupported/unmeasured cases are not passes.
5. Execute independent agent stress/fix using TDD. Root integrates command cases.
6. Run maintained uncached selected workspace build/test/lint and relevant
   cross-workspace command checks. Reduce results to a coverage report, preserving
   every mismatch; remove only this task's temporary output after use.
