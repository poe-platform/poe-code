# Original guide workflows: current evidence

This receipt adds executable original workflows; it does **not** close whole
public-API or guide parity. The denominator remains **15 topics, 83 heading rows,
and 74 snippet rows** in `workflow-example-accounting.json`. The accompanying
`guide-workflow-closure-current.json` retains every one of those 157 IDs and its
source span, then records the narrower current evidence and outstanding work.
All 2,700 unit and 973 BDD inventory cases remain separate obligations.

## Executed evidence

`packages/pptx/src/guide-workflows-original.test.ts` imports only the package's
public index for product behavior. Eleven cases cover original byte/stream
loading, saving and memory publication; named layout authoring and live slide insertion; title and
sparse body placeholders; nested paragraphs; textbox/font/text extraction;
preset geometry, units, fill/line and adjustments; table grid/merge/split/report
recipes; category column/line/pie and XY/bubble chart owner insertion; picture insertion
and all three rich placeholder insertions; live run hyperlinks; SDK-backed create/text replace/table
merge/notes commands with memfs publication; schema and capabilities.

The tests use original names, values, and a locally authored 62-byte inert BMP.
They neither query a model nor read host files, resolve fonts, contact URLs, spawn
native processes, use a reference runtime, or retain publisher binary fixtures.
The timed focused run passed 11 workflow cases and four independent font
regressions in under one second of test execution. This is structural behavior
evidence, not visual renderer QA.

## Namespace defect and TDD

`font-fill-namespace.test.ts` isolates four variants: solid, background, gradient,
and patterned font fill after run text/bold/size assignment. All four failed with
`invalid-value` from `XmlPart.spliceChildren` before the fix. The structured
run-property edit leaves an inherited default namespace. The XML mutation
contract requires inserted standalone fragments to define their default binding
when the destination has one, even when their element names are prefixed. The
four FillFormat fragment constructors now carry the escaped owner's default
binding. This preserves the namespace context without loosening XML admission.
The four cases then passed, including save/reopen and retained fill type.

## Exact mappings and remaining gaps

- Factories, input admission, picture insertion and save are awaited. Ordinary
  property edits, table insertion and rich chart-placeholder insertion remain
  synchronous. Constructors use `new`; null denotes inheritance. Model names
  remain neutral snake_case. CLI operation JSON and flags follow the shared
  operation contract.
- Source file paths/file-like objects become explicitly supplied bytes,
  `ByteSource.read(maxBytes)` and `ByteSink`/publication capabilities. The source
  default-template/layout ordinals become an original named layout constructed
  through `addLayout`, then selected with live `Presentation.slide_layouts` and
  passed to synchronous `Slides.add_slide`. The arbitrary source-template ordinals
  remain intentionally different from the original named layout.
- Length arithmetic uses `.emu`/`.inches` and `new Inches`/`new Pt`, with safe integer
  admission and the documented rounding mapping. JS arrays/iteration represent
  sequences; placeholder keys stay sparse and zero-based. Command slide/table/cell
  positions are one-based. Original text replaces source prose and identifiers.
- Whole-table coordinate reports traverse rows/cells with explicit zero-based
  indices. The guide's `cell.row_idx`/`col_idx` snippet is documentation drift;
  those names are not silently added as model promises. Merge preserves row-major
  paragraph migration and split does not move content back.
- Category/XY/bubble builders feed synchronous `SlideShapes.add_chart`; returned
  graphic frames expose live chart graphs and save flushes embedded workbook data.
  The original LINE case sets series smoothing. Exact multiple-series and all
  per-guide formatting combinations are still only partially exercised here.
- `Run.hyperlink.address` now executes on returned live slide text runs. The
  independent `run-hyperlink-owner.test.ts` pairs this with the existing `links set`
  command. No URL was fetched. Table-cell/chart-title/notes run owners remain
  explicitly outside this new capability; whole returned-Run coverage is partial.
- **Presentation master properties and live notes owner/placeholder graphs remain
  absent.** Layout collections and live slide insertion now have executable owner
  evidence. Explicit notes operations demonstrate a supported subset; notes
  noncreating inspection and rich notes formatting need separate exact evidence.
- Installing the source runtime, licensing text, navigation headings and general
  use-case prose are contextual review dispositions, never passing behavior tests.
  Introductory stale claims that notes or connectors are unsupported do not
  override the reconciled API/source contract. UI-specific double-delete and
  visual inheritance descriptions are not proven by these structural tests.

## CLI evidence boundary

This new suite executes `create`, `inspect`, `text replace --find ... --with ...
--all`, `tables add`, `tables merge`, `notes add --text`, `schema tables merge`, and
`capabilities` through the exported command engine with explicit memory I/O.
It verifies edited bytes using the model SDK and `readNotes`.
The ledger separately lists existing command-test candidates for images,
placeholder replacement, chart editing, text formatting, drawing and layouts.
Those links are not a claim that this new suite executed every corresponding
source snippet, nor that each missing owner member acquired a CLI route.

Maintained verification: root records the final package-wide check outcome after
all concurrent owned changes have settled. Local-only commits and no push/release
are the delivery contract for this task.
