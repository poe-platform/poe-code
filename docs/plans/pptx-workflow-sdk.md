# Table workflow SDK verification

Scope: all 34 expanded table/cell/column scenarios in the pinned research inventory,
with original text and memory-only XML. This bounded receipt does not establish
all 973 workflows or whole-public-API parity.

- [x] Read the shared SDK/CLI contracts, format spec, upstream audits and inventories.
- [x] Inspect the original scenario boundaries and author independent XML fixtures.
- [x] Assert six style switches, collections, cell equality/roles, merging/splitting,
      text, margins, anchors and 1.5-inch column sizing through public exports.
- [x] Execute `npx vitest run packages/pptx/src/table-workflows.test.ts`: 22 pass.
- [x] Preserve exact inventory pointers in `docs/pptx/workflow-coverage-tables.json`.
- [ ] Renderer QA: not run in this task. No visual-fidelity pass is claimed.

For future disposable QA, select a presentation using `docs/pptx/corpus-manifest.json`,
copy it only to the owned ignored QA cache, apply the relevant table changes, and
inspect original/changed slides with an independent renderer. Inspect all six table
style regions, 1.5-inch column width, 2x3 merged area, split cell boundaries, margins
and vertical anchors. Record the actual renderer/version and pass/fail evidence in
this plan. Reduce meaningful failures to original small memory regressions before
fixing them. Do not ship downloaded fixtures or execute the whole pipeline.

The expanded focused run passes 23 tests (197ms), adding actual solid RGB fill
mutation and a full package round trip: createPresentation → addTable → Presentation
live table edits → memfs save → independent slide XML assertions → reopened model.
The package lint route passed before this addition; rerun below validates final files.

The neutral `Slides.add_slide` and `SlideShapes.add_table` methods are absent from
`packages/pptx/src/slide-model.ts`. The byte-operation workflow is a supported
alternative, not a passing assertion for those missing public model members. Full
model guide parity remains blocked on their implementation.
