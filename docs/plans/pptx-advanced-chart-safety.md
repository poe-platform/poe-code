# Advanced chart import preservation

## Scope and ownership

Implement a bounded F08/F39 import correction inside `packages/pptx`: preserve chart-local identities and opaque chart/style/color bytes while rewriting OPC relationship targets. Own `src/chart-import.ts`, `src/advanced-chart-import.test.ts`, and focused edits in `src/slide-import.ts`, `src/slide-copy-xml.ts`, and `src/slide-import.test.ts`. Draft usage and research receipt belong in `docs/pptx/advanced-chart-safety-evidence.md`. Other workers own CLI regressions and disposable corpus QA. No root logic, README edits, native execution, product networking, or product filesystem access.

## Validated finding

Before the change, the original SDK regression's standard combination/3D/trendline/error-bar chart with chart styles, and its chartEx variant, both failed import with `unsupported-edit: Import encountered an unsupported dependency type.` The graph rejected chartEx/style/color relations. Its XML copier also rejected every `extLst`, so accepting only the graph would not preserve those charts.

## Procedure and validation

1. Author tiny original assets in memory, starting from a memfs-backed presentation. Include chart/style/color/workbook collisions, a valid slide graphic frame, and independently parsed relationship assertions.
2. Observe the failing preservation cases before implementing the policy. Red: 2 failures, 5 defensive rejections pass.
3. Retain local chart-resource relationship IDs because they are scoped to the copied owner. Allocate distinct part names and rewrite `.rels` targets only; preserve chart/style/color/workbook SHA-256 exactly.
4. Reject unknown namespaces, unsafe references, wrong resource roots and unsafe outgoing dependency roles. Keep generic slide/layout/master XML remapping conservative.
5. Verify the imported chart is discoverable through SDK `readCharts`, and confirm source and destination resource hashes are unchanged.
6. Run focused SDK tests, maintained package build/lint/test, and independently authored safe-bash CLI tests. Corpus QA follows the separate [corpus procedure](pptx-advanced-chart-corpus.md); binaries remain disposable and excluded from commits.

Focused green checkpoint: 51/51 tests across advanced chart import, slide import and slide copy; seven new cases completed in 211 ms. Final focused checkpoint: nine new cases pass in 214 ms, including wrong-resource-root and chart-to-slide dependency rejection. `npm run lint --workspace=pptx` passes, including production and test typechecking. Other final maintained checks are recorded by the parent delivery report. No full pipeline, push or release is authorized.

## Integration verification

`npm test --workspace=pptx` passed all 3,649 tests in 129 files, including all
nine final advanced-chart regressions (237 ms in the full run). The selected
`npm run build:workspaces -- --workspace=pptx` completed its three declared
dependency builds. Package lint passed after correcting the new fixture map's
typed-array annotation; no product workaround was required.

The maintained safe-bash reporter passed nine chart editing/inventory cases
against rebuilt public package exports. The CLI owner and root both inspected
the disposable unsafe-import screenshot. The separate corpus receipt records
40 exact unmodified resource hashes through an unrelated edit.

These checks ran against the current working tree, including existing image
work. Only the explicitly owned chart files and related plans/evidence are
included in this improvement's commit; this is not a frozen-commit or release
verification claim.

The additional `npm run lint:eslint` repository scan exited 2 at its unchanged
12,000-subject safety cap (`configured: 12001`, `linted: 12000`, zero reported
lint errors or warnings). It is incomplete, not a passing repository-wide gate.
No guard limit, ignore policy or unrelated infrastructure was changed. The
CLI plan records separate literal-file evidence using the existing guard API.
