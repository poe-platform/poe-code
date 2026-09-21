# Workbook merge QA procedure

Source and native oracle are QA-only. Product uses the shared TypeScript engine
with injected byte I/O, cancellation and bounded owned workbook snapshots.
Do not edit READMEs, push, publish, or alter unrelated work.

1. Download Gnumeric 1.12.61 into `out/ssconvert-merge`, verify SHA-256
   `2ac135d856572713c1a408b76b50a59f2a9769ed21f1213446b5af255df20a12`,
   and extract only there. Review `ssconvert.c`, `sheet.c`, `workbook.c`,
   `expr-name.c`, and sheet-object graph/data ownership callbacks.
2. Reproduce concrete failures using original in-memory workbook fixtures and
   memfs engine I/O before repairs. Check two-input SDK validation, namespaces,
   stable sheet order, largest dimensions, retained objects/chart dimensions,
   dynamic dependency flags, cancellation and budgets.
3. Independently stress/fix with another agent. Root owns engine, integrations,
   export wiring and Git; reviewers must reproduce before changing code.
4. Use the separately bound native 1.12.61 QA container with C locale, UTC,
   memory settings backend and installed schema directory. Capture binary hash,
   dependencies, locale and plugin activation lists. Probe normal merge, multiple
   name conflicts, empty suffix, sheet/active-sheet exporter options on empty
   destination, explicit split incompatibility, implied split under graph mode,
   forced importer/encoding and ignored `--set`. Compare statuses, exact stderr,
   sheet names, formulas, order and output effects. Initial profile failures stay
   disclosed; unsupported/unmeasured combinations are not passes.
5. Run maintained uncached selected build closure, package unit tests and lint,
   followed by maintained safe-bash integration checks and actual virtual command
   probes through built public imports. Capture and inspect CLI screenshot evidence.
6. Reduce evidence and remaining mismatches to a verification record, bind source
   and tests with hashes, then purge only this task's scratch in
   `out/ssconvert-merge`. Scoped success is not full Gnumeric parity or a full gate.
