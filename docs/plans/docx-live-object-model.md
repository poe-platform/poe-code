# DOCX live object model task

Scope: `sdk-live-object-model` only, on main. Later collections/values,
async-capability and case-adaptation tasks remain pending. This task remains open.

## Owned atomic improvement

Owned paths: `packages/docx/src/styles-model.ts`,
`packages/docx/src/live-formatting-owner.test.ts`, this plan and
`docs/docx/live-formatting-owner.md`. Preserve all other work; no README edits,
reference runtime, network acquisition, disposable-input cleanup, push or release.

The existing style model caches owner metadata in retained formatting views.
Its invalidated handles must instead reject metadata and equality access after
style deletion, including when a same-name style is subsequently added.
Extend the existing live owner binding, without a second editing engine.

## Agent QA procedure

1. Run the original in-memory retained-view test before implementation. Confirm
   it fails because `part` remains accessible after owner deletion.
2. Bind part and identity to live style validity. Check Font, ColorFormat,
   ParagraphFormat and TabStops before deletion, after deletion and after adding
   a replacement. The fixture uses the existing original template factory;
   no filesystem writes or external assets are involved.
3. Run the focused regression, maintained docx unit route and docx lint route.
   Record actual outcomes in the evidence file. This changes no CLI rendering;
   CLI screenshots are inapplicable to this owner-binding correction.
4. Stage only the four owned paths after checks pass. Commit the atomic
   improvement using Conventional Commits, without hook bypass or coauthor.

## Execution

The new regression failed before code at retained `view.part`, then passed after
live metadata binding. The complete object graph is not implemented by this fix.
Document, paragraph/run, table, section/story, comment and general package owner
surfaces remain pending; do not promote whole API coverage or task completion.

Final owned correction verification: clean maintained package tests passed
(179 files, 3,439 passed, four skipped); package lint and both TypeScript checks
passed. The focused adjacent run passed 46 tests. No task status was promoted.
