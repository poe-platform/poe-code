# Chart data builder implementation

Owner: chart_builders agent. Scope: detached category/XY/bubble builders, category hierarchy, inherited sequence/reference helpers, bounded workbook serialization, placeholder integration, and original tests.

Read root instructions and the PPTX/shared SDK/shared CLI contracts, API audit/inventory and test audit/inventory. No disposable files or external runtime are used.

1. Establish missing builder behavior with original failing tests.
2. Implement detached typed builders, UTC dates, category hierarchy and original collection semantics.
3. Reuse chart XML and workbook writers; carry explicit point formats into worksheet styles and XML caches.
4. Integrate placeholder insertion through the same operation data; retain source member spellings.
5. Verify focused tests and package lint/type checks, record exact API/language mappings in docs/pptx.

Completed: steps 1–5. Tests initially failed missing module; date-axis preservation, point styles, placeholder bridge and stepped slices subsequently had independent red/green evidence. All fixture bytes stay in memory; workbook persistence assertions use memfs.

Agent QA: create a category hierarchy, a UTC date chart, numeric categories, XY data and bubble data; inspect XML caches and owned workbook rows/styles; exercise reverse/sliced traversal and foreign-owner rejection; reopen an inserted chart after save and verify data. No renderer or host application is required for detached data behavior.

Later scoped work: shared preserving Chart.replace_data callback, live part binding, workbook admission and aggregate budget, pending serialization/cache refresh, imported 1904 epoch retention, and opaque-workbook preservation. Pinned primary source data.py/xlsx.py research resolved inherited category coordinate errors, null spellings, global indexes and date defaults. These source names appear only in research evidence.
