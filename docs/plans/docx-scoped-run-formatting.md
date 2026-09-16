# Scoped run formatting

Task: run formatting only. Later paragraph/style/model/batch tasks remain pending.
The pre-existing edits to `docx-typescript-safe-bash.md` are not owned by this task;
this separate plan records its implementation and verification.

## Contract and ownership

Read the root and safe-bash instructions, DOCX specification, shared Office CLI
and SDK contracts, and the API audit/inventory. Product edits are confined to
`packages/docx`; existing root exports and safe-bash adapters already forward the
engine. No README changes, downloads, native reference runtime or product network
or ambient filesystem access. Test mutations use memfs.

The public operation is `runs set` / `runs.set`, with an always-async
`formatDocumentRuns(bytes, options, context)` SDK entry point. All options use the
same validation, selectors, limits, error categories and publication path.
Formatting is independent of whole-run text assignment. The latter, live model
objects, model batches, style resolution and later task families stay pending.

## Language and security mappings

- Omitted or undefined options retain direct properties. Null removes only the
  selected direct property or attribute. Boolean false writes an explicit off
  value; underline false writes `none`; baseline false writes `baseline`.
- Underline/highlight/theme enums use closed `{enum,name}` data in JS and neutral
  symbols on the CLI. INHERITED and NOT_THEME_COLOR sentinels are not setters;
  use null. Highlight AUTO writes `none`. No runtime enum constructor or native
  font resolver is introduced.
- Lengths use the shared explicit units and integer EMU conversion followed by
  nearest half-point rounding. This editor admits 1–3276 half-points as its
  bounded size profile; it does not assert that limit is universal OOXML validity.
- `font` updates ascii/hAnsi only. Individual Latin, East Asian, complex-script
  and theme slots are independent. Existing theme references remain unless
  explicitly removed; theme precedence is not flattened. Language changes `val`
  only; bidi/eastAsia metadata survives. No font loading, installation or shaping.
- RGB assignment clears theme transforms; theme assignment preserves fallback
  RGB and transforms. Null theme removes its reference/transforms while retaining
  fallback RGB. This utility attribute patch is not a claim that the planned
  model `ColorFormat.theme_color` setter is implemented.
- Baseline/superscript/subscript share one direct `vertAlign`; false explicitly
  writes baseline and null removes it. This direct-operation mapping is recorded
  separately from the planned neutral model `Font.superscript`/`subscript` APIs.
- Input locations remain fingerprinted scalar ranges, never UTF-16 offsets or
  XPath. After receipts use paragraph-relative scalar ranges in generation one.
  Reopened published bytes acquire their own fingerprint as before.
- Protected/signed/opaque/shared/revision admission and publication safeguards
  are retained. Unknown uneditable content is rejected when affected, not erased.
  Plain text/control runs can split; comments/opaque payload in a partial run
  prevent splitting. No arbitrary JS invocation or external resource retrieval.

Research remains in [the API audit](../docx/upstream-api-audit.md),
[inventory](../docx/upstream-api-inventory.json) and
[reconciliation](../docx/upstream-api-reconciliation.md). The documented Font
re-export uses its reconciled canonical identity. The D18 color finding does not
justify inventing a brightness setter. Inherited and underscore-prefixed public
types remain in the planned model coverage; no inventory row is hidden/promoted.
The historical command-coverage register is a proposed baseline, not current
runtime evidence; the additive options and null resets are specified in docx.md
and current generated schema.

## Red/green evidence

Before product code, 17 new original formatting cases failed because the public
entry point was absent. Existing package tests passed in that baseline run.
Separate CLI execution and discovery tests then failed on the pending dispatcher
and schema. Subsequent original regressions reproduced reverse property insertion
order and merging into an unselected run (which could discard an inline comment).
Both were fixed. A field-range probe instead confirmed the existing range guard;
the final case asserts that guard and forged-token rejection without changing it.
One original fixture needed an explicit authored style definition to be valid;
its correction retained the style-inheritance preservation assertion.

## Manual QA steps

1. Build the maintained docx workspace closure. Load the built docx engine and
   existing explicit safe-bash plugin with a fresh in-memory filesystem.
2. Create an original Unicode document; format one selected run through shell
   flags, confirm exact extracted text, direct properties and emitted XML.
3. Exercise dry-run JSON, binary stdout, output conflict, force, in-place,
   invalid size, null reset and a Unicode scalar range. Compare CLI/SDK results.
4. Capture human help, successful summary and usage diagnostic. Render the actual
   transcript through the maintained terminal screenshot renderer and inspect it.
   Keep QA files outside Git; they are not canonical tests or product inputs.
5. Run docx tests/lint, the selected maintained build closure, portable root export
   tests and the existing focused safe-bash registration checks. Review owned diff
   and commit only explicit owned paths on main, without pushing or releasing.

## Verification

Completed on 2026-09-14:

- `npm run test --workspace=docx`: 879/879 tests in 37 files; 28 additive
  formatting/property/CLI cases. Original test names remain; three exact discovery
  inventories were extended for the implemented path and feature.
- `npm run lint --workspace=docx`: ESLint and production/test TypeScript passed.
- `npm run build:workspaces -- --workspace=docx`: all five declared build tasks
  and applicable lifecycle checks passed, uncached.
- `npx vitest run scripts/docx-exports.test.ts`: 2/2, including the portable
  dependency closure. Existing exports/adapters required no source edits.
- Existing safe-bash `node scripts/test-reporting.mjs --import tsx
  tests/commands/docx-registration.test.ts`: 10/10, no skips.
- Eleven manual Shell calls using built docx and the existing explicit plugin
  passed: creation, formatting, readback, output conflict, force, in-place/null,
  JSON parity, scalar range, invalid size, binary stdout and help. Input bytes
  remained exact and public SDK data equaled CLI JSON data.
- Inspected `/tmp/docx-run-formatting-20260914-wrapped.png`, generated with
  `npm run screenshot` and the shared terminal renderer from the actual Shell
  transcript wrapped to 96 columns. Human help/summary/error are readable.
  The renderer lacks the sample emoji/CJK glyphs; exact Unicode bytes were
  independently asserted by unit and shell checks. This is terminal QA, not
  document rendering. The initial wide capture remains alongside the wrapped
  capture as disposable evidence; neither is staged.
- Additional receipt regressions cover all runs consumed by a merge and the
  exact zero-length paragraph position of an empty formatted run.
- `git diff --check`: passed. No push or release is authorized or performed.

The single owned commit contains this atomic formatting feature, tests, schema,
contract clarifications and evidence. Later task status stays pending.

## Verification review and comment-preservation correction

Reviewed the implemented task at `5fc4014ec` on 2026-09-14 without replaying
implementation. The original tests cover direct values/removal, exact scalar
ranges, style and complex-script retention, equivalent selected-run merging,
unit/enum validation, discovery and CLI/SDK parity. The API inventory and its
language/security reconciliation still describe planned live model members;
this review does not promote those rows or hide underscore-prefixed interfaces.

One new defect was reproduced through the public SDK with an original memfs
regression: formatting scalar range `[1,4)` in `co<!--retain note-->ast`
published a changed archive instead of rejecting an unsupported partial edit.
The split path reconstructed text and discarded the XML comment. The correction
rejects non-text children in split run content, leaving whole-run and unchanged
formatting paths intact. Property-container comments remain preserved as before.

The first regression attempt omitted explicit archive encoding and failed with
`usage`; that was fixture setup evidence, not the product defect. After adding
the same explicit encoding as the existing helper, the pre-fix test failed with
`promise resolved` and a published 2,704-byte archive. No product edit preceded
that reproduction. The final test requires `unsupported-edit` and an unchanged
memfs output sink.

Fresh maintained checks after the correction:

- `npm run test --workspace=docx`: 880/880 tests, 37/37 files, no skips.
- `npm run lint --workspace=docx`: ESLint and production/test TypeScript passed.
- `npm run build:workspaces -- --workspace=docx`: five declared dependency-closure
  build tasks and applicable lifecycle checks passed.
- `npx vitest run scripts/docx-exports.test.ts`: 2/2 portable export checks.
- Existing safe-bash registration route above: 10/10, no skips. It proves generic
  plugin integration; it is not a formatting-specific Shell acceptance suite.
- Fresh CLI engine QA with original data and memfs confirmed the corrected range
  returns exit 1, makes zero stdout writes, and retains input bytes and the
  pre-existing output sink. Exact stderr: `docx: Document operation failed:
  unsupported-edit`. The maintained `npm run screenshot` renderer captured
  `/tmp/docx-comment-review-20260914.png`; visual inspection confirmed a readable
  diagnostic. This is CLI engine/terminal evidence, not a fresh Shell invocation
  or rendered DOCX page. The disposable QA script and image are not staged.
- `git diff --check`: passed. Only the engine guard, original test-file addition
  and this plan update belong to the atomic correction; no push or release.

Historical evidence was preserved. The existing transcript and wrapped terminal
screenshot were inspected; the visible four calls support success, text readback,
invalid-size output and help. The earlier eleven-call QA and red/green claims
remain historical summaries: standalone raw assertions/logs were not found in
the task-named temporary artifacts inspected. No fresh document rendering,
downloaded-corpus QA, native reference build or whole-model API pass is claimed.
Unrelated plan edits and index entries remain outside this correction.
