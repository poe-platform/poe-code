# Legacy text importers QA

1. Authenticate Gnumeric 1.12.61 primary archive in `out` against SHA-256 `2ac135d856572713c1a408b76b50a59f2a9769ed21f1213446b5af255df20a12`. Audit `plugins/applix`, `plugins/oleo`, and `plugins/sc`, including conventions and plugin descriptors.
2. Before implementation run original small in-memory importer regressions through injected memfs byte I/O. Require a concrete failure for each missing reader.
3. Compare original cases with the separate native QA oracle in the Colima `ssconvert-statistics-qa` container. Capture version, dependencies, plugin bindings, locale, input/output bytes, diagnostics and statuses under `out`. Never invoke native code in product or unit tests.
4. Exercise supported expressions through workbook AST and recalculation, cached results, strings, metadata, repeated records, malformed input, unsupported directives, input/cell/work/sheet bounds, and cancellation. Check virtual command/SDK parity and unchanged unrelated namespace contents using memfs.
5. Have a different agent stress/fix the implemented readers with failing regressions before repairs. Root owns providers, exports, integration and Git.
6. Run the narrowest maintained uncached selected workspace build and unit routes, workspace lint, and Safe Bash command integration checks. Record actual checks and remaining mismatches; unmeasured cases are not passes. Do not push, publish, edit READMEs or discard unrelated changes.
