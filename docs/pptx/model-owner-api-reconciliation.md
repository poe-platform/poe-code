# Layout and run-owner public register follow-up

This receipt adds 11 bounded rows to the central register after executing the
other workers' original tests: nine layout/slide rows and two run-hyperlink rows.
The whole denominator remains 2,409 inventory records / 2,426 target rows. The
current partition is **749 bounded SDK receipt rows, 8 confirmed unsupported
rows, 1,669 not currently reconciled rows**. The two historical absent labels for
`Presentation.slide_layouts` and `Slides.add_slide` are superseded. Other absent
master/notes/layout-association rows remain unchanged.

Exact layout additions are `Presentation.slide_layouts`, `Slides.add_slide`,
`SlideLayout.name`, `SlideLayout.part`, and `SlideLayouts.__getitem__`, `__iter__`,
`__len__`, `get_by_name`, `index`. Their neutral JS declarations preserve direct
properties, synchronous insertion, zero-based numeric lookup, explicit negative
`.at`, typed nullable fallback and first-master ordering. Original tests directly
assert those behaviors, including null label removal, same-package ownership,
stable prior handles and pending workbooks across insertion.

The executed `slides add --layout NAME_OR_PART --output PATH` route uses the same
admitted-state insertion and matches generated parts/payloads. Other layout
counterparts (`layouts list`, `layouts set --part URI --name TEXT --scope layouts`)
are identified as registered counterparts, not certified full equivalence in this
receipt. The model scopes layouts to the first master; command records include
owning masters. JS reference equality/fallback semantics are not invented CLI
batch routes. Null model label assignment removes the attribute; empty CLI text
only establishes the same visible label, not identical XML absence.

The two text source IDs remain `pptx.text.text._Run.hyperlink` and
`pptx.text.text._Hyperlink.address`; underscore-prefixed source identities stay in
the public denominator. Actual target spellings are `Run.hyperlink` and
`Hyperlink.address`. The getter returns the existing
`Hyperlink<{ readonly part: string }>` and lazily creates run properties when
necessary; CLI reads remain noncreating. Address reads/URL writes/null removal
share the existing relationship editor with executed memfs
`links set --slide N --shape NAME --path JSON --url URL --in-place --json`.

Only ordinary live slide-shape and placeholder text owners are wired by that
implementation. The original tests exercise ordinary shapes, stable cached
links, subsequent paragraphs/slides, shared relationships, active-URL rejection,
detached rejection and invalidated runs. Table-cell/chart-title/notes owners
remain unsupported. `Hyperlink.part` retains its existing XML type and is not
promoted to `PartView`. No complete source Hyperlink graph or per-owner universal
coverage is implied.

Validation: `slide-layout-model.test.ts` (7 tests) and
`run-hyperlink-owner.test.ts` (5 tests) passed together, **12 total**. The worker
receipts [layout evidence](slide-layout-model-evidence.md) and
[run owner evidence](run-hyperlink-owner-evidence.md) retain implementation and
security details. Full-member closure remains false: passing a bounded returned
object does not establish every inherited method, language edge or CLI route.

Final integration-owner report: maintained package tests passed 6,871 cases;
package lint and selected workspace build passed; an additional final focused
run passed 16 cases and safe-bash integration passed 239. These execution counts
are not combined into a distinct-case count or a public API coverage ratio.
