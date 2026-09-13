# Live slide and placeholder model evidence

## Implemented behavior

`Presentation.slides` now owns live slide objects. Slide shapes use zero-based
numeric lookup; placeholders use sparse `idx` lookup, sorted iteration, and
`KeyError` for missing keys. Duplicate placeholder keys fail with
`ambiguous-selection`. Collection replacement/deletion through numeric JavaScript
properties fails. `at` supports negative sequence offsets; `get_by_id` looks up
slide or shape identities and returns null when absent. Sparse placeholders do
not acquire sequence-offset semantics.

Geometry getters preserve explicit zero and resolve absent coordinates through
layout then master. Master lookup uses placeholder type categories rather than
requiring matching idx. Reads do not materialize inherited attributes. Setting a
coordinate preserves the paired inherited coordinate. Table insertion inherits
position and width, and sets height to 370840 EMU per requested row. This row
height is a model default, distinct from inherited placeholder height. The pinned
placeholder source was independently rechecked by the root agent at line 404
of `/tmp/pptx-placeholder-source-20260913.txt`: its table insertion derives
height from the requested row count and this exact EMU default. Source SHA-256:
`7bb9bc6bf557299c31b36b6390d27a0bda01f402d2dcc00ce055804d9092f600`.

Rich insertion preserves sparse idx, shape ID, name and drawing order. Tables
return GraphicFrame, pictures return Picture, and charts return GraphicFrame.
The replaced placeholder and its owned descendants fail through the original
owner binding. Returned table edits and chart style/legend edits remain attached
to the presentation and survive save/reopen. Picture crop properties remain live.

Shape collections add shapes, text boxes, connectors, freeforms, and groups.
Groups accept existing distinct direct children of the same owner, reject foreign
handles before mutation, preserve moved shape handles, and update ancestor bounds
on child insertion without discarding group rotation. Shape IDs share the root
slide drawing; turbo appends preserve a validated immutable XML snapshot and
rescan after other changes.

## JavaScript and security mappings

- Neutral names such as `placeholder_format`, `insert_picture`, `insert_table`,
  `insert_chart`, `build_freeform`, and `turbo_add_enabled` are retained.
- `insert_picture(BinaryInput)` is asynchronous admission: the model accepts owned
  bytes or an explicitly supplied stream/VFS capability and infers PNG/JPEG media
  type after container validation. No implicit path, host filesystem, or network
  access is available.
- `insert_chart(XL_CHART_TYPE, ChartData)` accepts the documented numeric enum.
  An explicit `CreatableChartType` string overload supports the existing command
  adapter. Numeric symbols resolve through the same supported enum-name registry;
  unsupported creation values fail synchronously before owner mutation.
- `insert_chart(type, ChartData)` is synchronous and returns a live graphic-frame
  handle immediately. Chart XML, relationships and original workbook members are
  prepared and validated synchronously. Embedded workbook ZIP encoding is deferred
  to asynchronous save or a package-backed picture operation. Multiple pending
  workbooks reserve distinct part names and flush through the existing bounded
  archive writer; no background I/O runs at insertion time.
- Picture insertion uses an isolated serialized package snapshot. Revision
  mismatches reject concurrent mutation with `stale-selection` before new picture
  state is installed. Save applies the same guard during deferred workbook
  encoding. Failed chart input validation leaves all package changes and the
  original placeholder intact.
- Private ECMAScript fields retain callbacks, owner state and backing collections.
  A module-private weak identity association admits live connector/group targets;
  matching shape IDs from a different slide do not confer ownership.
- A graphic frame exposes a typed Chart handle with `chart_type`, `chart_style`,
  `has_legend`, and bounded `element`. The remaining chart graph is not claimed
  complete. Picture media metadata, full slide/layout/master returned interfaces,
  full shape collection surface, and inherited public members outside the tested
  existing Shape/Connector/Table implementations remain inventory obligations.
- Internal owner-binding helpers are implementation functions; source public types
  beginning with underscores remain public-API obligations in the audit inventory.
  No unsupported source public API was removed from that inventory.

## Original verification

The initial tests failed before slide-model existed. Independent follow-up tests
then demonstrated missing foreign-owner group checks, live connector binding,
row-dependent table height, ancestor bound updates, and rotation preservation
before the corresponding fixes. All cases are original and operate on small XML
or in-memory archives. Persistence tests use memfs. No downloaded document,
fixture file, native runtime, or network request participates.

Focused validation: 22 passing tests across `slide-model.test.ts`,
`slide-rich-model.test.ts`, and `slide-owner-regressions.test.ts`; package
TypeScript validation is rerun with the final synchronous chart integration. Maintained workspace
lint passed earlier in the implementation and is rerun by the root agent before
committing. The independent regression file is owned by the connector reviewer.

The synchronous chart follow-up first reproduced Promise return values in three
original immediate-handle tests. Final cases cover two pending workbooks,
save/reopen, save revision conflicts, pending-chart flush before picture insertion,
and synchronous rejection of invalid chart data without package mutation.
