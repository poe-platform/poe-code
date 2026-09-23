# Deferred DOCX work and acceptance audit

Deferred by the user's September 23 request: “we can audit later”. This file is a
backlog and historical snapshot, not an executable pipeline. Its tasks are not passes
and must not be automatically scheduled by the bounded implementation pass.

## Open work after the bounded pass

Append at most 8 lines per implementation attempt. Keep each unresolved behavior OPEN,
with its task ID, exact defect, check/result, owned WIP and a concrete next action.
A parked task or completed attempt does not establish product acceptance.

- 2026-09-23 `checkpoint-removal-native-hyphens`: VERIFIED bounded improvement; F44 requirement OPEN. Selected defect: scalar removal skipped native nonbreaking/soft hyphens, deleting trailing text instead.
  Change: count both native hyphens as Unicode scalars in the shared removal editor; original memfs SDK/CLI regressions verify exact text, retained formatting, collapsed result locations and unchanged input.
  Check: `gtimeout --signal=INT --kill-after=10s 180s npm test -- --no-cache --workspace=docx --test-file=packages/docx/src/removal.test.ts` — red: 2 failed/31 passed; sole rerun: exit 0, 33 passed plus 2 automatic posttest passes; no timeout.
  Focused lint: `gtimeout --signal=INT --kill-after=10s 180s npm exec -- eslint packages/docx/src/removal.ts packages/docx/src/removal.test.ts` — exit 0; diff whitespace check passed. No CLI presentation change.
  Duration: approximately 3 minutes total; selected Vitest runs 2.25s / 1.86s. No broad suites, native/render matrices, shared-infrastructure changes or evidence-index rebuilding.
  Local commit: `2f2c31eb94e079f701434d2c85d0ba930d6766ca`; only the two verified DOCX files committed. Owned WIP: this receipt only; unrelated edits preserved, DOCX remains opt-in, no push or publication.
  Remaining: F44 product acceptance and broader removal/sanitization obligations remain OPEN and deferred; no new active task or automatic retry.

- 2026-09-23 `checkpoint-image-mutation`: VERIFIED bounded improvement; F32 requirement OPEN. Selected defect: `images.add` rejected admitted GIF/BMP/TIFF after successful raster characterization.
  Change: remove the redundant PNG/JPEG-only guard; six original memfs SDK/CLI regressions verify saved bytes, MIME/suffix coherence, native dimensions and unchanged inputs. DOCX stays opt-in; unrelated edits preserved.
  Check: `gtimeout --signal=INT --kill-after=10s 180s npm test -- --no-cache --workspace=docx --test-file=packages/docx/src/images.test.ts --test-file=packages/docx/src/images-command.test.ts` — red: 6 failed/39 passed; sole rerun: exit 0, 45 passed plus 2 automatic posttest passes; no timeout.
  Focused lint: same 180s supervisor with `npm exec -- eslint packages/docx/src/image-insertion.ts packages/docx/src/images.test.ts packages/docx/src/images-command.test.ts` — initial require-yield failure; comment-only fixture justification; sole lint rerun exit 0. Diff whitespace check passed.
  Duration: approximately 4 minutes total; selected Vitest runs 2.54s / 2.85s. No full suites, native/render matrices, evidence rebuild or shared-infrastructure work.
  Local commit: `693575e63338005f1421ec7ccb68491534bbacf4`; only the three verified DOCX files committed. Owned WIP: this receipt only in `docs/plans/docx-deferred-audit.md`; no push or publication.
  Remaining: F32 acceptance and floating insertion remain OPEN; floating insertion still explicitly rejects. Any further implementation or qualification requires a separate bounded task; no automatic retry or new active task.

- 2026-09-23 `checkpoint-comments-active-anchors`: PARKED / no-change; F25 requirement OPEN. Selected behavior: reject opaque comment-anchor ownership before allocation through SDK/CLI batches.
  Current dirty main at `4ff4eca9198c246365122aef7ae7bdfc2d752715` already implements preflight; no remaining defect reproduced. No product code changed or existing edits adopted.
  Check: `gtimeout --signal=INT --kill-after=10s 180s npm test -- --no-cache --workspace=docx --test-file=packages/docx/src/comment-anchor-opaque-preflight-sdk-cli-public.test.ts` — exit 0; 512/512 selected tests passed; automatic posttest also passed (2 tests).
  Duration: selected Vitest run 11.77s; complete maintained command approximately 61s; bounded attempt approximately 3 minutes.
  Commit: none (no verified improvement to commit). Owned WIP: this receipt in `docs/plans/docx-deferred-audit.md` only; existing package WIP preserved.
  Remaining: `packages/docx/src/comment-anchor-active-creation-carriers-public.test.ts` inspected but unrun; creation-carrier behavior and broader F25 acceptance remain unverified here. Next action, only in a separately authorized bounded task: validate that existing creation-carrier file within its deadline; no automatic retry or family audit.

- 2026-09-23 `checkpoint-revision-decision-depth`: PARKED / no product change; F26 requirement OPEN. Selected behavior: accept/reject an insertion containing admitted run-property depth (32/8192) through SDK/CLI and batch routes.
  Current dirty main at `4ff4eca9198c246365122aef7ae7bdfc2d752715` already has iterative selected-descendant traversal; existing edits and both original memfs test files preserved without adoption.
  Check: `gtimeout --signal=INT --kill-after=10s 180s npm test -- --no-cache --workspace=docx --test-file=packages/docx/src/revision-decision-selected-native-depth-public.test.ts` — exit 1; 192 source-route cases passed, 192 native-route cases failed, 96 unhandled `write EPIPE` errors; overall verification FAILED.
  Duration: selected Vitest run 159.50s (test callbacks 154.77s); maintained command approximately 180s, exited with failure rather than timeout; bounded attempt approximately 5 minutes; no rerun.
  Commit: none. Owned WIP: this receipt in `docs/plans/docx-deferred-audit.md` only; no product, test, or shared-infrastructure edits.
  Remaining defect: native subprocess routes fail and close stdin; underlying cause is undiagnosed, so native selected-depth behavior remains unverified. Unrun: `packages/docx/src/revision-decision-unrelated-native-depth-public.test.ts`; no separate lint/build route or broader checks.
  Next action, only in a separately authorized bounded task: capture the first native child's stderr/exit cause and distinguish a DOCX defect from test/runtime infrastructure; park any shared-infrastructure fix separately. Broader F26 acceptance remains OPEN; no automatic retry, new active task, push, or publication.

- 2026-09-23 `checkpoint-complex-review-variants`: PARKED; F27 requirement OPEN. Selected defect: accepting an inline insertion inside a table with unresolved `tblGridChange` publishes instead of refusing the affected edit.
  Reproduced with the new original memfs test `refuses an inline revision decision affected by table-grid history without publishing`; SDK returned `changed: true` and published 1,755 bytes. The ancestor structural-property guard in `packages/docx/src/revision-decisions.ts` omits `tblGrid`.
  Change: regression test only; no implementation, shared-infrastructure, opt-in, or unrelated edits changed. Owned WIP: the added single test in `packages/docx/src/review-complex-complete-variants-public.test.ts` and this receipt in `docs/plans/docx-deferred-audit.md`; pre-existing file content is unowned.
  Check: `gtimeout --signal=INT --kill-after=10s 180s npm test -- --no-cache --workspace=docx --test-file=packages/docx/src/review-complex-complete-variants-public.test.ts` — exit 1 on both permitted runs; each had 4,224 existing passes and one new failure, neither timed out.
  First failure exposed an invalid inherited writer setting in the new fixture; the sole rerun corrected it and cleanly reproduced unexpected successful publication. Vitest durations: 96.66s / 102.63s; complete commands approximately 115s / 118s; bounded attempt approximately 6 minutes.
  Commit: none; failing test remains uncommitted. Unrun: the new test's CLI assertions (SDK assertion stops execution), `packages/docx/src/review-native-timestamp-range-public.test.ts`, separate lint/build, screenshots, and broader qualification.
  Next action in a separately authorized task: include table-grid history in the affected-decision guard and verify this regression through SDK/CLI; no implementation added because the one allowed rerun was exhausted. Other variants and family acceptance remain OPEN; no automatic retry, new active task, push, or publication.

- 2026-09-23 `checkpoint-control-scalar-and-picture`: PARKED / no product change; F28 requirement OPEN. Selected behavior: picture-control replacement retains admitted run-property depth (32/8192), geometry, crop, alt text, placeholder definitions, old media and unrelated relationships through SDK/CLI and batch routes.
  Current dirty main at `4ff4eca9198c246365122aef7ae7bdfc2d752715` already implements iterative picture-occurrence traversal; no remaining defect reproduced in the selected behavior. Existing product/test edits preserved without adoption; DOCX remains opt-in.
  Check: `gtimeout --signal=INT --kill-after=10s 180s npm test -- --no-cache --workspace=docx --test-file=packages/docx/src/picture-control-retained-native-depth-public.test.ts` — exit 0; 512/512 source/compiled cases passed; automatic posttest also passed (2 tests); no rerun.
  Duration: selected Vitest run 119.41s (callbacks 115.89s); complete maintained command approximately 150s; bounded attempt approximately 4 minutes.
  Commit: none (no owned product improvement). Owned WIP: this receipt in `docs/plans/docx-deferred-audit.md` only; no implementation, test or shared-infrastructure changes.
  Remaining: scalar trivia retention is unverified here; `packages/docx/src/control-scalar-trivia-original-public.test.ts` and its implementation were inspected but that file was unrun. No separate lint/build, screenshots, native matrices or broader qualification ran.
  Next action, only in a separately authorized bounded task: validate the existing scalar-retention behavior within its deadline and fix only a reproduced defect. Broader F28 acceptance remains OPEN; no automatic retry, new active task, push or publication.

- 2026-09-23 `checkpoint-repeat-native-depth`: PARKED / no product change; F29 requirement OPEN. Selected behavior: admitted nested native table repetition at depths 1/1024/2048 through controls.repeat/template.apply SDK/CLI and batch routes.
  Original memfs check: `gtimeout --signal=INT --kill-after=10s 180s npm test -- --no-cache --workspace=docx --test-file=packages/docx/src/repeat-template-admitted-native-table-depth-public.test.ts` — exit 1; 288/288 failed, 192 unhandled EPIPE errors; no timeout or rerun.
  Diagnosis: the original child's imports alone fail with ERR_MODULE_NOT_FOUND for `node_modules/poe-code/packages/safe-js/dist/safe-fs-core.js`, imported by `packages/safe-bash/dist/core.js`; the same 180s-supervised import-only probe exited 1 in 0.63s. Native repetition behavior is unverified; no DOCX product defect established.
  Duration: selected Vitest run 105.88s (callbacks 103.81s); complete maintained command approximately 119s; bounded attempt approximately 3 minutes.
  Commit: none. Owned WIP: this receipt in `docs/plans/docx-deferred-audit.md` only; existing implementation and both starting test files preserved without adoption. No product, test, shared-infrastructure or opt-in changes.
  Unrun: `packages/docx/src/repeat-template-native-physical-depth-public.test.ts`, separate lint/build, screenshots and broader qualification. No logs created because `/out` is read-only; failed redirection did not start a test.
  Next action, only in a separately authorized task: repair the shared native runtime artifact/dependency resolution outside this DOCX pass, then validate the original admitted-depth file. Shared-infrastructure work and broader F29 acceptance remain deferred; no automatic retry, new active task, push or publication.

- 2026-09-23 `checkpoint-property-native-scalars`: PARKED / no-change; F30 requirement OPEN. Selected behavior: unknown custom variants matching inherited object keys remain opaque, reject typed mutation, and retain their native payloads.
  Current dirty main at `4ff4eca9198c246365122aef7ae7bdfc2d752715` already guards integer-variant lookup with `Object.hasOwn`; no remaining defect reproduced. Existing product/test edits preserved without adoption; DOCX remains opt-in.
  Original memfs check: `gtimeout --signal=INT --kill-after=10s 180s npm test -- --no-cache --workspace=docx --test-file=packages/docx/src/property-inherited-native-variant-public.test.ts` — exit 0; 408/408 source/compiled cases passed; automatic posttest also passed (2 tests); no rerun.
  Duration: selected Vitest run 27.95s (callbacks 21.84s); complete maintained command approximately 75s; bounded attempt approximately 2 minutes.
  Commit: none (no owned product improvement). Owned WIP: this receipt in `docs/plans/docx-deferred-audit.md` only; no implementation, test or shared-infrastructure changes.
  Unrun: `packages/docx/src/property-width-mutation-and-native64-public.test.ts` was inspected; width/native64 behavior, separate lint/build, screenshots and broader qualification were not checked. No logs created because `/out` is read-only; failed directory creation did not start a test.
  Next action, only in a separately authorized bounded task: validate the existing width/native64 behavior within its deadline and fix only a reproduced defect. Broader F30 acceptance remains OPEN; no automatic retry, new active task, push or publication.

- 2026-09-23 `checkpoint-ancillary-xml-boundaries`: PARKED / no-change; F41 requirement OPEN. Selected behavior: raw custom XML replacement admits unbound items, rejects changed bound items/properties/declarations, and retains unchanged bytes through SDK/CLI.
  Current dirty main at `4ff4eca9198c246365122aef7ae7bdfc2d752715` already implements the selected guards; no remaining defect reproduced. Existing implementation and original memfs tests preserved without adoption; DOCX remains opt-in.
  Check: `gtimeout --signal=INT --kill-after=10s 180s npm test -- --no-cache --workspace=docx --test-file=packages/docx/src/raw-custom-xml-boundaries-public.test.ts` — exit 0; 80/80 selected tests passed; automatic posttest also passed (2 tests); no rerun.
  Duration: selected Vitest run 7.47s (callbacks 1.70s); complete maintained command approximately 51s; bounded attempt approximately 2 minutes.
  Commit: none (no owned product improvement). Owned WIP: this receipt in `docs/plans/docx-deferred-audit.md` only; no product, test or shared-infrastructure changes.
  Unrun: `packages/docx/src/binding-signature-resource-ordered-batch-public.test.ts` was inspected; its ordered-batch behavior, separate lint/build, screenshots and broader qualification were not checked.
  Next action, only in a separately authorized bounded task: validate the existing ordered binding/resource behavior and fix only a reproduced defect. Broader F41 acceptance remains OPEN; no automatic retry, new active task, push or publication.

- 2026-09-23 `checkpoint-settings-native-carriers`: PARKED / no product change; F42 requirement OPEN. Selected behavior: native settings boolean whitespace reads preserve supported values, unsupported spellings and original package bytes through SDK/CLI and batch routes.
  Current dirty main at `4ff4eca9198c246365122aef7ae7bdfc2d752715` already implements the selected lexical handling; no remaining defect reproduced. Existing implementation and original memfs tests preserved without adoption; DOCX remains opt-in.
  Check: `gtimeout --signal=INT --kill-after=10s 180s npm test -- --no-cache --workspace=docx --test-file=packages/docx/src/settings-native-boolean-whitespace-public.test.ts` — exit 0; 1,440/1,440 selected tests passed; automatic posttest also passed (2 tests); no rerun.
  Duration: selected Vitest run 26.42s (callbacks 20.77s); complete maintained command approximately 75s; bounded attempt approximately 2 minutes.
  Commit: none (no owned product improvement). Owned WIP: this receipt in `docs/plans/docx-deferred-audit.md` only; no product, test or shared-infrastructure edits.
  Unrun: `packages/docx/src/settings-native-depth-public.test.ts` and its implementation were inspected; native depth behavior, separate lint/build, screenshots and broader qualification were not checked here.
  Next action, only in a separately authorized bounded task: validate existing native-depth behavior within its deadline and fix only a reproduced DOCX defect; park shared-infrastructure findings separately. Broader F42 acceptance remains OPEN; no automatic retry, new active task, push or publication.

- 2026-09-23 `checkpoint-signature-graph-retention`: PARKED / no-change; F43 requirement OPEN. Selected behavior: signature inventories use canonical owner order and each owner's XML relationship order independently of ZIP member order through SDK/CLI and batch routes.
  Current dirty main at `4ff4eca9198c246365122aef7ae7bdfc2d752715` already implements owner sorting; no remaining defect reproduced. Existing implementation and original memfs tests preserved without adoption; DOCX remains opt-in.
  Check: `gtimeout --signal=INT --kill-after=10s 180s npm test -- --no-cache --workspace=docx --test-file=packages/docx/src/signature-relationship-owner-order-public.test.ts` — exit 0; 256/256 source/compiled cases passed; automatic posttest also passed (2 tests); no rerun.
  Duration: selected Vitest run 15.57s (callbacks 9.89s); complete maintained command approximately 55s; bounded attempt approximately 2 minutes.
  Commit: none (no owned product improvement). Owned WIP: this receipt in `docs/plans/docx-deferred-audit.md` only; no product, test or shared-infrastructure changes.
  Unrun: `packages/docx/src/signature-graph-closed-parts-public.test.ts` was inspected; closed graph metadata, separate lint/build, screenshots and broader qualification were not checked here.
  Next action, only in a separately authorized bounded task: validate the existing closed graph metadata behavior and fix only a reproduced DOCX defect. Broader F43 acceptance remains OPEN; no automatic retry, new active task, push or publication.

- 2026-09-23 `checkpoint-template-ordered-batches`: PARKED / no-change; F47 requirement OPEN. Selected behavior: ordered template/control edits expose typed staged results and publish once, while a later failure preserves the destination through SDK/CLI.
  Current dirty main at `4ff4eca9198c246365122aef7ae7bdfc2d752715` already implements the selected behavior; no actionable defect reproduced. Existing implementation/test edits preserved without adoption; DOCX remains opt-in.
  Original memfs check: `gtimeout --signal=INT --kill-after=10s 180s npm test -- --no-cache --workspace=docx --test-file=packages/docx/src/ordered-batch-boundaries-public.test.ts --test-file=packages/docx/src/review-controls-ordered-batch-public.test.ts` — exit 0; 436/436 selected tests passed; automatic posttest passed (2 tests); no rerun.
  Duration: selected Vitest run 8.63s; complete maintained command approximately 50s; bounded attempt approximately 2 minutes.
  Commit: none (no owned product improvement). Owned WIP: this receipt in `docs/plans/docx-deferred-audit.md` only; no product, test, shared-infrastructure or opt-in changes.
  Remaining: complete F47 template/ordered-batch requirements remain OPEN; this bounded passing check does not establish family acceptance. No separate lint/build, screenshots, schema/render/native matrices or broader qualification ran.
  Next action, only in a separately authorized task: address a concrete remaining F47 report; no new defect or active audit task was manufactured. No automatic retry, push or publication.

## Deferred task register

- `checkpoint-review-remaining-work`: Freeze the remaining review work into small checkpoints — deferred; original status preserved below.
- `accept-review-controls-properties`: Reconcile review-family acceptance after bounded checkpoints — deferred; original status preserved below.
- `accept-images-graphics-objects`: Close image, graphic and embedded-resource obligations — deferred; original status preserved below.
- `accept-removal-diff-pack`: Close removal, sanitization, comparison, validation and archive obligations — deferred; original status preserved below.
- `complete-opc-xml-image-case-adaptations`: Complete exact OPC, XML and image case adaptations — deferred; original status preserved below.
- `complete-text-style-document-case-adaptations`: Complete exact text, style and document case adaptations — deferred; original status preserved below.
- `complete-table-bdd-case-adaptations`: Complete exact table and BDD case adaptations — deferred; original status preserved below.
- `accept-all-public-types-guides`: Verify every public row, guide heading and consumer type — deferred; original status preserved below.
- `qualify-all-cli-sdk-conformance`: Execute every-command SDK parity and cross-format QA — deferred; original status preserved below.
- `qualify-malformed-lifecycle-budgets`: Close malformed-input, authority, cancellation and publication evidence — deferred; original status preserved below.
- `qualify-large-dense-language-profiles`: Complete large/dense and substantive language profiles — deferred; original status preserved below.
- `execute-independent-schema-interoperability`: Complete independent schema and interoperability validation — deferred; original status preserved below.
- `execute-full-corpus-repair-free-render-qa`: Complete repair-free document opening and visual QA — deferred; original status preserved below.
- `fix-ci-native-trap-comparisons`: Fix Linux native trap fixture or semantic failures — deferred; original status preserved below.
- `fix-ci-native-read-and-yes-comparisons`: Fix Linux read-deadline and yes native oracle failures — deferred; original status preserved below.
- `verify-settled-packed-consumers-opt-in`: Verify settled package consumers and default-preset isolation — deferred; original status preserved below.
- `close-entire-acceptance-register`: Close the full acceptance register without reducing scope — deferred; original status preserved below.
- `verify-clean-maintained-release-gates`: Pass clean maintained build, lint and full unit gates — deferred; original status preserved below.
- `retire-owned-campaign-inputs`: Retire only disposable QA inputs after preserving evidence — deferred; original status preserved below.
- `publish-only-after-complete-acceptance`: Deliver accepted DOCX on main and verify successful release — deferred; original status preserved below.

Full acceptance, exhaustive variants, native/schema/render QA, consumer qualification,
CI repairs, cleanup and release remain outstanding as applicable. New findings belong
here; they do not enlarge or block the current fixed implementation queue.

## Original plan before this scheduling change

This snapshot preserves every previous task ID, status, requirement and evidence note.
Its setup, step prompts and gates are historical; the bounded pass above supersedes
their execution order. Deferred work is not waived and no snapshot claim is promoted
to current validation.

````markdown
---
$schema: https://poe-platform.github.io/poe-code/schemas/plans/pipeline.schema.json
kind: pipeline
version: 1
name: DOCX remaining acceptance and release
readiness: draft
setup:
  prompt: |
    Read docs/plans/docx-release.md and root/scoped AGENTS.md. This ordered pipeline closes the complete remaining DOCX contract, not just six visible API defects. Preserve historical records and unrelated changes. Work on main; use original TDD and maintained uncached checks. Follow each task prompt independently. DOCX must remain explicit opt-in. The user authorized the three required package README additions and eventual release, but requires no remaining acceptance gaps. Task-owned atomic commits may be made locally; defer all pushes/publication until the final acceptance and release gates pass so incomplete work cannot become a stable release. Configured steps come from .poe-code/pipeline/steps.yaml; included steps start open. Commit only verified explicit owned files, never blanket staging, unrelated/ignored files, co-author, or hook bypass. Report evidence honestly: accounting, presence, skips, refusal and unrun cases are not behavioral passes. QA procedures live only under docs/plans. If later scope changes invalidate previous evidence, reopen and rerun the affected task before final release.

    Execution policy for this DOCX plan: use root/scoped AGENTS.md and docs/specs/docx.md, office-cli.md and office-sdk.md. Preserve unrelated work and existing acceptance identities. Keep DOCX opt-in and the final publication gate. Work on one named behavior or at most five exact outstanding obligation IDs per checkpoint; write those IDs and selected checks before editing. Aim for 30 minutes and split work before it exceeds 45 minutes. This is a scheduling target, not a passing criterion. If the selected work cannot fit, insert explicit continuation tasks before its acceptance gate, with exact remaining IDs and checks; leave unfinished work open. A checkpoint can finish only its stated subset. New unrelated findings become separately owned open tasks, never an expanding requirement of the running checkpoint. Use failing original memfs tests before code fixes. Run maintained uncached checks for the changed scope; npm test -- --no-cache --workspace=docx --test-file=packages/docx/src/NAME.test.ts selects exact files through the declared runner; repeat --test-file for additional files. Do not append positional test paths to the workspace command: Vitest combines them with the existing packages/docx selector and can run the whole package. Exact-file mode does not accept native test arguments; use its supported flags and inspect its dry-run first. Inspect actual membership; do not describe a focused result as a full-suite pass. Use the maintained workspace build only when compiled artifacts are needed or stale. Do not repeatedly rebuild all workspaces, run full DOCX, or generate another native/codec Cartesian product for each small edit. Reuse unchanged historical evidence as historical evidence; rerun affected behavior when sources or dependencies change. Keep existing tests and all required release gates. Record one concise receipt with obligation IDs, command, revision/diff, result, duration and remaining tasks. No background controller chains or duplicate runs; own, monitor and terminate subprocesses when interrupted. Slow or hung tests get a named diagnosis task, never a longer unbounded wait. Commit only explicit verified owned files; no push/publication before the final gate. Do not commit existing unowned modifications.
teardown:
  prompt: |
    Report task-owned local commits, unresolved obligations and exact executed checks.
    Do not automatically stage, commit unrelated changes, push or publish. Only the
    final publish-only-after-complete-acceptance task may deliver and publish after
    its gates pass. Preserve open states for blocked, failed, skipped or unrun
    required acceptance work; report the exact external dependency if blocked.
tasks:
  - id: reconcile-live-acceptance-backlog
    title: Reconcile the remaining obligations against current main
    prompt: |
      Work on main in /Users/kjopek/Workspace/poe-setup-scripts. Read root AGENTS.md and any scoped AGENTS.md before edits. docs/specs/docx.md is the format contract; docs/specs/office-cli.md and docs/specs/office-sdk.md govern parity. Validate each gap against current code before changing it; use original failing tests before code and memfs for unit file operations. Keep product logic in its package, preserve unrelated edits/index entries and historical evidence, and use only maintained uncached checks. Keep DOCX an explicit opt-in; never add it to default agent commands or their browser closure. Record executed evidence under docs/docx and QA procedures under docs/plans. Commit only verified owned files with atomic Conventional Commits; do not push or publish before the final acceptance/release task. Do not lower requirements, erase cases, or count skipped/unrun/mapping-only evidence as passes.

      Read docs/docx/whole-api-resumption.{md,json}, whole-api-acceptance.{md,json}, teardown-verification-20260916.{md,json}, acceptance-matrix.md, upstream-api-inventory.json, public-api-map.json, upstream-test-inventory.json, test-case-map.json and all current exact overlays. Inspect current source, schemas and tests. Produce a current requirement-to-evidence backlog in docs/docx without rewriting audit-time observations. Preserve the 50 feature families, 920 inventoried API IDs, 1,337 public map rows, 2,259 source-case identities, 262 enum values, twelve guides and eleven registered guide workflows; derive current counts and explain changes. Reconcile the nine documentary operation omissions and distinguish completed exports from complete behavior. Archived task statuses are historical execution metadata, not acceptance evidence. Classify each obligation as verified current behavior, reproduced defect, required missing behavior, or missing verification, with named evidence and an owning task in this pipeline. Expose every additional gap discovered; assign it to the appropriate task before completion. Acceptance: no missing/duplicate/orphan identities, no unexplained contract drift, and a concrete full-scope backlog; this accounting task alone accepts no product row.
    status:
      implement: done
      commit: done
  - id: verify-required-package-readmes
    title: Verify the authorized package READMEs
    prompt: |
      Work on main in /Users/kjopek/Workspace/poe-setup-scripts. Read root AGENTS.md and any scoped AGENTS.md before edits. docs/specs/docx.md is the format contract; docs/specs/office-cli.md and docs/specs/office-sdk.md govern parity. Validate each gap against current code before changing it; use original failing tests before code and memfs for unit file operations. Keep product logic in its package, preserve unrelated edits/index entries and historical evidence, and use only maintained uncached checks. Keep DOCX an explicit opt-in; never add it to default agent commands or their browser closure. Record executed evidence under docs/docx and QA procedures under docs/plans. Commit only verified owned files with atomic Conventional Commits; do not push or publish before the final acceptance/release task. Do not lower requirements, erase cases, or count skipped/unrun/mapping-only evidence as passes.

      The user explicitly authorized README additions on September 16, 2026. Verify the newly added packages/docx/README.md, packages/pptx/README.md and packages/office-package/README.md against current exported APIs. Correct their environment-variable/configuration descriptions and links if inspection shows drift. The prepared exact contents are retained in docs/plans/docx-release-readme-drafts.md; an older comprehensive DOCX draft is docs/docx/package-readme-draft.md. Document all exposed configuration options and environment variables, explicit DOCX/plugin opt-in, public imports, maintained checks and current support without premature parity claims. Run npm run lint:packages; reproduce and fix any remaining package violations. Acceptance: all required READMEs exist and package lint passes. Do not change the root or unrelated package README.
    status:
      implement: done
      commit: done
  - id: create-numbering-part
    title: Implement numbering-part creation and matching transport
    prompt: |
      Work on main in /Users/kjopek/Workspace/poe-setup-scripts. Read root AGENTS.md and any scoped AGENTS.md before edits. docs/specs/docx.md is the format contract; docs/specs/office-cli.md and docs/specs/office-sdk.md govern parity. Validate each gap against current code before changing it; use original failing tests before code and memfs for unit file operations. Keep product logic in its package, preserve unrelated edits/index entries and historical evidence, and use only maintained uncached checks. Keep DOCX an explicit opt-in; never add it to default agent commands or their browser closure. Record executed evidence under docs/docx and QA procedures under docs/plans. Commit only verified owned files with atomic Conventional Commits; do not push or publish before the final acceptance/release task. Do not lower requirements, erase cases, or count skipped/unrun/mapping-only evidence as passes.

      Validate the current NumberingPart.new rejection in packages/docx/src/package-view.ts and the creation obligation in the public API map. Implement real numbering-part creation using existing package ownership, relationship/content-type admission, numbering model and budgets. Reconcile its signature with the normative contract rather than copying a source-language NotImplementedError into the required JS API. Provide the matching typed operation, schema, discovery, result handle and actual SDK/CLI engine route; never return an unowned placeholder. Write failing original tests for creation in a document lacking numbering, existing-part behavior, malformed/duplicate definitions, canonical IDs, stale handles, rollback, bounds and save/reload. Verify independently that the new part and relationship are valid and unrelated bytes are preserved. Acceptance: required creation is usable through public model, SDK and CLI with the same ownership/error/publication behavior.
    status:
      implement: done
      test: done
      commit: done
  - id: align-nullable-paragraph-transport
    title: Support paragraph alignment reset through every route
    prompt: |
      Work on main in /Users/kjopek/Workspace/poe-setup-scripts. Read root AGENTS.md and any scoped AGENTS.md before edits. docs/specs/docx.md is the format contract; docs/specs/office-cli.md and docs/specs/office-sdk.md govern parity. Validate each gap against current code before changing it; use original failing tests before code and memfs for unit file operations. Keep product logic in its package, preserve unrelated edits/index entries and historical evidence, and use only maintained uncached checks. Keep DOCX an explicit opt-in; never add it to default agent commands or their browser closure. Record executed evidence under docs/docx and QA procedures under docs/plans. Commit only verified owned files with atomic Conventional Commits; do not push or publish before the final acceptance/release task. Do not lower requirements, erase cases, or count skipped/unrun/mapping-only evidence as passes.

      Validate the gap between the public Paragraph alignment setter in packages/docx/src/block-model.ts and model.text.paragraph.Paragraph.alignment.set in operation-schema-data.ts and operation-types.ts. Add original failing paired model/SDK/actual CLI-engine tests that set a concrete alignment, reset with null, and save/reload to independently verify inheritance and removal of direct XML formatting. Update the source declarations and all generated/derived argument, JSON schema, help/discovery and transport surfaces through the maintained source of truth. Keep enum-symbol validation, null/undefined/false distinctions and existing nonnullable fields intact. Acceptance: null is admitted in the public types and real parser/engine, reset works identically in all routes, malformed enum values still reject without publication, and no manual duplicated registry drifts.
    status:
      implement: done
      test: done
      commit: done
  - id: discover-paragraph-element
    title: Expose the owned Paragraph.element getter in typed batches
    prompt: |
      Work on main in /Users/kjopek/Workspace/poe-setup-scripts. Read root AGENTS.md and any scoped AGENTS.md before edits. docs/specs/docx.md is the format contract; docs/specs/office-cli.md and docs/specs/office-sdk.md govern parity. Validate each gap against current code before changing it; use original failing tests before code and memfs for unit file operations. Keep product logic in its package, preserve unrelated edits/index entries and historical evidence, and use only maintained uncached checks. Keep DOCX an explicit opt-in; never add it to default agent commands or their browser closure. Record executed evidence under docs/docx and QA procedures under docs/plans. Commit only verified owned files with atomic Conventional Commits; do not push or publish before the final acceptance/release task. Do not lower requirements, erase cases, or count skipped/unrun/mapping-only evidence as passes.

      Validate that Paragraph.element is public while its matching typed getter is absent. Add the getter declaration and result-handle/discovery route using the existing XmlElementView and structure-model-batch-operations.ts ownership checks. Keep inherited public members in the denominator. Write failing original tests selecting a paragraph, obtaining its element through model, SDK and actual CLI batch, observing its expanded name and using a supported XML-view operation. Assert read purity, exact result typing, stale/foreign handle rejection, no arbitrary evaluation or ambient I/O, and save/reload behavior for an explicitly authorized edit. Acceptance: the actual getter is discoverable and executable with the same ownership and mutation rules, not merely replaced by an equivalent utility workflow.
    status:
      implement: done
      test: done
      commit: done
  - id: reconcile-binary-capability-context
    title: Complete explicit binary capability and context mappings
    prompt: |
      Work on main in /Users/kjopek/Workspace/poe-setup-scripts. Read root AGENTS.md and any scoped AGENTS.md before edits. docs/specs/docx.md is the format contract; docs/specs/office-cli.md and docs/specs/office-sdk.md govern parity. Validate each gap against current code before changing it; use original failing tests before code and memfs for unit file operations. Keep product logic in its package, preserve unrelated edits/index entries and historical evidence, and use only maintained uncached checks. Keep DOCX an explicit opt-in; never add it to default agent commands or their browser closure. Record executed evidence under docs/docx and QA procedures under docs/plans. Commit only verified owned files with atomic Conventional Commits; do not push or publish before the final acceptance/release task. Do not lower requirements, erase cases, or count skipped/unrun/mapping-only evidence as passes.

      Read docs/specs/office-sdk.md, public-api-map.json, whole-api-resumption.json, packages/docx/src/model-context.ts, model-input.ts, image-model-input.ts, operation-types.ts and current context tests. Reconcile required capability-object input with the implemented string-token binaryResolver transport. Implement required public capability inputs while keeping JSON transport declarative and resolving tokens only through explicitly supplied trusted adapters. Complete declared fonts, template and VFS context forms and their model/SDK/CLI mappings; do not invent aliases or ambient authority. Time, identity, font metrics, template bytes, limits and cancellation remain explicit and immutable across admission. Add original failing tests for object and token forms, wrong/foreign/missing capability, accessors, malformed paths, caller mutation across awaits, template admission, font metric selection, bounds, cancellation and owned cleanup. Acceptance: every required context field has a live behavior and documented transport/ownership semantics, with no ignored required field or host/font/network lookup.
    status:
      implement: done
      test: done
      commit: done
  - id: complete-document-save-outputs
    title: Support ByteSink and VFS document save with safe publication
    prompt: |
      Work on main in /Users/kjopek/Workspace/poe-setup-scripts. Read root AGENTS.md and any scoped AGENTS.md before edits. docs/specs/docx.md is the format contract; docs/specs/office-cli.md and docs/specs/office-sdk.md govern parity. Validate each gap against current code before changing it; use original failing tests before code and memfs for unit file operations. Keep product logic in its package, preserve unrelated edits/index entries and historical evidence, and use only maintained uncached checks. Keep DOCX an explicit opt-in; never add it to default agent commands or their browser closure. Record executed evidence under docs/docx and QA procedures under docs/plans. Commit only verified owned files with atomic Conventional Commits; do not push or publish before the final acceptance/release task. Do not lower requirements, erase cases, or count skipped/unrun/mapping-only evidence as passes.

      Read the required save(output: ByteSink | VfsPath) contract, packages/docx/src/document-model.ts, model-store.ts, archive-write.ts, publication.ts and the completed context mapping. Validate current ArchiveSink-only save. Implement required ByteSink and VFS path outputs through the existing publication abstraction, retaining supported ArchiveSink compatibility where required. Define and test close/ownership semantics, explicit path authority, output conflicts and conditional/atomic publication without ambient host paths. Expose matching SDK/CLI publication behavior and public consumer types. Add failing original memfs tests for byte sink save/reload, VFS save/reopen, input alias, foreign capability, collision, partial-write/close/cleanup failure, cancellation and model mutation during publication. Acceptance: each required output form actually saves a valid document, with identical protection, failure and rollback guarantees; no unbounded buffering or callback-evaluation shortcut.
    status:
      implement: done
      test: done
      commit: done
  - id: reconcile-complete-discovery-map
    title: Reconcile all operations with the documented API and feature map
    prompt: |
      Work on main in /Users/kjopek/Workspace/poe-setup-scripts. Read root AGENTS.md and any scoped AGENTS.md before edits. docs/specs/docx.md is the format contract; docs/specs/office-cli.md and docs/specs/office-sdk.md govern parity. Validate each gap against current code before changing it; use original failing tests before code and memfs for unit file operations. Keep product logic in its package, preserve unrelated edits/index entries and historical evidence, and use only maintained uncached checks. Keep DOCX an explicit opt-in; never add it to default agent commands or their browser closure. Record executed evidence under docs/docx and QA procedures under docs/plans. Commit only verified owned files with atomic Conventional Commits; do not push or publish before the final acceptance/release task. Do not lower requirements, erase cases, or count skipped/unrun/mapping-only evidence as passes.

      Validate current operation schemas/discovery against docs/docx/command-coverage.json and command-coverage-notes.md, public-api-map.json and current registers. Account explicitly for styles.defaults.get/set, styles.latent.add/get/list/remove/set and styles.latent.defaults.get/set, plus operations added by this pipeline. Audit every public/inherited/returned/helper/underscore API member for matching SDK and CLI capability. Fix stale utility-era model-pending descriptions only when behavior is verified. Derive registration, operation types, JSON schemas, help and capability data from maintained declarations; no provider-dependent branches or parallel handwritten registries. Test real help/schema/capabilities for complete joins, closed grammar and executable routes; inspect terminal screenshots after output changes. Acceptance: zero undocumented declared operations, orphan API IDs, missing feature joins or SDK-only required capabilities. Counts are measured, never hardcoded acceptance substitutes.
    status:
      implement: done
      test: done
      commit: done
  - id: accept-opc-xml-compatibility
    title: Close package, XML and compatibility obligations
    prompt: |
      Work on main in /Users/kjopek/Workspace/poe-setup-scripts. Read root AGENTS.md and any scoped AGENTS.md before edits. docs/specs/docx.md is the format contract; docs/specs/office-cli.md and docs/specs/office-sdk.md govern parity. Validate each gap against current code before changing it; use original failing tests before code and memfs for unit file operations. Keep product logic in its package, preserve unrelated edits/index entries and historical evidence, and use only maintained uncached checks. Keep DOCX an explicit opt-in; never add it to default agent commands or their browser closure. Record executed evidence under docs/docx and QA procedures under docs/plans. Commit only verified owned files with atomic Conventional Commits; do not push or publish before the final acceptance/release task. Do not lower requirements, erase cases, or count skipped/unrun/mapping-only evidence as passes.

      Read docs/specs/docx.md and the current obligation backlog for F01-F07: ZIP/OPC, Strict/Transitional, DOCX/DOTX admission, XML fidelity, MCE, inspection and XML access. Inspect the archive/admission/package/XML/compatibility source/tests, corresponding feature evidence and acceptance-matrix entries. For every normative requirement in these families, independently execute the public model/SDK/actual CLI paths that apply, including boundaries, Strict and Transitional forms, expected read/edit/preserve/reject behavior, and dirty-part/relationship retention. Do not accept the existing bounded milestone or capability label as complete-family evidence. Reproduce every remaining defect with an original failing memfs test before fixing the package-domain implementation; add required behavior rather than reducing scope. Resolve documented missing native/carrier/variant coverage and cross-family interactions, preserving legitimate contract-defined inert/unsupported rejection semantics. Update named requirement-to-test evidence after passing. Acceptance: every requirement in these families has current exact passing evidence or a justified contract-defined expected rejection, zero unimplemented required behavior, zero unexecuted required variants and no unresolved family entries. Newly discovered dependencies must be closed and rerun before this task can finish.
    status:
      implement: done
      test: done
      commit: done
  - id: accept-text-styles-language
    title: Close text, formatting, language and style obligations
    prompt: |
      Work on main in /Users/kjopek/Workspace/poe-setup-scripts. Read root AGENTS.md and any scoped AGENTS.md before edits. docs/specs/docx.md is the format contract; docs/specs/office-cli.md and docs/specs/office-sdk.md govern parity. Validate each gap against current code before changing it; use original failing tests before code and memfs for unit file operations. Keep product logic in its package, preserve unrelated edits/index entries and historical evidence, and use only maintained uncached checks. Keep DOCX an explicit opt-in; never add it to default agent commands or their browser closure. Record executed evidence under docs/docx and QA procedures under docs/plans. Commit only verified owned files with atomic Conventional Commits; do not push or publish before the final acceptance/release task. Do not lower requirements, erase cases, or count skipped/unrun/mapping-only evidence as passes.

      Read docs/specs/docx.md and the current obligation backlog for F08-F15 and F18: story text, Unicode/RTL/CJK semantics, preserving replacement, creation, run/paragraph formatting, styles/themes/headings and numbering. Inspect the text/block/style/formatting/numbering source/tests, corresponding feature evidence and acceptance-matrix entries. For every normative requirement in these families, independently execute the public model/SDK/actual CLI paths that apply, including boundaries, Strict and Transitional forms, expected read/edit/preserve/reject behavior, and dirty-part/relationship retention. Do not accept the existing bounded milestone or capability label as complete-family evidence. Reproduce every remaining defect with an original failing memfs test before fixing the package-domain implementation; add required behavior rather than reducing scope. Resolve documented missing native/carrier/variant coverage and cross-family interactions, preserving legitimate contract-defined inert/unsupported rejection semantics. Update named requirement-to-test evidence after passing. Acceptance: every requirement in these families has current exact passing evidence or a justified contract-defined expected rejection, zero unimplemented required behavior, zero unexecuted required variants and no unresolved family entries. Newly discovered dependencies must be closed and rerun before this task can finish.
    status:
      implement: done
      test: done
      commit: done
  - id: accept-layout-tables-stories
    title: Close sections, stories and table obligations
    prompt: |
      Work on main in /Users/kjopek/Workspace/poe-setup-scripts. Read root AGENTS.md and any scoped AGENTS.md before edits. docs/specs/docx.md is the format contract; docs/specs/office-cli.md and docs/specs/office-sdk.md govern parity. Validate each gap against current code before changing it; use original failing tests before code and memfs for unit file operations. Keep product logic in its package, preserve unrelated edits/index entries and historical evidence, and use only maintained uncached checks. Keep DOCX an explicit opt-in; never add it to default agent commands or their browser closure. Record executed evidence under docs/docx and QA procedures under docs/plans. Commit only verified owned files with atomic Conventional Commits; do not push or publish before the final acceptance/release task. Do not lower requirements, erase cases, or count skipped/unrun/mapping-only evidence as passes.

      Read docs/specs/docx.md and the current obligation backlog for F16-F17 and F19-F24: page settings, headers/footers, merged and omitted cells, tables, links/bookmarks, fields/TOC/captions and note references. Inspect the section/table/story/field/note/link/bookmark source/tests, corresponding feature evidence and acceptance-matrix entries. For every normative requirement in these families, independently execute the public model/SDK/actual CLI paths that apply, including boundaries, Strict and Transitional forms, expected read/edit/preserve/reject behavior, and dirty-part/relationship retention. Do not accept the existing bounded milestone or capability label as complete-family evidence. Reproduce every remaining defect with an original failing memfs test before fixing the package-domain implementation; add required behavior rather than reducing scope. Resolve documented missing native/carrier/variant coverage and cross-family interactions, preserving legitimate contract-defined inert/unsupported rejection semantics. Update named requirement-to-test evidence after passing. Acceptance: every requirement in these families has current exact passing evidence or a justified contract-defined expected rejection, zero unimplemented required behavior, zero unexecuted required variants and no unresolved family entries. Newly discovered dependencies must be closed and rerun before this task can finish.
    status:
      implement: done
      test: done
      commit: done
  - id: checkpoint-review-remaining-work
    title: Freeze the remaining review work into small checkpoints
    prompt: |-
      Read root/scoped AGENTS.md and docs/specs/docx.md, office-cli.md and office-sdk.md. Preserve unrelated edits, all acceptance identities and the final publication gate. Keep DOCX opt-in. Select at most five named obligations, target a 30-minute checkpoint, and split work expected to exceed 45 minutes into explicit tasks before its gate. Use original failing memfs tests before code changes and only maintained uncached checks covering the selected scope. Commit explicit verified owned files only; no push or publication. Interrupted and unexecuted checks are not passes.

      Read the current F25-F30/F41-F43/F47 entries and latest review-resource-contract-20260921 receipts. Inspect git diff without adopting or reverting existing edits. In one concise section of this plan, record the exact remaining obligation IDs, owning checkpoint, relevant test names, and known slow cases. Use the ten following checkpoints; refine their prompts to the exact IDs and split any subset exceeding five IDs or 45 minutes. Preserve completed status entries. Do not rerun tests, regenerate broad evidence inventories, or implement product code in this accounting task. Interrupted September 23 full-suite/controller and September 21 native-spacing workers are incomplete, never passing evidence. Acceptance: every known remaining obligation has a concrete owner and the next task names its exact tests; unknown coverage stays explicitly open at the family gate.
    status:
      implement: open
      commit: open
  - id: checkpoint-comments-active-anchors
    title: "F25: active comment anchors"
    prompt: |-
      Read root/scoped AGENTS.md and docs/specs/docx.md, office-cli.md and office-sdk.md. Preserve unrelated edits, all acceptance identities and the final publication gate. Keep DOCX opt-in. Select at most five named obligations, target a 30-minute checkpoint, and split work expected to exceed 45 minutes into explicit tasks before its gate. Use original failing memfs tests before code changes and only maintained uncached checks covering the selected scope. Commit explicit verified owned files only; no push or publication. Interrupted and unexecuted checks are not passes.

      Scope: F25; begin with the existing packages/docx/src/comment-anchor-active-creation-carriers-public.test.ts and packages/docx/src/comment-anchor-opaque-preflight-sdk-cli-public.test.ts. Inspect current evidence and select at most five exact unresolved requirements covered by these tests. Verify existing in-progress behavior before changing it; do not duplicate tests already covering the case. Run the smallest named cases first. Use --test-file selectors for these files; do not append positional file filters or combine exact-file mode with native test-name arguments. Run each selected file once and record its duration. A slow file gets its own bounded diagnosis rather than another generated variant matrix. Fix only a reproduced defect needed by this subset. Acceptance: each selected obligation has passing named evidence and any owned fix has an atomic commit; all other unresolved F25 obligations remain explicitly assigned to continuation tasks before accept-review-controls-properties. This checkpoint does not accept the complete family. If evidence shows the subset is already settled, record that with source validity and continue without manufacturing another audit.
    status:
      implement: open
      commit: open
  - id: checkpoint-revision-decision-depth
    title: "F26: selected revision decision depth"
    prompt: |-
      Read root/scoped AGENTS.md and docs/specs/docx.md, office-cli.md and office-sdk.md. Preserve unrelated edits, all acceptance identities and the final publication gate. Keep DOCX opt-in. Select at most five named obligations, target a 30-minute checkpoint, and split work expected to exceed 45 minutes into explicit tasks before its gate. Use original failing memfs tests before code changes and only maintained uncached checks covering the selected scope. Commit explicit verified owned files only; no push or publication. Interrupted and unexecuted checks are not passes.

      Scope: F26; begin with the existing packages/docx/src/revision-decision-selected-native-depth-public.test.ts and packages/docx/src/revision-decision-unrelated-native-depth-public.test.ts. Inspect current evidence and select at most five exact unresolved requirements covered by these tests. Verify existing in-progress behavior before changing it; do not duplicate tests already covering the case. Run the smallest named cases first. Use --test-file selectors for these files; do not append positional file filters or combine exact-file mode with native test-name arguments. Run each selected file once and record its duration. A slow file gets its own bounded diagnosis rather than another generated variant matrix. Fix only a reproduced defect needed by this subset. Acceptance: each selected obligation has passing named evidence and any owned fix has an atomic commit; all other unresolved F26 obligations remain explicitly assigned to continuation tasks before accept-review-controls-properties. This checkpoint does not accept the complete family. If evidence shows the subset is already settled, record that with source validity and continue without manufacturing another audit.
    status:
      implement: open
      commit: open
  - id: checkpoint-complex-review-variants
    title: "F27: complex review variants"
    prompt: |-
      Read root/scoped AGENTS.md and docs/specs/docx.md, office-cli.md and office-sdk.md. Preserve unrelated edits, all acceptance identities and the final publication gate. Keep DOCX opt-in. Select at most five named obligations, target a 30-minute checkpoint, and split work expected to exceed 45 minutes into explicit tasks before its gate. Use original failing memfs tests before code changes and only maintained uncached checks covering the selected scope. Commit explicit verified owned files only; no push or publication. Interrupted and unexecuted checks are not passes.

      Scope: F27; begin with the existing packages/docx/src/review-complex-complete-variants-public.test.ts and packages/docx/src/review-native-timestamp-range-public.test.ts. Inspect current evidence and select at most five exact unresolved requirements covered by these tests. Verify existing in-progress behavior before changing it; do not duplicate tests already covering the case. Run the smallest named cases first. Use --test-file selectors for these files; do not append positional file filters or combine exact-file mode with native test-name arguments. Run each selected file once and record its duration. A slow file gets its own bounded diagnosis rather than another generated variant matrix. Fix only a reproduced defect needed by this subset. Acceptance: each selected obligation has passing named evidence and any owned fix has an atomic commit; all other unresolved F27 obligations remain explicitly assigned to continuation tasks before accept-review-controls-properties. This checkpoint does not accept the complete family. If evidence shows the subset is already settled, record that with source validity and continue without manufacturing another audit.
    status:
      implement: open
      commit: open
  - id: checkpoint-control-scalar-and-picture
    title: "F28: scalar and picture control retention"
    prompt: |-
      Read root/scoped AGENTS.md and docs/specs/docx.md, office-cli.md and office-sdk.md. Preserve unrelated edits, all acceptance identities and the final publication gate. Keep DOCX opt-in. Select at most five named obligations, target a 30-minute checkpoint, and split work expected to exceed 45 minutes into explicit tasks before its gate. Use original failing memfs tests before code changes and only maintained uncached checks covering the selected scope. Commit explicit verified owned files only; no push or publication. Interrupted and unexecuted checks are not passes.

      Scope: F28; begin with the existing packages/docx/src/control-scalar-trivia-original-public.test.ts and packages/docx/src/picture-control-retained-native-depth-public.test.ts. Inspect current evidence and select at most five exact unresolved requirements covered by these tests. Verify existing in-progress behavior before changing it; do not duplicate tests already covering the case. Run the smallest named cases first. Use --test-file selectors for these files; do not append positional file filters or combine exact-file mode with native test-name arguments. Run each selected file once and record its duration. A slow file gets its own bounded diagnosis rather than another generated variant matrix. Fix only a reproduced defect needed by this subset. Acceptance: each selected obligation has passing named evidence and any owned fix has an atomic commit; all other unresolved F28 obligations remain explicitly assigned to continuation tasks before accept-review-controls-properties. This checkpoint does not accept the complete family. If evidence shows the subset is already settled, record that with source validity and continue without manufacturing another audit.
    status:
      implement: open
      commit: open
  - id: checkpoint-repeat-native-depth
    title: "F29: admitted native repetition depth"
    prompt: |-
      Read root/scoped AGENTS.md and docs/specs/docx.md, office-cli.md and office-sdk.md. Preserve unrelated edits, all acceptance identities and the final publication gate. Keep DOCX opt-in. Select at most five named obligations, target a 30-minute checkpoint, and split work expected to exceed 45 minutes into explicit tasks before its gate. Use original failing memfs tests before code changes and only maintained uncached checks covering the selected scope. Commit explicit verified owned files only; no push or publication. Interrupted and unexecuted checks are not passes.

      Scope: F29; begin with the existing packages/docx/src/repeat-template-admitted-native-table-depth-public.test.ts and packages/docx/src/repeat-template-native-physical-depth-public.test.ts. Inspect current evidence and select at most five exact unresolved requirements covered by these tests. Verify existing in-progress behavior before changing it; do not duplicate tests already covering the case. Run the smallest named cases first. Use --test-file selectors for these files; do not append positional file filters or combine exact-file mode with native test-name arguments. Run each selected file once and record its duration. A slow file gets its own bounded diagnosis rather than another generated variant matrix. Fix only a reproduced defect needed by this subset. Acceptance: each selected obligation has passing named evidence and any owned fix has an atomic commit; all other unresolved F29 obligations remain explicitly assigned to continuation tasks before accept-review-controls-properties. This checkpoint does not accept the complete family. If evidence shows the subset is already settled, record that with source validity and continue without manufacturing another audit.
    status:
      implement: open
      commit: open
  - id: checkpoint-property-native-scalars
    title: "F30: property width and native scalars"
    prompt: |-
      Read root/scoped AGENTS.md and docs/specs/docx.md, office-cli.md and office-sdk.md. Preserve unrelated edits, all acceptance identities and the final publication gate. Keep DOCX opt-in. Select at most five named obligations, target a 30-minute checkpoint, and split work expected to exceed 45 minutes into explicit tasks before its gate. Use original failing memfs tests before code changes and only maintained uncached checks covering the selected scope. Commit explicit verified owned files only; no push or publication. Interrupted and unexecuted checks are not passes.

      Scope: F30; begin with the existing packages/docx/src/property-width-mutation-and-native64-public.test.ts and packages/docx/src/property-inherited-native-variant-public.test.ts. Inspect current evidence and select at most five exact unresolved requirements covered by these tests. Verify existing in-progress behavior before changing it; do not duplicate tests already covering the case. Run the smallest named cases first. Use --test-file selectors for these files; do not append positional file filters or combine exact-file mode with native test-name arguments. Run each selected file once and record its duration. A slow file gets its own bounded diagnosis rather than another generated variant matrix. Fix only a reproduced defect needed by this subset. Acceptance: each selected obligation has passing named evidence and any owned fix has an atomic commit; all other unresolved F30 obligations remain explicitly assigned to continuation tasks before accept-review-controls-properties. This checkpoint does not accept the complete family. If evidence shows the subset is already settled, record that with source validity and continue without manufacturing another audit.
    status:
      implement: open
      commit: open
  - id: checkpoint-ancillary-xml-boundaries
    title: "F41: custom XML resource boundaries"
    prompt: |-
      Read root/scoped AGENTS.md and docs/specs/docx.md, office-cli.md and office-sdk.md. Preserve unrelated edits, all acceptance identities and the final publication gate. Keep DOCX opt-in. Select at most five named obligations, target a 30-minute checkpoint, and split work expected to exceed 45 minutes into explicit tasks before its gate. Use original failing memfs tests before code changes and only maintained uncached checks covering the selected scope. Commit explicit verified owned files only; no push or publication. Interrupted and unexecuted checks are not passes.

      Scope: F41; begin with the existing packages/docx/src/raw-custom-xml-boundaries-public.test.ts and packages/docx/src/binding-signature-resource-ordered-batch-public.test.ts. Inspect current evidence and select at most five exact unresolved requirements covered by these tests. Verify existing in-progress behavior before changing it; do not duplicate tests already covering the case. Run the smallest named cases first. Use --test-file selectors for these files; do not append positional file filters or combine exact-file mode with native test-name arguments. Run each selected file once and record its duration. A slow file gets its own bounded diagnosis rather than another generated variant matrix. Fix only a reproduced defect needed by this subset. Acceptance: each selected obligation has passing named evidence and any owned fix has an atomic commit; all other unresolved F41 obligations remain explicitly assigned to continuation tasks before accept-review-controls-properties. This checkpoint does not accept the complete family. If evidence shows the subset is already settled, record that with source validity and continue without manufacturing another audit.
    status:
      implement: open
      commit: open
  - id: checkpoint-settings-native-carriers
    title: "F42: native settings carriers"
    prompt: |-
      Read root/scoped AGENTS.md and docs/specs/docx.md, office-cli.md and office-sdk.md. Preserve unrelated edits, all acceptance identities and the final publication gate. Keep DOCX opt-in. Select at most five named obligations, target a 30-minute checkpoint, and split work expected to exceed 45 minutes into explicit tasks before its gate. Use original failing memfs tests before code changes and only maintained uncached checks covering the selected scope. Commit explicit verified owned files only; no push or publication. Interrupted and unexecuted checks are not passes.

      Scope: F42; begin with the existing packages/docx/src/settings-native-depth-public.test.ts and packages/docx/src/settings-native-boolean-whitespace-public.test.ts. Inspect current evidence and select at most five exact unresolved requirements covered by these tests. Verify existing in-progress behavior before changing it; do not duplicate tests already covering the case. Run the smallest named cases first. Use --test-file selectors for these files; do not append positional file filters or combine exact-file mode with native test-name arguments. Run each selected file once and record its duration. A slow file gets its own bounded diagnosis rather than another generated variant matrix. Fix only a reproduced defect needed by this subset. Acceptance: each selected obligation has passing named evidence and any owned fix has an atomic commit; all other unresolved F42 obligations remain explicitly assigned to continuation tasks before accept-review-controls-properties. This checkpoint does not accept the complete family. If evidence shows the subset is already settled, record that with source validity and continue without manufacturing another audit.
    status:
      implement: open
      commit: open
  - id: checkpoint-signature-graph-retention
    title: "F43: signature graph and owner order"
    prompt: |-
      Read root/scoped AGENTS.md and docs/specs/docx.md, office-cli.md and office-sdk.md. Preserve unrelated edits, all acceptance identities and the final publication gate. Keep DOCX opt-in. Select at most five named obligations, target a 30-minute checkpoint, and split work expected to exceed 45 minutes into explicit tasks before its gate. Use original failing memfs tests before code changes and only maintained uncached checks covering the selected scope. Commit explicit verified owned files only; no push or publication. Interrupted and unexecuted checks are not passes.

      Scope: F43; begin with the existing packages/docx/src/signature-graph-closed-parts-public.test.ts and packages/docx/src/signature-relationship-owner-order-public.test.ts. Inspect current evidence and select at most five exact unresolved requirements covered by these tests. Verify existing in-progress behavior before changing it; do not duplicate tests already covering the case. Run the smallest named cases first. Use --test-file selectors for these files; do not append positional file filters or combine exact-file mode with native test-name arguments. Run each selected file once and record its duration. A slow file gets its own bounded diagnosis rather than another generated variant matrix. Fix only a reproduced defect needed by this subset. Acceptance: each selected obligation has passing named evidence and any owned fix has an atomic commit; all other unresolved F43 obligations remain explicitly assigned to continuation tasks before accept-review-controls-properties. This checkpoint does not accept the complete family. If evidence shows the subset is already settled, record that with source validity and continue without manufacturing another audit.
    status:
      implement: open
      commit: open
  - id: checkpoint-template-ordered-batches
    title: "F47: template and ordered batch boundaries"
    prompt: |-
      Read root/scoped AGENTS.md and docs/specs/docx.md, office-cli.md and office-sdk.md. Preserve unrelated edits, all acceptance identities and the final publication gate. Keep DOCX opt-in. Select at most five named obligations, target a 30-minute checkpoint, and split work expected to exceed 45 minutes into explicit tasks before its gate. Use original failing memfs tests before code changes and only maintained uncached checks covering the selected scope. Commit explicit verified owned files only; no push or publication. Interrupted and unexecuted checks are not passes.

      Scope: F47; begin with the existing packages/docx/src/ordered-batch-boundaries-public.test.ts and packages/docx/src/review-controls-ordered-batch-public.test.ts. Inspect current evidence and select at most five exact unresolved requirements covered by these tests. Verify existing in-progress behavior before changing it; do not duplicate tests already covering the case. Run the smallest named cases first. Use --test-file selectors for these files; do not append positional file filters or combine exact-file mode with native test-name arguments. Run each selected file once and record its duration. A slow file gets its own bounded diagnosis rather than another generated variant matrix. Fix only a reproduced defect needed by this subset. Acceptance: each selected obligation has passing named evidence and any owned fix has an atomic commit; all other unresolved F47 obligations remain explicitly assigned to continuation tasks before accept-review-controls-properties. This checkpoint does not accept the complete family. If evidence shows the subset is already settled, record that with source validity and continue without manufacturing another audit.
    status:
      implement: open
      commit: open
  - id: accept-review-controls-properties
    title: Reconcile review-family acceptance after bounded checkpoints
    prompt: |-
      Read root/scoped AGENTS.md and docs/specs/docx.md, office-cli.md and office-sdk.md. Preserve unrelated edits, all acceptance identities and the final publication gate. Keep DOCX opt-in. Select at most five named obligations, target a 30-minute checkpoint, and split work expected to exceed 45 minutes into explicit tasks before its gate. Use original failing memfs tests before code changes and only maintained uncached checks covering the selected scope. Commit explicit verified owned files only; no push or publication. Interrupted and unexecuted checks are not passes.

      This is the acceptance gate for F25-F30 and F41-F43/F47. The ten preceding checkpoint families and their continuations own implementation and verification. Read their receipts and the existing acceptance register; verify every normative obligation has exact valid evidence and zero required omissions. The original full scope is retained below in this plan under “Review-family gate scope before subdivision”. Do not perform another whole-family audit, fix unrelated findings, generate new variant matrices, or run full DOCX here. If any required evidence is missing or invalidated, insert a task before this gate with the exact IDs, reproduction/check command and completion criterion; keep this gate open until it passes. Acceptance remains complete coverage of all these families, not merely completion of checkpoint metadata. New dependencies are separate bounded tasks; the gate waits for them.
    status:
      implement: done
      test: open
      commit: open
  - id: accept-images-graphics-objects
    title: Close image, graphic and embedded-resource obligations
    prompt: |
      Apply the bounded execution policy in this plan’s step prompts. Before starting the scope below, estimate its size. If it exceeds one bounded checkpoint, split it into explicit tasks with exact obligation IDs/test or fixture names before this task; retain this task as the final reconciliation gate for its original scope. Gate tasks inspect receipts and schedule missing work rather than recursively doing all of it. Full-suite, independent rendering and publication gates keep their required checks and are monitored once; the 45-minute target does not waive any check.

      Work on main in /Users/kjopek/Workspace/poe-setup-scripts. Read root AGENTS.md and any scoped AGENTS.md before edits. docs/specs/docx.md is the format contract; docs/specs/office-cli.md and docs/specs/office-sdk.md govern parity. Validate each gap against current code before changing it; use original failing tests before code and memfs for unit file operations. Keep product logic in its package, preserve unrelated edits/index entries and historical evidence, and use only maintained uncached checks. Keep DOCX an explicit opt-in; never add it to default agent commands or their browser closure. Record executed evidence under docs/docx and QA procedures under docs/plans. Commit only verified owned files with atomic Conventional Commits; do not push or publish before the final acceptance/release task. Do not lower requirements, erase cases, or count skipped/unrun/mapping-only evidence as passes.

      Read docs/specs/docx.md and the current obligation backlog for F31-F40: occurrence inventories, raster formats, floating geometry, SVG/fallbacks, alternate graphics, shapes/text boxes, charts/workbooks, SmartArt/diagrams, OMML and inert embedded objects. Inspect the image/drawing/shape/chart/diagram/equation/object source/tests, corresponding feature evidence and acceptance-matrix entries. For every normative requirement in these families, independently execute the public model/SDK/actual CLI paths that apply, including boundaries, Strict and Transitional forms, expected read/edit/preserve/reject behavior, and dirty-part/relationship retention. Do not accept the existing bounded milestone or capability label as complete-family evidence. Reproduce every remaining defect with an original failing memfs test before fixing the package-domain implementation; add required behavior rather than reducing scope. Resolve documented missing native/carrier/variant coverage and cross-family interactions, preserving legitimate contract-defined inert/unsupported rejection semantics. Update named requirement-to-test evidence after passing. Acceptance: every requirement in these families has current exact passing evidence or a justified contract-defined expected rejection, zero unimplemented required behavior, zero unexecuted required variants and no unresolved family entries. Newly discovered dependencies must be closed and rerun before this task can finish.
    status:
      implement: open
      test: open
      commit: open
  - id: accept-removal-diff-pack
    title: Close removal, sanitization, comparison, validation and archive obligations
    prompt: |
      Apply the bounded execution policy in this plan’s step prompts. Before starting the scope below, estimate its size. If it exceeds one bounded checkpoint, split it into explicit tasks with exact obligation IDs/test or fixture names before this task; retain this task as the final reconciliation gate for its original scope. Gate tasks inspect receipts and schedule missing work rather than recursively doing all of it. Full-suite, independent rendering and publication gates keep their required checks and are monitored once; the 45-minute target does not waive any check.

      Work on main in /Users/kjopek/Workspace/poe-setup-scripts. Read root AGENTS.md and any scoped AGENTS.md before edits. docs/specs/docx.md is the format contract; docs/specs/office-cli.md and docs/specs/office-sdk.md govern parity. Validate each gap against current code before changing it; use original failing tests before code and memfs for unit file operations. Keep product logic in its package, preserve unrelated edits/index entries and historical evidence, and use only maintained uncached checks. Keep DOCX an explicit opt-in; never add it to default agent commands or their browser closure. Record executed evidence under docs/docx and QA procedures under docs/plans. Commit only verified owned files with atomic Conventional Commits; do not push or publish before the final acceptance/release task. Do not lower requirements, erase cases, or count skipped/unrun/mapping-only evidence as passes.

      Read docs/specs/docx.md and the current obligation backlog for F44-F46 and F48-F50: exact content removal, seeded dummy text, sanitization, diff, semantic validation, extraction and authenticated packing. Inspect the removal/dummy/sanitize/diff/validation/extract/pack source/tests, corresponding feature evidence and acceptance-matrix entries. For every normative requirement in these families, independently execute the public model/SDK/actual CLI paths that apply, including boundaries, Strict and Transitional forms, expected read/edit/preserve/reject behavior, and dirty-part/relationship retention. Do not accept the existing bounded milestone or capability label as complete-family evidence. Reproduce every remaining defect with an original failing memfs test before fixing the package-domain implementation; add required behavior rather than reducing scope. Resolve documented missing native/carrier/variant coverage and cross-family interactions, preserving legitimate contract-defined inert/unsupported rejection semantics. Update named requirement-to-test evidence after passing. Acceptance: every requirement in these families has current exact passing evidence or a justified contract-defined expected rejection, zero unimplemented required behavior, zero unexecuted required variants and no unresolved family entries. Newly discovered dependencies must be closed and rerun before this task can finish.
    status:
      implement: open
      test: open
      commit: open
  - id: complete-opc-xml-image-case-adaptations
    title: Complete exact OPC, XML and image case adaptations
    prompt: |
      Apply the bounded execution policy in this plan’s step prompts. Before starting the scope below, estimate its size. If it exceeds one bounded checkpoint, split it into explicit tasks with exact obligation IDs/test or fixture names before this task; retain this task as the final reconciliation gate for its original scope. Gate tasks inspect receipts and schedule missing work rather than recursively doing all of it. Full-suite, independent rendering and publication gates keep their required checks and are monitored once; the 45-minute target does not waive any check.

      Work on main in /Users/kjopek/Workspace/poe-setup-scripts. Read root AGENTS.md and any scoped AGENTS.md before edits. docs/specs/docx.md is the format contract; docs/specs/office-cli.md and docs/specs/office-sdk.md govern parity. Validate each gap against current code before changing it; use original failing tests before code and memfs for unit file operations. Keep product logic in its package, preserve unrelated edits/index entries and historical evidence, and use only maintained uncached checks. Keep DOCX an explicit opt-in; never add it to default agent commands or their browser closure. Record executed evidence under docs/docx and QA procedures under docs/plans. Commit only verified owned files with atomic Conventional Commits; do not push or publish before the final acceptance/release task. Do not lower requirements, erase cases, or count skipped/unrun/mapping-only evidence as passes.

      Read docs/docx/upstream-test-inventory.json, test-case-map.json, test-case-source-evidence.json, upstream-test-completeness.md, test-case-map-notes.md and all current exact overlays. Complete the OPC/XML/image portion of the full 1,609 unit-variant plus 650 expanded-BDD denominator. Review the 369-row exact overlay and its remaining qualification limits; do not assume its presence proves all bound variants. Original TS tests must assert each precise value, error, edge binding, sequence and public workflow obligation using original small memfs fixtures; never generate product tests from reference IDs, source test code or inventory labels. Keep identities and provenance only in research crosswalks and required standalone legal notices. Use validated JS architecture dispositions only for source-runtime mechanics whose observable replacement is actually tested; missing public functionality is not such a disposition. Record exact named passing test links and current execution receipts per source identity, including all shared language/security obligations. Acceptance: zero unmapped, unadapted, unexecuted, missing/duplicate/orphan identities in this group; overlap/equivalence justified without changing the global denominator or hiding skipped cases.
    status:
      implement: open
      test: open
      commit: open
  - id: complete-text-style-document-case-adaptations
    title: Complete exact text, style and document case adaptations
    prompt: |
      Apply the bounded execution policy in this plan’s step prompts. Before starting the scope below, estimate its size. If it exceeds one bounded checkpoint, split it into explicit tasks with exact obligation IDs/test or fixture names before this task; retain this task as the final reconciliation gate for its original scope. Gate tasks inspect receipts and schedule missing work rather than recursively doing all of it. Full-suite, independent rendering and publication gates keep their required checks and are monitored once; the 45-minute target does not waive any check.

      Work on main in /Users/kjopek/Workspace/poe-setup-scripts. Read root AGENTS.md and any scoped AGENTS.md before edits. docs/specs/docx.md is the format contract; docs/specs/office-cli.md and docs/specs/office-sdk.md govern parity. Validate each gap against current code before changing it; use original failing tests before code and memfs for unit file operations. Keep product logic in its package, preserve unrelated edits/index entries and historical evidence, and use only maintained uncached checks. Keep DOCX an explicit opt-in; never add it to default agent commands or their browser closure. Record executed evidence under docs/docx and QA procedures under docs/plans. Commit only verified owned files with atomic Conventional Commits; do not push or publish before the final acceptance/release task. Do not lower requirements, erase cases, or count skipped/unrun/mapping-only evidence as passes.

      Read docs/docx/upstream-test-inventory.json, test-case-map.json, test-case-source-evidence.json, upstream-test-completeness.md, test-case-map-notes.md and all current exact overlays. Complete the text/style/document/numbering and value/enum portion of the full 1,609 unit-variant plus 650 expanded-BDD denominator. The September 16 teardown retains 1,020 rows outside the reviewed exact overlays; derive actual membership and close every remaining obligation rather than adding a count-only receipt. Original TS tests must assert each precise value, error, edge binding, sequence and public workflow obligation using original small memfs fixtures; never generate product tests from reference IDs, source test code or inventory labels. Keep identities and provenance only in research crosswalks and required standalone legal notices. Use validated JS architecture dispositions only for source-runtime mechanics whose observable replacement is actually tested; missing public functionality is not such a disposition. Record exact named passing test links and current execution receipts per source identity, including all shared language/security obligations. Acceptance: zero unmapped, unadapted, unexecuted, missing/duplicate/orphan identities in this group; overlap/equivalence justified without changing the global denominator or hiding skipped cases.
    status:
      implement: open
      test: open
      commit: open
  - id: complete-table-bdd-case-adaptations
    title: Complete exact table and BDD case adaptations
    prompt: |
      Apply the bounded execution policy in this plan’s step prompts. Before starting the scope below, estimate its size. If it exceeds one bounded checkpoint, split it into explicit tasks with exact obligation IDs/test or fixture names before this task; retain this task as the final reconciliation gate for its original scope. Gate tasks inspect receipts and schedule missing work rather than recursively doing all of it. Full-suite, independent rendering and publication gates keep their required checks and are monitored once; the 45-minute target does not waive any check.

      Work on main in /Users/kjopek/Workspace/poe-setup-scripts. Read root AGENTS.md and any scoped AGENTS.md before edits. docs/specs/docx.md is the format contract; docs/specs/office-cli.md and docs/specs/office-sdk.md govern parity. Validate each gap against current code before changing it; use original failing tests before code and memfs for unit file operations. Keep product logic in its package, preserve unrelated edits/index entries and historical evidence, and use only maintained uncached checks. Keep DOCX an explicit opt-in; never add it to default agent commands or their browser closure. Record executed evidence under docs/docx and QA procedures under docs/plans. Commit only verified owned files with atomic Conventional Commits; do not push or publish before the final acceptance/release task. Do not lower requirements, erase cases, or count skipped/unrun/mapping-only evidence as passes.

      Read docs/docx/upstream-test-inventory.json, test-case-map.json, test-case-source-evidence.json, upstream-test-completeness.md, test-case-map-notes.md and all current exact overlays. Complete the tables and all 650 expanded BDD workflows portion of the full 1,609 unit-variant plus 650 expanded-BDD denominator. Review the 870-row table/all-BDD overlay, including overlapping workflow/style overlays counted once; execute all bound variants and independent expected observations. Original TS tests must assert each precise value, error, edge binding, sequence and public workflow obligation using original small memfs fixtures; never generate product tests from reference IDs, source test code or inventory labels. Keep identities and provenance only in research crosswalks and required standalone legal notices. Use validated JS architecture dispositions only for source-runtime mechanics whose observable replacement is actually tested; missing public functionality is not such a disposition. Record exact named passing test links and current execution receipts per source identity, including all shared language/security obligations. Acceptance: zero unmapped, unadapted, unexecuted, missing/duplicate/orphan identities in this group; overlap/equivalence justified without changing the global denominator or hiding skipped cases.
    status:
      implement: open
      test: open
      commit: open
  - id: accept-all-public-types-guides
    title: Verify every public row, guide heading and consumer type
    prompt: |
      Apply the bounded execution policy in this plan’s step prompts. Before starting the scope below, estimate its size. If it exceeds one bounded checkpoint, split it into explicit tasks with exact obligation IDs/test or fixture names before this task; retain this task as the final reconciliation gate for its original scope. Gate tasks inspect receipts and schedule missing work rather than recursively doing all of it. Full-suite, independent rendering and publication gates keep their required checks and are monitored once; the 45-minute target does not waive any check.

      Work on main in /Users/kjopek/Workspace/poe-setup-scripts. Read root AGENTS.md and any scoped AGENTS.md before edits. docs/specs/docx.md is the format contract; docs/specs/office-cli.md and docs/specs/office-sdk.md govern parity. Validate each gap against current code before changing it; use original failing tests before code and memfs for unit file operations. Keep product logic in its package, preserve unrelated edits/index entries and historical evidence, and use only maintained uncached checks. Keep DOCX an explicit opt-in; never add it to default agent commands or their browser closure. Record executed evidence under docs/docx and QA procedures under docs/plans. Commit only verified owned files with atomic Conventional Commits; do not push or publish before the final acceptance/release task. Do not lower requirements, erase cases, or count skipped/unrun/mapping-only evidence as passes.

      Use docs/docx/public-api-map.json, upstream-api-inventory.json, whole-api-resumption.json, whole-api-acceptance.json and guide-whole-api-workflows.test.ts to qualify all 1,337 public rows over 920 inventoried IDs, including 262 enum values, family aliases, inherited/returned/helpers and public underscore types. Validate current counts and complete every row's exact semantics, not just export presence. Complete all twelve guide files and every substantive guide heading, all eleven registered workflows and their parameter/language/security variants through public model, SDK and actual CLI; existing thirteen finite workflows and five raster probes are a baseline only. Test strict consumer types, sequences/keys/slices, nullable/default/sentinel values, exact units/rounding, bytes, UTC dates, stale/bounds/key errors and asynchronous admission/save with independent reload assertions. Acceptance: zero unresolved public rows or guide obligations, exact current behavior/type evidence for every row, and no whole-API acceptance based only on mapping counts.
    status:
      implement: open
      test: open
      commit: open
  - id: qualify-all-cli-sdk-conformance
    title: Execute every-command SDK parity and cross-format QA
    prompt: |
      Apply the bounded execution policy in this plan’s step prompts. Before starting the scope below, estimate its size. If it exceeds one bounded checkpoint, split it into explicit tasks with exact obligation IDs/test or fixture names before this task; retain this task as the final reconciliation gate for its original scope. Gate tasks inspect receipts and schedule missing work rather than recursively doing all of it. Full-suite, independent rendering and publication gates keep their required checks and are monitored once; the 45-minute target does not waive any check.

      Work on main in /Users/kjopek/Workspace/poe-setup-scripts. Read root AGENTS.md and any scoped AGENTS.md before edits. docs/specs/docx.md is the format contract; docs/specs/office-cli.md and docs/specs/office-sdk.md govern parity. Validate each gap against current code before changing it; use original failing tests before code and memfs for unit file operations. Keep product logic in its package, preserve unrelated edits/index entries and historical evidence, and use only maintained uncached checks. Keep DOCX an explicit opt-in; never add it to default agent commands or their browser closure. Record executed evidence under docs/docx and QA procedures under docs/plans. Commit only verified owned files with atomic Conventional Commits; do not push or publish before the final acceptance/release task. Do not lower requirements, erase cases, or count skipped/unrun/mapping-only evidence as passes.

      Read docs/specs/office-cli.md, office-sdk.md, docs/docx/cross-format-cli-conformance*.md, office-cli-execution-20260916.md and paired command acceptance records. Execute every declared DOCX operation through its SDK and real command-engine/Shell route with identical arguments and independently checked results/effects. Pair applicable Office commands with PPTX to verify common grammar, plural resources, selectors, flags, schema/help, JSON envelope, stdout/stderr, exit classes including diff and 130 cancellation, and read affected=0. Complete earlier skipped/unrun cases, auxiliary file/stdin/binary transport injection, source/path security, advanced templates, collision/publication/cleanup failures and discovery failure diagnostics. Retain real failing observations and use TDD for required corrections. Inspect fresh terminal screenshots for changed visual paths and human/JSON recovery. Acceptance: every required command capability has current real SDK/Shell parity evidence and all shared conformance cases pass without unavailable routes counted as passes.
    status:
      implement: open
      test: open
      commit: open
  - id: qualify-malformed-lifecycle-budgets
    title: Close malformed-input, authority, cancellation and publication evidence
    prompt: |
      Apply the bounded execution policy in this plan’s step prompts. Before starting the scope below, estimate its size. If it exceeds one bounded checkpoint, split it into explicit tasks with exact obligation IDs/test or fixture names before this task; retain this task as the final reconciliation gate for its original scope. Gate tasks inspect receipts and schedule missing work rather than recursively doing all of it. Full-suite, independent rendering and publication gates keep their required checks and are monitored once; the 45-minute target does not waive any check.

      Work on main in /Users/kjopek/Workspace/poe-setup-scripts. Read root AGENTS.md and any scoped AGENTS.md before edits. docs/specs/docx.md is the format contract; docs/specs/office-cli.md and docs/specs/office-sdk.md govern parity. Validate each gap against current code before changing it; use original failing tests before code and memfs for unit file operations. Keep product logic in its package, preserve unrelated edits/index entries and historical evidence, and use only maintained uncached checks. Keep DOCX an explicit opt-in; never add it to default agent commands or their browser closure. Record executed evidence under docs/docx and QA procedures under docs/plans. Commit only verified owned files with atomic Conventional Commits; do not push or publish before the final acceptance/release task. Do not lower requirements, erase cases, or count skipped/unrun/mapping-only evidence as passes.

      Read the full DOCX and shared Office contracts, current hostile-input/lifecycle reviews, packages/docx publication/I/O/budget/model transaction code and scoped safe-bash instructions. Execute all required ZIP/XML/OPC and document-graph corruption cases, including ambiguous headers/paths/relationships, unsupported profiles, dirty-part preservation and graph validation. Complete cancellation at admission/read/edit/save/cleanup, falsey primary errors, model changes across awaits, caller-owned byte reuse, limit charging, aliases/symlinks/foreign handles, output collisions and atomic/explicit partial multi-file failures. Reproduce defects before minimal domain fixes and preserve original failure captures. No LLM queries, ambient host/network authority, optional private-profile synthesis or real filesystem unit fixtures. Acceptance: all required hostile/fault/resource paths have precise passing assertions, cleanup ownership holds, and no TODO, skipped obligation, timeout or unbounded path remains unexplained.
    status:
      implement: open
      test: open
      commit: open
  - id: qualify-large-dense-language-profiles
    title: Complete large/dense and substantive language profiles
    prompt: |
      Apply the bounded execution policy in this plan’s step prompts. Before starting the scope below, estimate its size. If it exceeds one bounded checkpoint, split it into explicit tasks with exact obligation IDs/test or fixture names before this task; retain this task as the final reconciliation gate for its original scope. Gate tasks inspect receipts and schedule missing work rather than recursively doing all of it. Full-suite, independent rendering and publication gates keep their required checks and are monitored once; the 45-minute target does not waive any check.

      Work on main in /Users/kjopek/Workspace/poe-setup-scripts. Read root AGENTS.md and any scoped AGENTS.md before edits. docs/specs/docx.md is the format contract; docs/specs/office-cli.md and docs/specs/office-sdk.md govern parity. Validate each gap against current code before changing it; use original failing tests before code and memfs for unit file operations. Keep product logic in its package, preserve unrelated edits/index entries and historical evidence, and use only maintained uncached checks. Keep DOCX an explicit opt-in; never add it to default agent commands or their browser closure. Record executed evidence under docs/docx and QA procedures under docs/plans. Commit only verified owned files with atomic Conventional Commits; do not push or publish before the final acceptance/release task. Do not lower requirements, erase cases, or count skipped/unrun/mapping-only evidence as passes.

      Read docs/docx/corpus-feature-gaps.md, corpus manifest/report, large-document profile evidence and the normative budgets. Reacquire legitimately available inputs only for the campaign and author original missing-regime stress inputs; existing downloaded/parsed inputs and two scoped large/dense passes do not qualify every required regime. Execute actual admission, full save/reload and targeted edits for required compressed/expanded/XML/member/depth/text/resource regimes, plus meaningful RTL and CJK shaping-relevant document structures and nontrivial endnotes/review/graphics. Trusted limits are explicit; command flags cannot raise them. Measure actual time/work/retained bytes and cancellation; profile success is not universal completion or a font-fidelity claim. Preserve failing measurements and fix algorithmic/timeouts with original reductions, without enlarging budgets to disguise defects. Acceptance: every required size/language profile is executed and passes its declared contract, and no missing native input, unrun edit or borrowed profile is recorded as success.
    status:
      implement: open
      test: open
      commit: open
  - id: execute-independent-schema-interoperability
    title: Complete independent schema and interoperability validation
    prompt: |
      Apply the bounded execution policy in this plan’s step prompts. Before starting the scope below, estimate its size. If it exceeds one bounded checkpoint, split it into explicit tasks with exact obligation IDs/test or fixture names before this task; retain this task as the final reconciliation gate for its original scope. Gate tasks inspect receipts and schedule missing work rather than recursively doing all of it. Full-suite, independent rendering and publication gates keep their required checks and are monitored once; the 45-minute target does not waive any check.

      Work on main in /Users/kjopek/Workspace/poe-setup-scripts. Read root AGENTS.md and any scoped AGENTS.md before edits. docs/specs/docx.md is the format contract; docs/specs/office-cli.md and docs/specs/office-sdk.md govern parity. Validate each gap against current code before changing it; use original failing tests before code and memfs for unit file operations. Keep product logic in its package, preserve unrelated edits/index entries and historical evidence, and use only maintained uncached checks. Keep DOCX an explicit opt-in; never add it to default agent commands or their browser closure. Record executed evidence under docs/docx and QA procedures under docs/plans. Commit only verified owned files with atomic Conventional Commits; do not push or publish before the final acceptance/release task. Do not lower requirements, erase cases, or count skipped/unrun/mapping-only evidence as passes.

      Read docs/docx/independent-schema-validation.md, standards-audit-evidence.md, verification records, DOCX normative schema/MCE obligations and the recorded setup-prerequisite failures. Obtain/verify legally usable independent validation tools and pinned schema artifacts as QA-only resources; none enter product/build dependencies. Validate fresh baseline/edit/save/pack outputs across Strict/Transitional and required feature/extension/MCE variants, with independent relationship/content-type checks and intentional invalid controls. Resolve missing setup prerequisites and uncovered schema descendants instead of narrowing the grammar acceptance claim. Reproduce product findings with original memfs regressions before fixes. Record tool/version/input/output hashes, complete processed descendants and actual results. Acceptance: all required schema/interoperability paths execute with zero unresolved validation failures or unprocessed required descendants; setup absence is a failed gate, never a passing test.
    status:
      implement: open
      test: open
      commit: open
  - id: execute-full-corpus-repair-free-render-qa
    title: Complete repair-free document opening and visual QA
    prompt: |
      Apply the bounded execution policy in this plan’s step prompts. Before starting the scope below, estimate its size. If it exceeds one bounded checkpoint, split it into explicit tasks with exact obligation IDs/test or fixture names before this task; retain this task as the final reconciliation gate for its original scope. Gate tasks inspect receipts and schedule missing work rather than recursively doing all of it. Full-suite, independent rendering and publication gates keep their required checks and are monitored once; the 45-minute target does not waive any check.

      Work on main in /Users/kjopek/Workspace/poe-setup-scripts. Read root AGENTS.md and any scoped AGENTS.md before edits. docs/specs/docx.md is the format contract; docs/specs/office-cli.md and docs/specs/office-sdk.md govern parity. Validate each gap against current code before changing it; use original failing tests before code and memfs for unit file operations. Keep product logic in its package, preserve unrelated edits/index entries and historical evidence, and use only maintained uncached checks. Keep DOCX an explicit opt-in; never add it to default agent commands or their browser closure. Record executed evidence under docs/docx and QA procedures under docs/plans. Commit only verified owned files with atomic Conventional Commits; do not push or publish before the final acceptance/release task. Do not lower requirements, erase cases, or count skipped/unrun/mapping-only evidence as passes.

      Write and execute a markdown QA procedure under docs/plans covering the DOCX corpus/text/image campaigns, visual-qa.md and teardown-verification-20260916.md obligations. Reacquire required legitimately available inputs; record source rights, hashes and explicit ownership. Use independent desktop Word repair-free opening and the required independent renderer(s), including font-complete RTL/CJK, baseline versus edited/saved/packed outputs, tables/sections/headers/notes/review/fields/images/floating/vector/charts/diagrams/OMML. Inspect all pages required by the acceptance campaign; prior 88 pages/four pairs and 29 representative image pages are bounded historical evidence, not exhaustive acceptance. Inspect terminal screenshots for all visually affected CLI paths and resolve missing glyph evidence. Reduce discovered defects to original small regressions before package fixes and rerender after changes. Acceptance: every required rendering/repair/language/feature scenario actually executes and passes with retained review evidence. If desktop Word, fonts, schemas or corpus rights are unavailable, record the precise external blocker and leave acceptance/release open; do not substitute partial rendering as completion.
    status:
      implement: open
      test: open
      commit: open
  - id: fix-ci-native-trap-comparisons
    title: Fix Linux native trap fixture or semantic failures
    prompt: |
      Apply the bounded execution policy in this plan’s step prompts. Before starting the scope below, estimate its size. If it exceeds one bounded checkpoint, split it into explicit tasks with exact obligation IDs/test or fixture names before this task; retain this task as the final reconciliation gate for its original scope. Gate tasks inspect receipts and schedule missing work rather than recursively doing all of it. Full-suite, independent rendering and publication gates keep their required checks and are monitored once; the 45-minute target does not waive any check.

      Work on main in /Users/kjopek/Workspace/poe-setup-scripts. Read root AGENTS.md and any scoped AGENTS.md before edits. docs/specs/docx.md is the format contract; docs/specs/office-cli.md and docs/specs/office-sdk.md govern parity. Validate each gap against current code before changing it; use original failing tests before code and memfs for unit file operations. Keep product logic in its package, preserve unrelated edits/index entries and historical evidence, and use only maintained uncached checks. Keep DOCX an explicit opt-in; never add it to default agent commands or their browser closure. Record executed evidence under docs/docx and QA procedures under docs/plans. Commit only verified owned files with atomic Conventional Commits; do not push or publish before the final acceptance/release task. Do not lower requirements, erase cases, or count skipped/unrun/mapping-only evidence as passes.

      Reproduce the failed native RETURN/EXIT/DEBUG/ERR/source cases from GitHub Release run 35100165337, Bash shard jobs 104808922513 and 104808922619. Read packages/safe-bash/tests/shell/extensions/trap/oracle.ts, review.test.ts and lifecycle.test.ts and scoped safe-bash instructions. Relevant failures are nested function/source RETURN scopes and source shares handler/source exit/child script/RETURN source/DEBUG source with trace and restoring handler/source ERR inherited/RETURN and EXIT source arguments. Authenticate the same GNU Bash 5.2.37 oracle and inspect exact stdout, stderr, status and stdin descriptor/source binding on Linux. Determine whether fixtures fail to reopen /dev/stdin or whether actual shell semantics disagree; never assume a harness cause or alter expected semantics without concrete evidence. Add original mocked or memfs regressions for validated harness/product corrections before code; keep native behavioral assertions and historical seals. Acceptance: every original failed native scenario and adjacent trap/oracle tests pass against authenticated Bash on Linux, with no skip, looser comparator or test deletion; any virtual-shell correction retains default/opt-in behavior.
    status:
      implement: open
      test: open
      commit: open
  - id: fix-ci-native-read-and-yes-comparisons
    title: Fix Linux read-deadline and yes native oracle failures
    prompt: |
      Apply the bounded execution policy in this plan’s step prompts. Before starting the scope below, estimate its size. If it exceeds one bounded checkpoint, split it into explicit tasks with exact obligation IDs/test or fixture names before this task; retain this task as the final reconciliation gate for its original scope. Gate tasks inspect receipts and schedule missing work rather than recursively doing all of it. Full-suite, independent rendering and publication gates keep their required checks and are monitored once; the 45-minute target does not waive any check.

      Work on main in /Users/kjopek/Workspace/poe-setup-scripts. Read root AGENTS.md and any scoped AGENTS.md before edits. docs/specs/docx.md is the format contract; docs/specs/office-cli.md and docs/specs/office-sdk.md govern parity. Validate each gap against current code before changing it; use original failing tests before code and memfs for unit file operations. Keep product logic in its package, preserve unrelated edits/index entries and historical evidence, and use only maintained uncached checks. Keep DOCX an explicit opt-in; never add it to default agent commands or their browser closure. Record executed evidence under docs/docx and QA procedures under docs/plans. Commit only verified owned files with atomic Conventional Commits; do not push or publish before the final acceptance/release task. Do not lower requirements, erase cases, or count skipped/unrun/mapping-only evidence as passes.

      Reproduce run 35100165337 Bash shard job 104808922443 failures in packages/safe-bash/tests/commands/yes/native.test.ts and packages/safe-bash/tests/shell/extensions/arrays/input-deadlines.test.ts. Inspect why the short yes consumer reports null rather than SIGPIPE, why read -t0 on EOF differs, and why timed partial completed/trailing escapes omit the expected 0x01 byte on Linux. Authenticate GNU Bash 5.2.37 and any required pinned GNU coreutils profile; capture exact descriptor kind, locale, ignored-signal inheritance, stdout/stderr/status, timing and field bytes. Separate native profile/fixture assumptions from required shell compatibility defects with concrete probes. Add failing original tests before any source/harness correction; do not branch expected output merely to hide a discrepancy or count absent profiles as passes. Acceptance: the original failing native cases and neighboring read/input/yes tests pass in GitHub's Linux environment and locally under the same admitted profiles; no timeout, race, undocumented platform assumption or weaker behavior assertion remains.
    status:
      implement: open
      test: open
      commit: open
  - id: verify-settled-packed-consumers-opt-in
    title: Verify settled package consumers and default-preset isolation
    prompt: |
      Apply the bounded execution policy in this plan’s step prompts. Before starting the scope below, estimate its size. If it exceeds one bounded checkpoint, split it into explicit tasks with exact obligation IDs/test or fixture names before this task; retain this task as the final reconciliation gate for its original scope. Gate tasks inspect receipts and schedule missing work rather than recursively doing all of it. Full-suite, independent rendering and publication gates keep their required checks and are monitored once; the 45-minute target does not waive any check.

      Work on main in /Users/kjopek/Workspace/poe-setup-scripts. Read root AGENTS.md and any scoped AGENTS.md before edits. docs/specs/docx.md is the format contract; docs/specs/office-cli.md and docs/specs/office-sdk.md govern parity. Validate each gap against current code before changing it; use original failing tests before code and memfs for unit file operations. Keep product logic in its package, preserve unrelated edits/index entries and historical evidence, and use only maintained uncached checks. Keep DOCX an explicit opt-in; never add it to default agent commands or their browser closure. Record executed evidence under docs/docx and QA procedures under docs/plans. Commit only verified owned files with atomic Conventional Commits; do not push or publish before the final acceptance/release task. Do not lower requirements, erase cases, or count skipped/unrun/mapping-only evidence as passes.

      Run the normal maintained npm run build after all runtime readers finish, then verify the actual settled root tarball in isolated consumers with declared dependencies and no workspace source/declaration fallback. Exercise DOCX model admission/edit/save/reload, all required binary output/capability forms, actual engine plus explicit Shell plugin, and representative public/returned/helper types under strict NodeNext and real browser/worker hosts with appropriate resolution conditions. Verify portable closure has no unexpected external imports and input hashes bind the final distribution and archive. Test createAgentCommands(), agentCommands(), default Node/browser Shell and default agent preset registration/closure: no DOCX command or document-engine import before explicit opt-in; docx execution returns command-not-found and explicit opt-in works. Maintain the existing docx-registration and docx-export tests and screenshots for any changed CLI. Acceptance: complete required consumer matrix passes from final packed bytes, legitimate optional peers are tested under their declared forms, and DOCX remains absent from every default preset and its dependency closure.
    status:
      implement: open
      test: open
      commit: open
  - id: close-entire-acceptance-register
    title: Close the full acceptance register without reducing scope
    prompt: |
      Apply the bounded execution policy in this plan’s step prompts. Before starting the scope below, estimate its size. If it exceeds one bounded checkpoint, split it into explicit tasks with exact obligation IDs/test or fixture names before this task; retain this task as the final reconciliation gate for its original scope. Gate tasks inspect receipts and schedule missing work rather than recursively doing all of it. Full-suite, independent rendering and publication gates keep their required checks and are monitored once; the 45-minute target does not waive any check.

      Work on main in /Users/kjopek/Workspace/poe-setup-scripts. Read root AGENTS.md and any scoped AGENTS.md before edits. docs/specs/docx.md is the format contract; docs/specs/office-cli.md and docs/specs/office-sdk.md govern parity. Validate each gap against current code before changing it; use original failing tests before code and memfs for unit file operations. Keep product logic in its package, preserve unrelated edits/index entries and historical evidence, and use only maintained uncached checks. Keep DOCX an explicit opt-in; never add it to default agent commands or their browser closure. Record executed evidence under docs/docx and QA procedures under docs/plans. Commit only verified owned files with atomic Conventional Commits; do not push or publish before the final acceptance/release task. Do not lower requirements, erase cases, or count skipped/unrun/mapping-only evidence as passes.

      Independently re-audit docs/specs/docx.md and shared Office contracts against the current requirement backlog, all F01-F50 family receipts, 920 API IDs/1,337 rows, 2,259 exact source cases, 262 enum values, twelve guides, eleven workflow registrations, operation map and real consumer/CLI/schema/render/lifecycle evidence. Join actual current identities and hashes, explicitly checking missing/duplicates/orphans and later changes invalidating earlier evidence. Every original acceptance limitation, including nine omitted style operations, async capabilities/save, nullable alignment, paragraph element and numbering creation, must be resolved or a contract-defined expected behavior with precise passing proof; a required missing behavior cannot become an architecture disposition. Run measured behavior/coverage audits and close uncovered branches/error paths required by the contract; percentages alone are insufficient. Preserve historical partial records while writing a clearly current verified register and truthful spec implemented-through SHA. Acceptance: zero open required behavior/type/command/case/guide/fault/schema/render/consumer obligations, no fabricated passes or weakened requirements, and independent verification of the complete register. Any blocker keeps this task and release open.
    status:
      implement: open
      test: open
      commit: open
  - id: verify-clean-maintained-release-gates
    title: Pass clean maintained build, lint and full unit gates
    prompt: |
      Apply the bounded execution policy in this plan’s step prompts. Before starting the scope below, estimate its size. If it exceeds one bounded checkpoint, split it into explicit tasks with exact obligation IDs/test or fixture names before this task; retain this task as the final reconciliation gate for its original scope. Gate tasks inspect receipts and schedule missing work rather than recursively doing all of it. Full-suite, independent rendering and publication gates keep their required checks and are monitored once; the 45-minute target does not waive any check.

      Work on main in /Users/kjopek/Workspace/poe-setup-scripts. Read root AGENTS.md and any scoped AGENTS.md before edits. docs/specs/docx.md is the format contract; docs/specs/office-cli.md and docs/specs/office-sdk.md govern parity. Validate each gap against current code before changing it; use original failing tests before code and memfs for unit file operations. Keep product logic in its package, preserve unrelated edits/index entries and historical evidence, and use only maintained uncached checks. Keep DOCX an explicit opt-in; never add it to default agent commands or their browser closure. Record executed evidence under docs/docx and QA procedures under docs/plans. Commit only verified owned files with atomic Conventional Commits; do not push or publish before the final acceptance/release task. Do not lower requirements, erase cases, or count skipped/unrun/mapping-only evidence as passes.

      After full DOCX acceptance is closed, commit all verified task-owned changes on main before committed-HEAD consumer tests. The earlier full npm test at 4e2e26229 integration reported 38,870 virtual-bash passes, 823 skips and one pre-merge-HEAD packed-export failure; its complete 221-test rerun passed, but that is not a clean full npm test result. Run a new normal npm run build, then a clean full npm test and repository-wide lint appropriate to the cross-workspace change, plus npm run lint:packages and required consumer/type/workflow/native routes. Use maintained declaration-driven, uncached execution and native npm lifecycles; do not substitute root-only test:unit or fixed task counts. Scope SAFE_BASH_TEST_RG, SAFEJS_LOCAL_ROOT, S3_HTTP_EXPORTS_REVISION and FULL_GATE_ROOT only to the actual virtual-bash unit child, clear repository-local Git hook variables before unit children, and do not synthesize optional profiles. Sequence builds, runtime checks and screenshot-triggered builds to avoid chunk invalidation. Fix all failing tests/timeouts with validated TDD, and rerun affected checks until the whole maintained command passes. Preserve skips as skips and ensure none is an open acceptance obligation. Acceptance: clean successful final full gates on the committed revision, matching packed artifact and no unresolved GitHub/native failures.
    status:
      implement: open
      test: open
      commit: open
  - id: retire-owned-campaign-inputs
    title: Retire only disposable QA inputs after preserving evidence
    prompt: |
      Work on main in /Users/kjopek/Workspace/poe-setup-scripts. Read root AGENTS.md and any scoped AGENTS.md before edits. docs/specs/docx.md is the format contract; docs/specs/office-cli.md and docs/specs/office-sdk.md govern parity. Validate each gap against current code before changing it; use original failing tests before code and memfs for unit file operations. Keep product logic in its package, preserve unrelated edits/index entries and historical evidence, and use only maintained uncached checks. Keep DOCX an explicit opt-in; never add it to default agent commands or their browser closure. Record executed evidence under docs/docx and QA procedures under docs/plans. Commit only verified owned files with atomic Conventional Commits; do not push or publish before the final acceptance/release task. Do not lower requirements, erase cases, or count skipped/unrun/mapping-only evidence as passes.

      Read DOCX corpus manifests and cleanup evidence, and inventory current campaign-owned disposable inputs. Prior teardown verified 23 source paths absent and 36 retained unlisted cache hashes unchanged; do not recreate or delete them by assumption. Before removing any newly acquired disposable source, preserve useful original reductions, legal/provenance notices, independently reviewed outputs/screenshots, hashes and acceptance receipts. Remove only explicitly owned disposable campaign files once no required validation depends on them; preserve unowned output/docx-* files, other workers' edits, archival plans, retained references and unlisted cache artifacts. No guessed recursive cleanup or ignored-file commits. Acceptance: all acceptance evidence remains reproducible from retained permitted artifacts/original regressions, every removed owned input has an explicit receipt, and unowned paths/hashes are unchanged.
    status:
      implement: open
      commit: open
  - id: publish-only-after-complete-acceptance
    title: Deliver accepted DOCX on main and verify successful release
    prompt: |
      Work on main in /Users/kjopek/Workspace/poe-setup-scripts. Read root AGENTS.md and any scoped AGENTS.md before edits. docs/specs/docx.md is the format contract; docs/specs/office-cli.md and docs/specs/office-sdk.md govern parity. Validate each gap against current code before changing it; use original failing tests before code and memfs for unit file operations. Keep product logic in its package, preserve unrelated edits/index entries and historical evidence, and use only maintained uncached checks. Keep DOCX an explicit opt-in; never add it to default agent commands or their browser closure. Record executed evidence under docs/docx and QA procedures under docs/plans. Commit only verified owned files with atomic Conventional Commits; do not push or publish before the final acceptance/release task. Do not lower requirements, erase cases, or count skipped/unrun/mapping-only evidence as passes.

      User authorization is to release DOCX, keep it out of the default agent preset, and leave no required acceptance gaps. Recheck the current whole acceptance register is closed and final maintained gates passed, with authorized package READMEs, no unexpected source changes and all task-owned atomic commits on main. If any requirement, CI failure or essential external QA dependency is unresolved, do not push a release-enabling change or claim completion. Otherwise push verified main without bypassing hooks; confirm remote refs/heads/main contains the exact delivery SHA. Monitor the corresponding GitHub Release workflow through build/audit/unit/checks/all Bash shards and successful semantic-release publication; diagnose and fix validated failures rather than stopping at push. Releases happen on GitHub only. Confirm published poe-code@latest version, release/tag commit and actual package exports, notices, config docs and DOCX opt-in/default closure. If semantic-release finds no eligible change, inspect retained unreleased feat/fix history and correct legitimate release wiring without a fabricated feature commit. Acceptance: local commits, verified remote-main delivery and successful registry publication are separately evidenced, published default agent commands still exclude DOCX, and no required DOCX gap remains.
    status:
      implement: open
      test: open
      release: open
finalization: pending
setupCompleted: true
steps:
  implement:
    prompt: |-
      {{prompt}}

      Execution policy for this DOCX plan: use root/scoped AGENTS.md and docs/specs/docx.md, office-cli.md and office-sdk.md. Preserve unrelated work and existing acceptance identities. Keep DOCX opt-in and the final publication gate. Work on one named behavior or at most five exact outstanding obligation IDs per checkpoint; write those IDs and selected checks before editing. Aim for 30 minutes and split work before it exceeds 45 minutes. This is a scheduling target, not a passing criterion. If the selected work cannot fit, insert explicit continuation tasks before its acceptance gate, with exact remaining IDs and checks; leave unfinished work open. A checkpoint can finish only its stated subset. New unrelated findings become separately owned open tasks, never an expanding requirement of the running checkpoint. Use failing original memfs tests before code fixes. Run maintained uncached checks for the changed scope; npm test -- --no-cache --workspace=docx --test-file=packages/docx/src/NAME.test.ts selects exact files through the declared runner; repeat --test-file for additional files. Do not append positional test paths to the workspace command: Vitest combines them with the existing packages/docx selector and can run the whole package. Exact-file mode does not accept native test arguments; use its supported flags and inspect its dry-run first. Inspect actual membership; do not describe a focused result as a full-suite pass. Use the maintained workspace build only when compiled artifacts are needed or stale. Do not repeatedly rebuild all workspaces, run full DOCX, or generate another native/codec Cartesian product for each small edit. Reuse unchanged historical evidence as historical evidence; rerun affected behavior when sources or dependencies change. Keep existing tests and all required release gates. Record one concise receipt with obligation IDs, command, revision/diff, result, duration and remaining tasks. No background controller chains or duplicate runs; own, monitor and terminate subprocesses when interrupted. Slow or hung tests get a named diagnosis task, never a longer unbounded wait. Commit only explicit verified owned files; no push/publication before the final gate. Do not commit existing unowned modifications.
      Implement only the selected checkpoint. For a gate, reconcile evidence and schedule exact missing work; do not start a new feature audit.
  test:
    prompt: |-
      {{prompt}}

      Execution policy for this DOCX plan: use root/scoped AGENTS.md and docs/specs/docx.md, office-cli.md and office-sdk.md. Preserve unrelated work and existing acceptance identities. Keep DOCX opt-in and the final publication gate. Work on one named behavior or at most five exact outstanding obligation IDs per checkpoint; write those IDs and selected checks before editing. Aim for 30 minutes and split work before it exceeds 45 minutes. This is a scheduling target, not a passing criterion. If the selected work cannot fit, insert explicit continuation tasks before its acceptance gate, with exact remaining IDs and checks; leave unfinished work open. A checkpoint can finish only its stated subset. New unrelated findings become separately owned open tasks, never an expanding requirement of the running checkpoint. Use failing original memfs tests before code fixes. Run maintained uncached checks for the changed scope; npm test -- --no-cache --workspace=docx --test-file=packages/docx/src/NAME.test.ts selects exact files through the declared runner; repeat --test-file for additional files. Do not append positional test paths to the workspace command: Vitest combines them with the existing packages/docx selector and can run the whole package. Exact-file mode does not accept native test arguments; use its supported flags and inspect its dry-run first. Inspect actual membership; do not describe a focused result as a full-suite pass. Use the maintained workspace build only when compiled artifacts are needed or stale. Do not repeatedly rebuild all workspaces, run full DOCX, or generate another native/codec Cartesian product for each small edit. Reuse unchanged historical evidence as historical evidence; rerun affected behavior when sources or dependencies change. Keep existing tests and all required release gates. Record one concise receipt with obligation IDs, command, revision/diff, result, duration and remaining tasks. No background controller chains or duplicate runs; own, monitor and terminate subprocesses when interrupted. Slow or hung tests get a named diagnosis task, never a longer unbounded wait. Commit only explicit verified owned files; no push/publication before the final gate. Do not commit existing unowned modifications.
      Verify the named acceptance cases and affected neighbors once. Use already executed checks from this checkpoint if the relevant code has not changed; report their exact results. Do not restart implementation or enumerate every possible edge case. On a failure, keep the step open and schedule a bounded fix. Full gates execute their expressly required full checks once and retain the result.
  commit:
    prompt: |-
      {{prompt}}

      Inspect the owned diff and this checkpoint’s executed verification. If relevant code changed since verification, rerun only the affected checks. Commit explicit owned files with a Conventional Commit. Do not rerun a whole suite just to commit, stage unowned work, push, or publish. State the local commit and remaining open tasks.
---

## Completion carried forward on 2026 09 16

The [original implementation plan](docx-typescript-safe-bash.md) retains
**69 of 107 committed tasks done (64.5%)**. Its
[archived working copy](archive/docx-typescript-safe-bash.md) retains the later
107 done declarations; those declarations require the qualification described
in the original plan and the teardown audit. The 30 tasks here address remaining
acceptance and release work, and do not reset the original implementation progress.

The current requirement backlog reconciliation is **implemented (1 of 30
implementation steps, or 3.3%)** based on its
[report](../docx/current-requirement-backlog-20260916.md) and
[accounting validation receipt](../docx/current-requirement-evidence-20260916/accounting-validation.json).
Its commit step remains open because those report and evidence files are
uncommitted in the inspected working tree. Therefore **0 of 30 tasks have every
selected step complete**. No other follow-up task is closed by this update, and
no complete product behavior row, full conformance, remote delivery or release
is newly accepted.

# DOCX remaining acceptance and release

This plan replaces the local release-verification note for the same topic. It is
an ordered backlog, not a claim that the historical 107 tasks establish complete
acceptance. Every task prompt carries its own contract, ownership and exit gate.

The user requires no remaining required gaps and DOCX absent from the default
agent preset. Deliberate contract-defined read/preserve/reject behavior remains
testable behavior; it cannot be used to waive an unimplemented requirement.

At drafting, remote main was verified at `4e2e2622943a6be10a72a9b9b19d5b87611c799c`.
Release run `35100165337` passed build, audit, cached unit and Bash shard 2, but
failed package lint and Bash shards 1, 3 and 4; the fresh unit job was still active.
The three authorized READMEs now exist locally and all 17 package-lint rules pass.
That local correction is not a completed push or successful release.

The initial tasks resolve concrete APIs and declaration drift; family tasks
close all normative behavior; exact case and guide tasks close evidence coverage.
Fault, large/language, independent schema/render and real consumer tasks supply
the remaining acceptance gates. Full reconciliation and clean maintained checks
precede the single final publication step.

# Historical local release verification

The following retains the earlier note as historical evidence; its statement
about publishing before whole acceptance is superseded by the gates above.

# DOCX release verification

Release DOCX as an explicit opt-in. Existing default agent registration tests
assert absence from createAgentCommands and Shell, and exit 127 before opt-in.
Whole-API acceptance remains partial; publication does not establish full parity.

Reproduced the PPTX extraction test failure with the original memfs scenario:
19 of 20 selected Node tests passed; successful extraction reported affected=0
against an expected 2. Shared Office CLI read accounting requires zero, also
asserted by the package extraction tests. Correct only this stale assertion and
retain duplicate image publication, exact bytes and input preservation checks.

Integrate current remote main, run maintained full tests, lint and build, then
push main and monitor GitHub Release through successful publication.

## Local verification, September 16

Normal maintained build passed after stopping an overlapping screenshot-triggered
build; the contaminated missing-module result is not product evidence. Full
repository lint passed with zero errors and 14 warnings, including types and
workflow lint. Focused runner/export Vitest: 194 passed. Original DOCX opt-in and
PPTX extraction Node scenarios: 20 passed after the read-count correction.

Full npm test completed root/shared suites and downstream units. Virtual Bash
reported 39,694 tests: 38,870 passed, 823 skipped, one failed. The packed-export
test builds committed HEAD and ran before the merge was committed. After merge
d953f8ca3, its complete original suite passed all 221 tests, including packed
Node runtime and strict consumer types. No other failures were reported. Preserve
the nonzero full-run result separately; do not describe it as a clean full run.
The maintained lint-stress suffix passed both tests separately. Root-help
screenshot completed and was visually inspected. GitHub release gates must
qualify the delivered committed revision before publication is reported.

Logs: /tmp/docx-release-build-final.log, /tmp/docx-release-lint.log,
/tmp/docx-release-tests.log, /tmp/docx-release-exports-recheck.log,
/tmp/docx-release-lint-stress.log and /tmp/docx-release-screenshot-final.log.


# Execution checkpoints, September 23, 2026

The active review test step grouped ten feature families and required every new dependency
to be fixed before completion. The inherited test prompt asked for all edge cases.
At intervention, a serial full-DOCX run had been active for about 22 minutes; an
orphan controller queued six further stages; four native-spacing workers and their
parent had been alive for about 56 hours. Those identified DOCX processes were
terminated and their existing logs retained as incomplete. Their elapsed time is
not a test pass or proof of a product defect. No active pipeline runner was found.

This plan now overrides its own implementation, test and commit prompts, and
subdivides the running family task into ten bounded checkpoints plus an accounting
step. Checkpoints target 30 minutes; work expected to exceed 45 minutes is split
before execution. These are prompt-level scheduling rules, not enforced runtime
timeouts. Each selected subset gets named evidence and an atomic local commit.
All remaining obligations and final release gates stay open until actually verified.
The full DOCX run belongs at a deliberate integration gate, not after every edit.
Broader checks remain required for changes to shared infrastructure.

The pre-intervention local commit is retained at
`refs/backups/docx-before-rebase-20260923`; the dirty plan snapshot is retained
in the main checkout’s Git directory as
`docx-release-before-optimization-20260923.md`. Existing code changes and
completed task statuses were preserved. Resume the pipeline with this revised
plan so a fresh task reads the new prompts; an already-running agent does not
receive them automatically.

## Review-family gate scope before subdivision

Work on main in /Users/kjopek/Workspace/poe-setup-scripts. Read root AGENTS.md and any scoped AGENTS.md before edits. docs/specs/docx.md is the format contract; docs/specs/office-cli.md and docs/specs/office-sdk.md govern parity. Validate each gap against current code before changing it; use original failing tests before code and memfs for unit file operations. Keep product logic in its package, preserve unrelated edits/index entries and historical evidence, and use only maintained uncached checks. Keep DOCX an explicit opt-in; never add it to default agent commands or their browser closure. Record executed evidence under docs/docx and QA procedures under docs/plans. Commit only verified owned files with atomic Conventional Commits; do not push or publish before the final acceptance/release task. Do not lower requirements, erase cases, or count skipped/unrun/mapping-only evidence as passes.

Read docs/specs/docx.md and the current obligation backlog for F25-F30 and F41-F43/F47: classic/modern comments, final/original review, tracked edits and decisions, controls/repeats/bindings, properties, custom XML/glossary, settings/fonts/protection, signatures and ordered/template batches. Inspect the review/comment/control/revision/property/settings/template source/tests, corresponding feature evidence and acceptance-matrix entries. For every normative requirement in these families, independently execute the public model/SDK/actual CLI paths that apply, including boundaries, Strict and Transitional forms, expected read/edit/preserve/reject behavior, and dirty-part/relationship retention. Do not accept the existing bounded milestone or capability label as complete-family evidence. Reproduce every remaining defect with an original failing memfs test before fixing the package-domain implementation; add required behavior rather than reducing scope. Resolve documented missing native/carrier/variant coverage and cross-family interactions, preserving legitimate contract-defined inert/unsupported rejection semantics. Update named requirement-to-test evidence after passing. Acceptance: every requirement in these families has current exact passing evidence or a justified contract-defined expected rejection, zero unimplemented required behavior, zero unexecuted required variants and no unresolved family entries. Newly discovered dependencies must be closed and rerun before this task can finish.

## Exact test selection after rebase

Use `npm test -- --no-cache --workspace=docx --test-file=packages/docx/src/NAME.test.ts`
and repeat `--test-file` for another selected file. The maintained runner validates
file ownership. Appending positional paths to a workspace script can retain its
broad `packages/docx` selector. Exact-file mode rejects native test arguments.
The declaration-derived DOCX build closure currently has five stages; a dry run
selects only the DOCX unit task. This is selection verification, not product
acceptance or evidence that the selected test has passed.

## Integration verification, September 23

All 557 local commits were rebased onto fetched origin/main `9acb4c33a8` through
an isolated checkout. Main was advanced with autostash; the complete pre-existing
tracked diff was restored byte-for-byte and all 6,069 recorded untracked paths
remained present. Historical package/readme changes and retired bundler/consumer
wrappers were reconciled with upstream; current upstream packaging was retained.
The workspace runner merges retain both upstream cache/affected selection and
local explicit workspace/file selection. The runner/lifecycle suite passed 299
checks during integration; subsequent exact-file/routing checks passed after
updating the real-repository consumer assertions for the renamed Safe Bash and
retired optional wrapper. Final targeted assertion replay passed 15 tests.
Pipeline validation and focused runner lint passed. No complete DOCX acceptance,
full repository gate, push or release is claimed by this integration.
````
