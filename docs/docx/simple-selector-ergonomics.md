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

## Verification of the selector task, 2026-09-14

Reviewed baseline `8ac6a4d32` on main. The prior plan records missing-resolver
and boundary-case red/green history, but does not link raw red logs. This review
inspected those descriptions, the committed original tests and actual fresh
maintained outputs; it does not claim to have replayed each historical red run.
The fresh baseline passed 711 tests in 24 files, plus DOCX lint and the selected
build closure.

One task-owned defect was reproduced and corrected. DOCX specification section
6.5 permits `headers set` / `footers set` with `--section 2
--link-to-previous false`, alone or with text. The resolver incorrectly rejected
this explicit local intent when the story had two section references.

Red command:

```sh
npm test --workspace=docx -- --run packages/docx/src/simple-selection.test.ts -t 'explicit section-local unlink'
```

Before the production change, both original memfs cases failed at the shared
guard in simple-selection.ts with `SelectionError`, code `ambiguous-selection`;
711 unrelated cases were filtered out, not passed. The correction permits
explicit unlink intent only with a selected section. A token identifying the
shared part alone still cannot choose which section to unlink. Tests compare
CLI flags and typed SDK requests, verify section 2 and both existing references,
and confirm selection leaves the source snapshot unchanged.

Final maintained checks after the correction:

| Check | Actual result |
| --- | --- |
| `npm test --workspace=docx` | Exit 0; 713 passes, 24 files, zero skips; 16.16 seconds |
| `npm run lint --workspace=docx` | Exit 0; ESLint, source and test TypeScript |
| `npm run build:workspaces -- --workspace=docx` | Exit 0; declared office-package, safe-fs and docx closure |
| `git diff --check` | Exit 0 |

The build's safe-fs asset stage reported `targets: []`; no native document
runtime was executed. The retained `/tmp/docx-simple-selector-errors.png` was
opened and inspected: three legible usage errors, each showing exit 2. This is
historical error presentation, not a fresh screenshot of edited documents or a
new successful routine-edit workflow. No presentation code changed here.

Acceptance remains partial. Scope/local ordinals, logical merged-cell anchors,
fresh/stale tokens, resource ambiguity, explicit shared image expansion and
first/all/occurrence selection primitives have executed original coverage.
Force, alias, atomic publication and dry-run have separate maintained memfs
coverage. However, `createDocxCommandEngine` still hands execution to an injected
handler; the paired selector cases do not perform real paragraph/table/image
edits, match-and-replace text, or header/footer clone/rebind publication. The
complete routine-edit acceptance, full success/error rendering, generated
help/capabilities, publisher-document QA and whole public model remain pending.
No absent API was reclassified as private or promoted by this verification.

Both required JSON inventories were parsed again: 920 API objects, 23
documentation resolutions, 1,609 unit variants and 650 BDD cases. Their retained
language/security decisions and historical research status remain unchanged.
No research/runtime rerun, network acquisition, corpus deletion, README edit,
push or release was performed.
