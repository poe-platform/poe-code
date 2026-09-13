# Slide insertion behavior audit

Status: Research accounting with original operation evidence reported passing by the domain owner; whole source-row/model parity remains unclaimed.

## Ownership and evidence

This audit owns only this plan and `docs/pptx/slide-insertion-case-accounting.json`.
Package implementation and adapter tests have separate owners. Root `AGENTS.md`
applies; there are no scoped `AGENTS.md` files under `docs` in this checkout.
Do not execute the full pipeline, edit READMEs, push or release in this task.

The pinned source is `278b47b1dedd5b46ee84c286e77cdfb0bf4594be`, available for
read-only research in `/tmp/pptx-upstream-review`. The upstream test/API audits,
inventories, `test-case-map.json`, `api-language-mappings.md` and
`api-reconciliation.md` supply source identities and exact parameter evidence.
The standalone `docs/pptx/slide-insertion-notice.txt` retains the MIT notice.
Source identities and exact evidence remain research only. New tests must use
original names, in-memory assets and independent assertions.

The supplemental ledger retains 317 individual unit variants, 88 expanded BDD
rows and 426 API records. It is a relevance superset: adjacent owner operations,
notes and rich placeholders remain visible pending obligations. Every entry
points to its canonical exact contract, with selected parameter bindings retained
where the canonical ledger provides them. No rows are merged and no copied mock
call structure is treated as required TypeScript architecture. Canonical coverage
counts and statuses are unchanged.

## Direct scope and current evidence

Of the relevance superset, **44 unit rows and one BDD row** directly exercise
slide insertion, slide/shape identity allocation, placeholder construction and
cloning, part creation/naming, or the title heuristic. The ledger marks these
`direct-insertion-source-contract`; the remaining 360 case rows and 426 API
records retain adjacent public-model obligations. This denominator deliberately
includes lower-level placeholder construction and allocation contracts whose
exact arrangements cannot all be reached by adding a new empty slide.

The final maintained workspace run passed 690 tests, including 40 original cases in
`packages/pptx/src/slides.test.ts`. Exact test titles appear on the individually mapped ledger
rows as operation evidence, usually partial. In particular, the empty-deck test
independently asserts the source empty-list allocator result 256. Boundary tests
assert slide-list order/IDs, untouched existing drawings and a layout relationship;
sparse-placeholder tests assert custom indices, newly allocated drawing IDs,
absence of copied geometry and unchanged layout bytes. The root integrator executed the final maintained checks; the receipt in the
implementation plan is authoritative.
No operation result is claimed to implement a live returned Slide, collection,
property or untested parameter variant.

All eleven source slide-ID arrangements now have original operation evidence:
eight preserve the allocator result and three reject malformed existing IDs.
Vertical chart metadata and text-capable versus rich placeholder construction
have original assertions. Lower-level latent-placeholder construction, generic
existing-owner cloning and four exact cloneability pairs retain their distinct
obligations. The seven construction variants are centered-title/horizontal/
full/idx0, date/horizontal/half/idx10, subtitle/vertical/full/idx1,
table/horizontal/quarter/idx14, slide-number/horizontal/quarter/idx12,
footer/horizontal/quarter/idx11, and object/horizontal/full/idx15. Only centered
title, subtitle and object have text bodies in these source rows. Date, footer
and slide number are filtered out during slide cloning, so their lower-level
creation rows must not be claimed covered by tests asserting that filtering.

Source shape-name cases distinguish content id3, table id4 with an existing
colliding name, vertical table id7 and title id2 with an existing colliding name.
Exact source names remain in the canonical research evidence; original tests can
assert destination-owner uniqueness and semantic orientation without branding.

## Required insertion assertions

- Exercise an empty deck and every gap in a nonempty slide list, including the
  first position, every middle position and append. Reject negative, fractional,
  nonfinite and out-of-range positions before mutation. Keep unaffected slide IDs,
  part names, ordering, content types and relationships unchanged.
- Allocate slide IDs separately from package relationship IDs and drawing IDs.
  Source ID cases are `[] -> 256`, `[42] -> 256`, `[256] -> 257`,
  `[256,712] -> 713`, `[280,257] -> 281`, `[2147483646] -> 2147483647`,
  `[2147483647] -> 256`, `[2147483648] -> 256`, `[256,2147483647] -> 257`,
  `[256,2147483647,257] -> 258`, `[245,2147483647,256] -> 257`.
  Any target rejection of malformed existing IDs must be explicit, retain the
  source row and have original negative evidence; it is not source equivalence.
- Shape allocation is destination-owner local. Source cases are `[] -> 1`,
  `[0] -> 1`, `[1] -> 2`, `[2] -> 3`, `[1,3] -> 4`, `["foo",2] -> 3`,
  `["1fo",2] -> 3`, `[1,1,1,4] -> 5`. Distinguish malformed or duplicate IDs
  within one drawing from valid repeated IDs on different slides. The latter
  must not make insertion or publication fail.
- Resolve the explicitly selected layout/master as owned graph objects. Confirm
  the new slide points to that layout and the layout points to the requested
  master. Reject absent, external, mismatched and ambiguous bindings atomically.
  Preserve a supplied blank layout as blank; do not synthesize title/body shapes.
- Clone eligible layout placeholders in layout order. Exact cloneability source
  pairs are title/body -> both, title/date -> title, footer/object -> object,
  slide-number/footer -> neither. Retain type, sparse idx, orientation and size.
  A source chart example carries idx 42, vertical orientation and half size;
  text-capable versus rich-content placeholders have different XML obligations.
- Populate text using the actual type/index pair. Exercise title and centered
  title, body/content/subtitle as supported, nonstandard sparse indices, multiple
  candidates, duplicate indices, mismatched requested type, and missing matches.
  Omitted body/title text must not replace layout defaults; explicit empty text
  must preserve a required empty paragraph. Rich picture/table/chart placeholders
  cannot silently become ordinary text placeholders.
- Keep inherited defaults inherited. Slide-to-layout matching uses idx;
  layout-to-master matching uses type, including body -> body, table -> body and
  title -> title. Assert direct overrides separately from inherited geometry and
  text styles, and prove the master/layout bytes remain untouched.
- Assert actual serialized OPC/XML with an independent reader as well as public
  SDK results. Test exposed CLI operation through the same domain behavior,
  schema/capabilities, structured output and failed-mutation publication boundary.

## Exact public language/security obligations

J01 retains `slides.add_slide(slide_layout)` as a synchronous neutral model
method returning a live `Slide`; an operation DTO or `slides.add` command is not
that model interface. Format-level positioned insertion is additive. The source
user guide's hypothetical `insert_slide` is not an existing source API promise.
Model positional defaults remain positional, keyword-only parameters alone become
trailing typed options, and operation JSON uses camelCase independently.

J02 requires direct properties and owned live handles, read-only enforcement and
cross-presentation ownership rejection. `Slide.slide_layout`,
`SlideLayout.slide_master`, owner collections and inherited members remain public.
Notes/background accessors with creation side effects require separate evidence;
CLI inspection must not accidentally create them. Rich placeholder replacement
returns the new shape under the same idx and invalidates the former handle.

J03 maps collections to `.length`, iteration and checked zero-based lookup.
`SlidePlaceholders[idx]` is sparse key lookup, ascending-idx iteration, with
`KeyError` on misses; negative keys are not reverse positions. Layout/master
placeholder collections have positional indexing plus their documented idx/type
`get` semantics and fallback. Negative `.at` is supported only where documented;
there is no blanket `.slice` promise. Inherited equality, containment and other
protocols remain obligations, not automatic claims from array output.

J04 retains `PP_PLACEHOLDER` symbols/aliases with bounded XML conversions. The
placeholder guide's chart value 12 is documentation drift: chart is 8, table is 12. The notes guide supplies `SLIDE_IMAGE` 101 / `sldImg`, which is not omitted
because a narrower enum page misses it. J05 uses safe integer EMUs and distinguishes
null inheritance from zero/false/empty text.

J06 requires always-async admission/publication through supplied bytes or VFS
capabilities; paths never grant host authority. In-memory slide/placeholder
creation remains synchronous at the live model layer. J07 requires original
assets/defaults, no host clock metadata, native rendering, font search or network.
J08 requires neutral typed errors and stable codes. CLI validation failures are 1,
schema/usage 2, I/O 3, limits 4 and cancellation 130; successful mutation is 0.
J09 retains bounded owned `element` and `part` views, without unrestricted XPath,
raw host objects or arbitrary XML constructors. `_PlaceholderFormat` and inherited
members declared on private-looking bases are explicitly retained in the ledger.

J10 requires `slides add`, common selectors/flags and the version-1 JSON envelope,
actual schema/capabilities and validated output/dry-run publication. Whole text
assignment is not formatting-preserving `text replace`. Plural `images`, `tables`
and `properties` remain the shared resource spellings when those routes apply.

Source title lookup tests use idx zero, including a placeholder with no explicit
title type. The requested type-aware insertion population must not inherit that
heuristic. Keep the public `SlideShapes.title` obligation separate and record any
intentional divergence rather than claiming those source rows covered by sparse
custom-layout insertion. The documented `follow_master_background` setter is an
additive target obligation because the source defines only its getter.

## Verification and disposable QA procedure

Use fast original memfs unit tests with one exact expected result for every
selected parameter or explicitly recorded security divergence. Compare SDK and
CLI outcomes where exposed; do not count upstream passes, inventory counts,
implementation inspection or documentation as passing target evidence. Add exact
new test references as partial evidence without closing unrelated model rows.

After maintained focused tests/lint/build pass, use an approved fixture entry in
`docs/pptx/corpus-manifest.json` only for disposable QA if needed. Keep its bytes
outside committed files, use a copy, record its manifest identity/checksum, inspect
layout bindings/defaults before and after, and reduce meaningful findings to small
original memfs regressions. Unit tests never depend on these files or downloads.
Any CLI visual change also needs an ad hoc screenshot inspection. This document
is the QA procedure; no automated QA script or whole-pipeline run is authorized.

The integrator records actual maintained commands/results and local atomic commit
hashes separately. No push or release is part of this work.
