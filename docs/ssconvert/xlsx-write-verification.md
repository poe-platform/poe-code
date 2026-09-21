# XLSX writer verification — Gnumeric 1.12.61

Both stable exporter IDs are installed through the declarative Excel provider and shared SDK/virtual-command engine. `Gnumeric_Excel:xlsx` selects ECMA-376:2006; `Gnumeric_Excel:xlsx2` selects the 2008 edition. Both use transitional namespaces. They differ in border edge names and web-publishing attributes. The native plugin declares both savers at automatic format level; native reverse registration ordering and the product registry resolve `.xlsx` to `xlsx2`. Neither saver supports a subset of sheets; the common engine rejects that selection before publishing bytes.

Reference archive SHA-256: `2ac135d856572713c1a408b76b50a59f2a9769ed21f1213446b5af255df20a12`. Primary source was authenticated and read only under `out/ssconvert-lifecycle`. The separate QA oracle is Gnumeric 1.12.61, Linux/aarch64, C locale, UTC, with an isolated HOME/settings profile. Its executable hash, dynamic dependencies, relevant distribution package versions, exporter/importer listings and exact reopen diagnostics are captured in [xlsx-write-reference-profile.json](xlsx-write-reference-profile.json). Native execution is absent from product code and unit tests.

## Measured comparison

An original two-sheet fixture exercises numeric/string cells, `=A1+2`, a 1904 date system, manual calculation, custom number formatting, styled empty cells, basic equality conditional formatting, whole-number validation, URL/fragment relationships, a comment, fixed creation metadata and typed custom properties. Both profiles have the same 13 ordered OPC members as native. All 13 parsed parts match semantically, retaining attribute order, child order, formula/cache text, relationship IDs and targets. Only element-only XML indentation is excluded from this comparison. The missing manual-workbook formula cache was independently detected and repaired by a failing regression; it now serializes `5`.

Openpyxl 3.1.5 reads both outputs: formula `=A1+2`, cache `5`, comment text, one validation and one conditional-format region. Native reopens both candidate and native control files with status 0 and identical diagnostics: `Unhandled object of type Note` and an unexpected `vt:decimal` custom-property element. These upstream reader losses are recorded, not treated as clean round trips. Openpyxl also reports the native-compatible absent default style and unsupported decimal custom-property type.

Repeated candidate exports with fixed injected inputs produce identical bytes. Raw XML differs from native in all 13 parts because native pretty-prints. ZIP timestamps, UTF-8 flags (candidate 2048/native 0), creator versions (30/20), UT extras, CRCs and compressed streams differ. Raw-byte identity is **not** established. Archive ordering is measured independently of byte equality.

The exporter listing was rendered to a terminal screenshot and visually inspected. CLI file effects are tested in memfs. Safe-bash tests compare actual virtual-command bytes to SDK bytes for both exporters, default selection, exact selection diagnostics, namespace effects and CSV replay. Independent agent stress added regressions for injection, cyclic/deep metadata, budgets, cancellation identity, property/format prototype collisions, full-sheet styles with column metadata, filters and preserving existing caches during missing-cache evaluation.

## Source handler audit and limitations

The following distinguishes implemented/measured cases from unsupported and unmeasured cases. Unsupported cases are never passes.

| Handler group | Coverage and remaining limits |
| --- | --- |
| Formulas/caches (`xlsx-write.c:1563`) | Formula grammar conversion, numeric/string/bool/error caches, basic array corner handling and missing-cache materialization use existing bounded capabilities. Original caches are preserved. Shared/array/data-table/volatile/external/unsupported-function combinations are not exhaustively differentially qualified. Missing-cache evaluation uses the existing evaluator's supported functions, not native's complete function set. |
| Numbers/styles/date systems (`605–1391`) | Built-in/custom formats, fonts/fills/borders/alignment/protection, full-sheet column baseline, 1900/1904 dates. First/second-edition edge names measured. Uncommon pattern/alignment/rotation/font combinations are unmeasured; differential styles export basic fill/font only and warn for omitted format/alignment/border/font fields. |
| Names/strings (`323`, `3043`) | Defined names, scoped defaults, inline/shared strings and bounded rich runs. Native string interning/reference-count decisions are approximated. Rich-font reader round-trip has a retained `rFont`/`family` mismatch; rich strings are not claimed fully qualified. |
| Merges/dimensions/limits (`1790`, `2183`) | Basic merges, dimensions, row/column metadata, styled empty-cell expansion and full-sheet baseline regression. Writer caps are 1,048,576 rows/16,384 columns. Product rejects out-of-range data; native import warning/truncation behavior is not matched. True extreme native writer cases remain unmeasured. |
| Drawings/charts/images (`xlsx-write-drawing.c`, `xlsx-write-chart.c`) | Comment VML is measured. Other drawings/charts/images, controls and embedded components are not exported; retained object records warn. No complete chart/image parity claim. |
| Comments (`2760`) | Basic text/authors/relationships/VML measured; rich comment markup and geometry are not exhaustively supported or measured. Native's own Note reopen diagnostic remains. |
| Tables/filters (`2247`, `3013`) | Native source lists tableParts as unimplemented schema commentary; no table output is claimed. Canonical expression, dual-expression, blanks/noblanks and item/percent bucket filters have source-backed tests, ascending field ordering and first-filter behavior. Native's reversed Value/ValueType XML attributes and ignored IsAnd quirk are preserved. Unsupported variants warn. Full filter grammar differential coverage is unmeasured. |
| Validations/CF (`1806–2096`) | Measured style-region whole/between validation, basic cellIs/expression rules, input messages and safely retained OOXML validations. Operators beyond the implemented range warn; full DXF overlays warn. Cell-only imperative style metadata warns. Complex cross-sheet formulas, CF priorities and raw CF reopen are not fully qualified. |
| Links (`2096`) | URL fragments, targets, IDs, tooltip and internal links implemented; measured external URL relationship. Other link schemes and multi-range interning remain unmeasured. |
| Workbook/print (`2352–2759`, `3088`) | Calculation settings, scalar core/extended/custom properties and basic print defaults/settings. Exported document metadata no longer falsely warns; unknown leaves still warn. Views, freeze panes, protection details, tab text color, many paper sizes/print flags and extensions are incomplete/unmeasured. Unsupported scalar shapes may not export. |
| Extensions/pivots/loss channels | Native enables Gnumeric extensions for both profiles. Native pivot refresh timestamp has a separate edition switch (`xlsx-write-pivot.c:277`); pivots are not implemented, so this profile distinction is unsupported. Product loss warnings are stable diagnostics and differ from native's PID/time-dependent warning channels. Unknown retained records warn rather than being copied with dangling relationships. |

Output admission is bounded and cancellation uses the caller's reason. Metadata names/namespaces and retained relationships are checked. The aggregate plain-XML cap is stricter than native's compressed-file behavior. No host clock or native fallback is synthesized. The complete native XLSX writer feature surface and byte/diagnostic parity remain **incomplete**.

## Validation receipts

- `npm test --workspace=@poe-code/ssconvert -- --no-cache`: 152 files, 4,133 tests passed.
- `npm run lint --workspace=@poe-code/ssconvert`: ESLint and both source/test TypeScript checks passed.
- `npm run build:workspaces -- --workspace=@poe-platform/safe-bash --no-cache`: maintained 18-workspace dependency closure passed, including native npm suffix stages.
- Focused safe-bash ssconvert/text/encoding tests: 51 passed; changed integration-test ESLint passed.
- Independent-agent writer/metadata/filter/stress cases: 74 passed; unit tests use in-memory inputs and memfs, never native utilities.
- Full maintained safe-bash unit run: 44,099 passed, zero failed, 831 skipped, two TODO cases. TODO blockers concern csvkit numeric/null float serialization and unavailable `/dev/fd/3`; neither is a pass.

An initial concurrent ssconvert run timed out in an unchanged advanced-statistics test; final uncached maintained execution passed without modifying assertions or timeouts. The proposed rich-font reader alteration was rejected by primary-source audit: native deliberately ignores `rFont` while handling `family` (`xlsx-read.c:3528–3531`). The native-compatible reader behavior was preserved; this upstream writer/reader loss remains documented.

The six-field original filter fixture matched native for both profiles, preserving attribute values including the nonblank filter's single space. This is measured coverage for those six fields, not all 22 unit cases. The QA procedure lives in `docs/plans/ssconvert-xlsx-write-qa.md`; generated temporary evidence stays under `out` until reduced and purged. No README files, commits, pushes or publication are part of this task.
