# Chart and object model QA

Reference: Gnumeric 1.12.61 source archive SHA-256 `2ac135d856572713c1a408b76b50a59f2a9769ed21f1213446b5af255df20a12`, rechecked locally. Source is retained only under `out/ssconvert-lifecycle`. Dependency/plugin/locale captures are in `docs/ssconvert/reference-profile.json`; optional extensions are not runtime-qualified by this task.

## Source plugin census

| Plugin | Services |
| --- | --- |
| GOffice_lasem | component_engine:GoLasemComponent, component_type:GoLasemComponent |
| GOffice_plot_barcol | plot_engine:GogLinePlot, plot_engine:GogAreaPlot, plot_engine:GogBarColPlot, plot_engine:GogDropBarPlot, plot_engine:GogMinMaxPlot, plot_type:1.5d |
| GOffice_plot_distrib | plot_engine:GogBoxPlot, plot_engine:GogHistogramPlot, plot_engine:GogProbabilityPlot, plot_type:boxplot |
| GOffice_plot_pie | plot_engine:GogRingPlot, plot_engine:GogPiePlot, plot_type:pie |
| GOffice_plot_radar | plot_engine:GogRadarPlot, plot_engine:GogRadarAreaPlot, plot_engine:GogPolarPlot, plot_engine:GogColorPolarPlot, plot_type:radar |
| GOffice_plot_surface | plot_engine:GogContourPlot, plot_engine:XLContourPlot, plot_engine:GogXYZContourPlot, plot_engine:GogXYContourPlot, plot_engine:GogSurfacePlot, plot_engine:XLSurfacePlot, plot_engine:GogXYZSurfacePlot, plot_engine:GogXYSurfacePlot, plot_engine:GogMatrixPlot, plot_engine:GogXYMatrixPlot, plot_engine:GogXYZMatrixPlot, plot_type:surface |
| GOffice_plot_xy | plot_engine:GogXYPlot, plot_engine:GogBubblePlot, plot_engine:GogXYColorPlot, plot_type:plot_xy, plot_engine:GogXYDropBarPlot, plot_engine:GogXYMinMaxPlot |
| GOffice_reg_linear | trendline_engine:GogLinRegCurve, trendline_engine:GogExpRegCurve, trendline_engine:GogPowerRegCurve, trendline_engine:GogLogRegCurve, trendline_engine:GogPolynomRegCurve, trendline_type:linreg |
| GOffice_reg_logfit | trendline_engine:GogLogFitCurve, trendline_type:logfit |
| GOffice_smoothing | trendline_engine:GogMovingAvg, trendline_engine:GogExpSmooth, trendline_type:smoothing |

## Source sheet-object census

Stable classes in the released source: GnmCellComment; GnmSOFilled, GnmSOLine, GnmSOPath, GnmSOPolygon; SheetObjectGraph, SheetObjectImage, SheetObjectComponent; SheetWidgetFrame, SheetWidgetButton, SheetWidgetCheckbox, SheetWidgetRadioButton, SheetWidgetToggleButton, SheetWidgetList, SheetWidgetCombo, SheetWidgetSlider, SheetWidgetSpinbutton and SheetWidgetScrollbar. Historical XML names: Rectangle, Ellipse, Line, Arrow, GnmGraph, CellComment, SheetObjectGraphic, SheetObjectFilled, SheetObjectText and SheetObjectPath. Component availability is profile-dependent. The source declares these in xml-sax-read.c and sheet-object/widget type registration; native export uses a class export-name override (notably CellComment).

## Codec behavior inspected in current product

| Codec family | Existing behavior | New shared projection | Verification limit |
| --- | --- | --- | --- |
| Gnumeric XML/gzip | Retains grammar-admitted object trees; drops unrecognized grammar | Graph/image/shape/comment/control/component classification and recursive passive metadata | Original XML round trip and rename covered; defaults and native canonical spelling differ |
| XLSX | Retains selected related drawing/VML/package parts | No shared object translation yet | Prior package tests cover retained parts; native object fidelity unmeasured here |
| ODS/SXC | Retains selected embedded image/chart parts and maps comments | Only already mapped Gnumeric object records project | Prior package tests cover selected parts; full semantic translation unmeasured here |
| BIFF XLS | Existing partial binary codec | No shared object translation yet | Full chart/drawing/control preservation unmeasured |
| Text/data/document codecs | Existing cell-oriented codecs; no new object behavior | No new object translation | Per-object native drop/render/reject policy not yet measured |
| Graph export | Detects graph objects only and requires injected rendering capability for nonempty graphs | Passive graph tree available to renderer | Existing lifecycle/integration tests; plugin paint fidelity unimplemented |

This table distinguishes inspected product behavior from native differential qualification. It is not a complete native codec policy matrix.

## Procedure

1. Run original in-memory object fixtures through the shared engine, with memfs byte I/O. Inspect graph hierarchy, dimensions, passive styles and anchors before and after XML export/import.
2. Rename, merge and resize sheets; inspect graph dimensions using the shared projection after each operation. Recalculate and update source cells; confirm expressions remain linked rather than replaced with display text.
3. Use the separately configured native oracle for differential graph export, plugin-specific round trips and printing. Capture locale, fonts, plugin activation and dependency identity. Never invoke the oracle from unit tests or use it as a product fallback.
4. Independently stress cancellation, work bounds, namespace filtering, order and producer ownership; record only observed passes.

## Current scope and remaining mismatches

The added shared model is a projection of the existing authoritative Gnumeric XML object tree. It classifies graphs, images, shapes, comments, controls and passive components; exposes anchor ranges/offsets, names/order, recursive chart roles/types, properties and source dimensions. Reprojection observes existing formula rewrites without duplicate mutable references.

Gnumeric handlers retain their existing grammar-filtered object trees. Historical aliases remain spelled as imported rather than native canonical export spelling. No new opaque payload preservation policy is introduced. ObjectNode retains supported styles, labels, paths, image data and widget metadata as passive typed tree primitives; semantic image decoding and native font/paint layout are unimplemented. The layout API converts two-cell, one-cell and absolute anchors into point rectangles using explicitly injected axis metrics, matching the endpoint equations in sheet-object.c:1000–1045. Signed extents retain orientation; paint/direction/RTL handling remains a renderer responsibility.

Full semantic XLSX/XLS/ODS chart/drawing preservation and translation, plugin-specific chart validation, rendered charts/shapes/text/images, print layout fidelity, native object default normalization, optional component/Lasem runtime qualification and complete per-codec preserve/render/drop/reject mapping remain unimplemented or unmeasured. This feature task is incomplete; these cases are not passes. Native --export-graphs still uses the existing graph-only detection and explicitly injected rendering capability.

No push or publication is authorized.

## Final local verification

- `npm run build:workspaces -- --workspace=@poe-code/ssconvert --no-cache`: passed selected maintained dependency closure (office-package, safe-fs, ssconvert).
- `npm test --workspace=@poe-code/ssconvert`: fresh execution passed 245 files / 5,379 tests. The initial run failed on the new test's mistaken sheet quoting expectation, corrected to the maintained serializer's quoted spelling; no serializer behavior changed.
- `npm run lint --workspace=@poe-code/ssconvert`: passed ESLint, product TypeScript and test TypeScript after correcting a test fixture to omit an optional range rather than assign undefined.
- `npx vitest run packages/ssconvert/src/objects`: passed 14 tests across two files after independent fixes and final test type correction.
- `node --import tsx --test packages/safe-bash/tests/commands/ssconvert.test.ts packages/safe-bash/tests/commands/ssconvert-model.test.ts`: passed 61 SDK/virtual-command integration cases, including diagnostics, namespace effects and replay coverage. No new graph painting fidelity claim.

The root unit runner does not support a selected-workspace option; an attempted selected `npm test -- --workspace=... --no-cache` failed argument admission before any tests. The maintained package route above runs fresh Vitest directly. Root Vitest excludes safe-bash; its selected tests were run with the package's native node/tsx test runner instead. These rejected invocations are not counted as passing checks.

Independent review evidence: `docs/plans/ssconvert-chart-object-independent-qa.md`. No CLI display behavior changed; no new visual/render parity is claimed. No new native differential was captured in this task. Existing reference profiles were reused only as provenance, not as passes for this model. Temporary final unit log was read into this record and purged; existing source and unrelated evidence were preserved.
