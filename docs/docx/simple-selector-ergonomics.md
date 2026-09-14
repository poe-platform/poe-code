# DOCX simple-selector evidence

Verified on 2026-09-14. The admitted-document selector layer is implemented.
End-to-end feature edit acceptance remains pending with the feature editors;
this receipt does not mark the complete pipeline task or whole SDK implemented.

## Public boundary

`resolveDocxSelection(document, invocation)` accepts `DocumentLocations` returned
by `openDocumentLocations` and the common `DocxInvocation`. CLI argv is parsed by
`parseDocxArguments`; SDK requests use the same operation validation. The helper
resolves paragraph, run, table, logical cell, image and header/footer targets.
The existing injected `createDocxCommandEngine` handler can consume exactly the
same results, as exercised by the original command-engine acceptance case.
No separate CLI editor or ambient filesystem/network authority is introduced.

One-based positions are relative to the selected scope and owner. Sections
restrict body positions and resolve inherited header/footer references. Section
breaks inside structured body containers are counted in document order. Merged
cell slots resolve to their anchor. Descendant paragraph/image indexes are local
to the resolved cell/paragraph. Returned positions preserve the requested section
and local ordinal; token identity remains revision-bound.

Fresh tokens remain accepted for compatible resources and insertion anchors.
Stale tokens fail; whole-resource operations reject text ranges. Scalar table
text requires a cell. Unknown/unimplemented resource selectors fail explicitly.
DOCX has no slide selector or shape-label lookup in its normative selector
contract; its future shape selector is an ordinal. No PPTX surface was changed.

Images resolve to one occurrence by default. Explicit `shared` enumerates all
occurrences referencing the same internal media part, including other stories.
It does not itself replace bytes or clone relationships. Shared header/footer
resource edits require explicit intent. Text replacement receives owner locations;
first/all/occurrence apply to actual ranges after matching. Shared-story mutation
checks therefore remain at actual matched-range mutation, rather than rejecting
an unrelated shared header while merely enumerating text owners.

## Exact language and security mapping

Admission is async; selection of admitted data is synchronous. Common operation
options retain camelCase; no model snake_case member is renamed. Location-query
`section` and `variant` are optional typed fields. `sharedImages(token)` is an
engine resource query. These helpers do not change model sequence indexing:
model zero-based lookup and command one-based positions remain distinct.

Selections are frozen arrays of immutable token/position values, not XML handles
or authority-bearing references. Logical coordinates are uppercase one-based
ASCII labels. Ranges retain Unicode scalar offsets. Accessor-backed invocation
objects fail before property access; request validation owns nested input values.
Source descriptors carry explicit capability inputs and are not opened by the
selector. All source bytes remain under the original admitted-document budget.
No clock, author, font, native runtime or network is discovered.

`InvalidValueError` / common usage errors retain code `usage`;
`SelectionError` retains `missing-selection`, `stale-selection` and
`ambiguous-selection`, with candidate tokens where available. Unsupported
selector families use the existing `UnsupportedEditError`. Full command success
and semantic-error rendering remains the later help/output execution layer.

## Original evidence

24 original memfs cases in `packages/docx/src/simple-selection.test.ts` cover:

- Paired SDK/CLI nested table, merged-cell, paragraph and image selectors.
- Section scoping, inherited headers, nested section breaks and local positions.
- Fresh/stale/wrong-kind tokens, insertion anchors and whole-resource range errors.
- Explicit shared image expansion across story owners and shared-header guards.
- First/all/occurrence on ranges, empty reads, missing targets and ambiguity.
- Command-engine handoff with Unicode, spaces and a leading-dash input after `--`.
- Publication-intent validation and dry-run binary/JSON behavior without writes.
- Accessor-backed SDK requests rejected without executing getters.

The retained publication suite separately verifies actual force, alias, stale
input, in-place and atomic publication semantics. No new claim of complete
paragraph editing, literal replacement or image replacement follows from
selector receipts or injected-handler tests.

Final maintained checks all exited 0:

- `npm test --workspace=docx`: 711 tests, 24 files, no skips.
- `npm run lint --workspace=docx`: ESLint and source/test TypeScript.
- `npm run build:workspaces -- --workspace=docx`: office-package, safe-fs, docx.
- `git diff --check`.

The actual command engine's missing-selection, invalid-coordinate and force
usage errors were rendered with the maintained terminal-png renderer and visually
inspected at `/tmp/docx-simple-selector-errors.png`. All three retained exit 2;
text was legible. This is disposable error-presentation evidence, not document
rendering or product end-to-end editing QA. No screenshot tests were introduced.

## Research and status reconciliation

Read both audits and parsed both upstream inventories: 920 API records, 1,609
unit cases and 650 expanded BDD cases. Their historical execution and mapping
statuses are preserved. The existing reconciliation's documented neutral names,
23 documentation decisions, inherited/underscore-prefixed public members,
enums, helpers and untested APIs remain obligations. No inventory member was
hidden, reclassified as private or promoted to implemented by these tests.

The audits' model-not-implemented language remains accurate for the model;
existing grammar, package primitives and this selector layer have independent
implementation evidence. This distinction resolves status wording without
claiming whole-public-API coverage. No README edits, external corpus acquisition,
reference-runtime use, fixture cleanup or remote delivery occurred in this task.
