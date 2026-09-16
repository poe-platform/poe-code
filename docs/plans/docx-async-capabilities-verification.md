# DOCX async capability verification

Date: 2026-09-15. Task: `sdk-async-capabilities` verification only.
Branch: main. Local corrections only; no push or release.

## Ownership

Own only `packages/docx/src/image-model-input.ts`, the original
`packages/docx/src/model-context-consistency.test.ts`, this record and
`docs/docx/async-capabilities-verification.md`. The existing pipeline plan,
equation records, discovery-failure plan and output directories are unrelated.
The initial index was empty. Do not stage or modify unrelated work.

Root AGENTS.md applies; no additional scoped AGENTS.md exists under the docx
package or docs. Read the docx and shared Office CLI/SDK specifications, API/test
audits and inventories. Preserve all historical denominators and dispositions.

## Agent QA procedure

1. Inspect current live types, emitted exports and prior red/green logs before
   deciding whether a correction is justified. Do not repeat the implementation
   task or create a substitute Document editor.
2. Reproduce a newly detected inconsistency in an original small memfs test
   before editing product code. Assert Promise return, typed rejection and input
   preservation for style and both image factory entry points.
3. Remove only the image admission's null-to-default override. Let shared context
   validation supply defaults for undefined and reject explicit null.
4. Run focused original and adjacent cases, maintained docx unit/lint routes and
   the selected maintained workspace build closure. Inspect a saved/reopened
   memfs document through emitted public exports. Inspect retained logs and
   distinguish missing whole-surface/renderer evidence from passing cases.
5. Record actual checks and gaps in the owned evidence. Check the diff/index,
   stage only the four owned paths and make one atomic Conventional Commit with
   hooks enabled. Report its local hash; do not push or release.

## Finding and scope boundary

The first new test had an invalid memfs setup: Uint8Array in `Volume.fromJSON`
became a directory. That harness failure is not product-defect evidence. With
the fixture corrected to Buffer, the style case passed and both image cases
failed because null context resolved to an Image instead of rejecting. The
corrected test ran red before the one-line product correction.

All three factory cases now reject explicit null asynchronously. Omitted and
undefined context defaults remain covered by the existing admission cases.
The full public document surface is still absent, so this verification must not
mark the task complete or change the unrelated pipeline's implementation status.
Detailed check results and acceptance gaps belong to the companion evidence.
