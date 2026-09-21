# Task 28: live object model requalification

Execute only `sdk-live-object-model` from the ordered DOCX pipeline. The format
contract remains `docs/specs/docx.md`; shared behavior remains in the office CLI
and SDK specifications. Later tasks remain pending until this task is qualified.

## Baseline and ownership

Execution began on main at `ab1fa8d34101e1e7f61272973f3bc28a842043d8`.
The index was empty. Existing unrelated working-tree edits and untracked files
remain outside this assignment. No branch, push, publication or README edit is
authorized. Root coordinates explicit-path local commits and integration/exports.

- Implementation worker: `packages/docx/src/model-store.ts`,
  `packages/docx/src/block-model.ts`,
  `packages/docx/src/paragraph-content.ts`,
  `packages/docx/src/xml-element-view.ts`,
  `packages/docx/src/model-destructive-handles.test.ts`.
- Root: this execution record, `docs/docx/live-object-model-20260921.json`,
  `packages/docx/src/model-destructive-batch.test.ts`,
  and the task 28 progress entry in `docs/plans/docx-typescript-safe-bash.md`.
- Document signature worker: `packages/docx/src/document-model.ts` and
  `packages/docx/src/document-table-signature.test.ts`, plus the three incorrect
  Document width-call expressions in `packages/docx/src/workflow-behavior-variants.test.ts`.
- Independent acceptance worker: read-only contract/current-code investigation;
  independent review follows the implementation on a different worker.
  After validating stale root import assertions, this worker also owns only the
  import/export-path assertions in `packages/docx/tests/public-shell.cases.ts`;
  all actual public SDK and Shell behavior cases remain required.

No safe-bash guarded product, export, membership or historical seal edits are
assigned. If such changes become necessary, assign literal paths and delegate
their implementation and verification before editing.

## Current inputs

The preparation hashes have changed for the corpus and API reconciliation:

- Corpus manifest: `e6e63838e0d9ae13616d78eb93af384cfbd1aca5a3557606db5d80f4a864b2ff`;
  23 downloaded document records, with separate later campaign/retirement receipts.
- API inventory: `10955a17b17ac1b334c5854ce7048970f9033ddb0408322bef3e3586d19e44ac`;
  920 reconciled records, 39 documentation files, 23 documentation resolutions.
- Test inventory: unchanged
  `14c609ceb775158cb36c0423d24678b4a3e9f09d429085730b28103a759ad797`;
  1,609 unit variants and 650 expanded BDD cases.

These inventories are research accounting, not passing original product tests.
The historical teardown's missing Document/Paragraph/Run assertion must be
checked against current exports rather than accepted as a current defect.

## Procedure

1. Validate task 28 gaps against current admitted SDK objects and explicit
   contracts; reconcile historical wording before changing product behavior.
2. Reproduce destructive replacement handle failures using original small
   in-memory packages; retain the red result in `/out` until reduced.
3. Fix only validated defects through the shared live owner engine. Check
   annotation/property retention, deterministic invalidation, stable siblings,
   preserving replacement and failure rollback.
4. Independently review code, tests and the task's remaining acceptance gaps.
5. Run maintained focused unit checks, fresh selected workspace build closure,
   package unit and lint checks. Record actual results and unavailable evidence.
6. Reduce results into the durable evidence receipt before removing only owned
   temporary output. Commit explicit verified owned paths locally with a
   Conventional Commit; preserve unrelated edits and staging.

Task 28 remains open until its complete public graph and required mappings are
qualified. No corpus, rendering, whole-API or later-task completion follows from
this scoped correction.

## Verified consumer correction

The initial maintained package lint reproduced two missing imports in
`tests/public-shell.cases.ts`. Current root package exports do not advertise
`poe-code/docx` or `poe-code/safe-bash/commands/docx`; both runtime resolutions
fail with `ERR_PACKAGE_PATH_NOT_EXPORTED`. The declared standalone `docx` SDK
and explicit `@poe-platform/safe-bash/commands/docx` plugin resolve to their
built outputs. The consumer now asserts those actual entry points, including
the Document factory, while retaining every existing Shell/SDK behavior case.

Independent verification: all eight built public Shell cases passed with
`node --import tsx --test packages/docx/tests/public-shell.cases.ts`.
The test TypeScript configuration passed. Maintained package lint subsequently
passed, with zero errors and one unchanged type-only unused-variable warning.
These are local built-workspace consumers, not installed-tarball publication
evidence or qualification of the unrelated live safe-bash changes.

## Destructive owner corrections

Original failing tests reproduced identical-text run survival, raw XML child
survival, nullable paragraph rejection, cached-break clear rejection, stale
retained note markers, nullable run creation rejection and silent annotated-cell
marker deletion. The shared model engine now binds XML children to their node
owners, explicitly invalidates discarded content, retains properties and note
markers, and restores handles on failed transactions. Unsafe annotated-cell text
replacement explicitly refuses before mutation; marker-preserving assignment
remains unsupported. Independent review validated identical serialization,
retained raw properties, inserted child removal and rollback.

The [durable receipt](../docx/live-object-model-20260921.json) records exact
scopes, original regressions, language/security mappings and remaining gaps.
Maintained `npm test --workspace=docx` passed 227 files and 4,985 tests with
zero failures/skips. Fresh selected `npm run build:workspaces -- --workspace=docx
--no-cache` passed its declared closure; maintained package lint passed with the
one unchanged warning. All eight built public SDK/plugin Shell cases passed.
The actual human unsupported-edit diagnostic was captured with the maintained
screenshot route and inspected; no native document rendering was performed.

Task 28 implement/test remain open. These bounded corrections do not establish
complete per-member graph/API/source-case mappings, and annotated cell assignment
still has an explicit unsupported disposition. Tasks 29 onward were not started.
