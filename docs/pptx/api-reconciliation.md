# PPTX documented API reconciliation

Reviewed: 2026-09-13 UTC. Research only; product implementation has not started.

## Evidence authority and accounting

The baseline is commit `278b47b1dedd5b46ee84c286e77cdfb0bf4594be` of
[the reference source](https://github.com/scanny/python-pptx/tree/278b47b1dedd5b46ee84c286e77cdfb0bf4594be).
The checkout was clean and its HEAD matched the pin. All 54 pinned API/user-guide
RST hashes remain in [the inventory](upstream-api-inventory.json); source-file
hashes, declaration locations, accessor signatures, constructors, inherited
owners, enum values and collection rules have been added. Extraction inspected
Python syntax without importing or executing the reference package.

[The published index](https://python-pptx.readthedocs.io/en/latest/) and all 54
corresponding API/user-guide pages were opened with the web tool. Their displayed
version remains 1.0.0; pinned `src/pptx/__init__.py:28` says 1.0.2. This is a
version-label mismatch, not proof that every published page is from a single
older revision. Direct HTTP downloads were denied with 403; no bypass was used.
[The retrieval receipt](published-docs-review.json) separates denied raw retrieval
from web-reader access. No raw published HTML hash, objects.inv closure or exact
Sphinx-build claim is made.

The original 719 candidate IDs are retained. The expanded inventory records
members individually, including enum values previously nested in type records,
constructors, aliases and protocols. Its total is bookkeeping across different
kinds, not a coverage denominator. A resolved source symbol does not prove its
annotation correct or its behavior implemented. `adaptation_status` stays
`unmapped_not_implemented`; `disposition` describes the research decision and
`implementation_status` remains `not_implemented`.

Discovery no longer depends solely on RST inheritance flags: base members are
expanded on concrete shape, placeholder, axis, series, slide/master and value
interfaces. Returned notes/background objects, text hyperlinks, gradient stops,
chart series/data points/plots, table collections, movie/media/OLE views and
freeform operations are present. Enum aliases and equal-valued members have
explicit records. Standard sequence protocols are distinct from local methods.
The original test inventories are unchanged and are not the API discovery source.

## Drift decisions

Source locations below are relative to the pinned checkout. The inventory stores
exact declaration spans and source hashes. Each decision identifies concrete
evidence; none is inferred from a missing upstream test.

| ID  | Evidence and mismatch                                                                                                                                                                                                                             | Resolution                                                                                                                                                                                                                              |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D01 | `docs/api/presentation.rst` declares `pptx.opc.coreprops.CoreProperties`; `src/pptx/presentation.py` returns `CorePropertiesPart` from `src/pptx/parts/coreprops.py`.                                                                             | Keep the documentation ID and resolved source ID. Expose neutral core properties with all 16 documented attributes; do not recreate the obsolete module.                                                                                |
| D02 | [Shape API](https://python-pptx.readthedocs.io/en/latest/api/shapes.html) annotates `add_chart` as returning `Chart`, while its prose and `src/pptx/shapes/shapetree.py:236` construct a graphic frame and dispatch it through the shape factory. | Correct return to `GraphicFrame`; `.chart` obtains the chart. Apply to both slide and group shapes.                                                                                                                                     |
| D03 | The same API annotates `add_movie` as `GraphicFrame`; `shapetree.py:547` creates a movie picture, and `BaseShapeFactory` returns `Movie` for a video-bearing picture.                                                                             | Correct return to `Movie`, with inherited picture geometry/crop and returned media-format interface; JS admission makes it `Promise<Movie>`.                                                                                            |
| D04 | [Table guide](https://python-pptx.readthedocs.io/en/latest/user/table.html) uses `cell.row_idx`/`col_idx`; neither exists on `_Cell` or its bases in `src/pptx/table.py`.                                                                         | Mark both prose-only symbols as documentation errors. Original coordinate-report recipes must retain row/column positions while traversing the owning table. Do not promise nonexistent properties.                                     |
| D05 | [Freeform API](https://python-pptx.readthedocs.io/en/latest/api/shapes.html#freeformbuilder-objects) mentions `close()`; the class in `src/pptx/shapes/freeform.py` has no such method.                                                           | Use `add_line_segments(vertices, close=True)`. Keep an error row for `close`; the real returned close-operation view is separately included.                                                                                            |
| D06 | `docs/api/enum/MsoPatternType.rst` documents `PERCENT_40`; `src/pptx/enum/dml.py:253` declares `ERCENT_40 = (6, "pct40", ...)`.                                                                                                                   | Source spelling defect. Target `PERCENT_40` retains value 6/XML `pct40`; do not copy the typo as a supported alias.                                                                                                                     |
| D07 | [Slide API](https://python-pptx.readthedocs.io/en/latest/api/slides.html) and the source docstring describe assigning `follow_master_background`; `src/pptx/slide.py:182` defines only a getter.                                                  | Keep source writability false and the documented target setter separately. Implementing the promised toggle is a planned additive obligation. Do not hide this public gap as private or turn documentation into a tested source setter. |
| D08 | `SLIDE_IMAGE` is missing from the placeholder enum RST list, but present in `src/pptx/enum/shapes.py` and demonstrated in `docs/user/notes.rst`.                                                                                                  | Retain symbol 101 with XML `sldImg`; the user guide closes the RST omission.                                                                                                                                                            |
| D09 | `PP_MEDIA_TYPE.SOUND` and `OTHER` both have value 1 in `enum/shapes.py:855`; both symbolic names are documented.                                                                                                                                  | Retain both names and record the equal-value alias. Do not manufacture a distinct numeric value or use this enum alone to prove audio classification.                                                                                   |
| D10 | [Placeholder guide](https://python-pptx.readthedocs.io/en/latest/user/placeholders-using.html) prints `CHART (12)`; source enum assigns chart 8 and table 12.                                                                                     | Correct original examples to chart 8; source enum and XML mapping govern. Old class paths in printed repr examples are not import contracts.                                                                                            |
| D11 | The shape guide says connectors are not supported; `Connector`, `add_connector`, `begin_connect` and `end_connect` exist and are API-documented. AutoShape prose also understates line support as color/width only.                               | Treat prose as historical support commentary. Inventory connector operations and `dash_style`; do not omit them or infer other line features from Office UI prose.                                                                      |
| D12 | Notes prose describes inserting pictures/tables/charts on notes pages, but returned `NotesSlideShapes` only inherits `_BaseShapes`, not `_BaseGroupShapes`.                                                                                       | Inventory its actual inspection/shape behavior; do not invent `add_picture`/`add_table` methods there. Format-level notes editing requirements remain additive, distinct from this source object API.                                   |
| D13 | Adjustment prose describes items as `Adjustment` instances, but `AdjustmentCollection.__getitem__` returns `.effective_value` and assignment writes a number.                                                                                     | Collection indexing is numeric. Retain the separately documented `Adjustment` interface and its constructor evidence.                                                                                                                   |
| D14 | `Presentation.slide_height` prose says absence of slide “width”; implementation checks `sldSz` and returns its `cy`.                                                                                                                              | Height is `cy`; no size element means absence. The word “width” is a prose typo, not a cross-axis dependency.                                                                                                                           |
| D15 | Source constructors truncate unit conversions; freeform coordinates use Python rounding. The shared CLI contract requires nearest, halfway away from zero. Source defaults also discover time, fonts and template/icon assets.                    | J05–J07 explicitly apply the shared rule and capability/original-asset mappings; these are deliberate target differences, not source parity claims.                                                                                     |

Enum name comparison covers every documented enum list: only D06 and D08 produce
name-set differences. Thirteen documented enum aliases are retained, including
`XL_LABEL_POSITION` used in examples. Language synonyms and the media collision
are recorded without relying on enum iteration, which can omit aliases. The
`PROG_ID` enum is discovered from OLE method documentation despite lacking a
standalone enum page; its three values and returned metadata are included.

## Prose and returned-interface review

| Pinned guide                                | Inventory contribution or disposition                                                                                                                                                                                       |
| ------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `autoshapes.rst`                            | Unit conversions, shape placement, solid/no fill, foreground exceptions, theme aliases, line-color side effect, numeric adjustment writes and negative rotation. Office UI capabilities are not additional callable APIs.   |
| `charts.rst`                                | Category/XY/bubble builders and their returned series/data points; frame-to-chart navigation, axes, labels, legends, number formats, series smoothing and aliases. Multi-plot inspection is distinct from creation support. |
| `concepts.rst`                              | Async root factory mapping, original defaults, first-master/layout shortcuts, owned slide creation.                                                                                                                         |
| `notes.rst`                                 | Creating notes getter versus noncreating predicate, optional notes text frame, notes master/shape/placeholder interfaces and enum 101. See D12.                                                                             |
| `placeholders-understanding.rst`            | Placeholder inheritance, specialized returned interfaces and rich-content replacement.                                                                                                                                      |
| `placeholders-using.rst`                    | Sparse keys, key failure, placeholder classification, cover crop, invalidated handles, new picture/graphic-frame returns and title lookup. See D10.                                                                         |
| `presentations.rst`                         | Path/file-like loading and saving become explicit async VFS/byte capabilities; package preservation is not visual equivalence.                                                                                              |
| `quickstart.rst`                            | Creation, slides, runs, images, shapes, tables and iterable extraction; original JS equivalents must await admitted bytes/save.                                                                                             |
| `slides.rst`                                | Append and layout use; hypothetical `insert_slide` and backlog copy/move/delete comments are not source APIs. The format spec separately requires those operations.                                                         |
| `table.rst`                                 | Table/frame separation, row/cell collections, zero-based coordinates, merge/split and `iter_cells`. Local recipe functions are examples, not exported library helpers. See D04.                                             |
| `text.rst`                                  | Paragraph/run hierarchy, required empty paragraph, destructive setters, tri-state formatting and returned run hyperlink. General descriptions of 3D/columns/kerning do not establish callable members.                      |
| `understanding-shapes.rst`                  | Shape tree iteration and nested ownership; historical support statements resolved under D11.                                                                                                                                |
| `install.rst`, `intro.rst`, `use-cases.rst` | Installation, licensing and motivation; no extra document-model callable surface. Native reference dependencies are not target dependencies.                                                                                |

The returned graph includes names beginning with underscores. Explicit RST helper
exclusions and Python dependency internals are not automatically public exports,
but public XML/part access remains an explicit bounded-view obligation (J09).
Source helpers encountered through that graph are retained with a mapping rather
than dropped based on spelling. Type-annotation interfaces are not evidence that
an unrestricted Python XML or package implementation must be copied.

## Boundary of completion

This completes the candidate expansion and the identified documentation-drift
reconciliation for the pinned evidence. It is not a mathematical certificate
that no future review can discover another public member. Concrete target TS
return/argument types where source annotations are absent, every typed CLI/batch
schema, transitive errors, and original acceptance cases remain required by the
next API-definition and implementation tasks. Those omissions block implemented
whole-API claims; they are not counted as passes or architecture-only exclusions.

No reference suite was rerun, no publisher deck or cloned binary was executed,
and no fixtures were removed. The 2,700 source unit variants and 973 BDD examples
retain their previous unimplemented adaptation status. Meaningful future QA cases
must become small original memfs tests before disposable-input cleanup.
The agent verification procedure and results are in
[the reconciliation plan](../plans/pptx-api-reconciliation.md).
