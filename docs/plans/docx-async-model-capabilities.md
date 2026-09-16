# Async model capabilities

Scope: sdk-async-capabilities only, main, no push/release. Later tasks pending.

Owned paths: this record, docs/docx/async-model-capabilities.md,
packages/docx/src/model-context.ts, model-input.ts,
async-model-capabilities.test.ts, styles-model.ts, image-model-input.ts and
index.ts, budget.ts (internal shared-reservation check), style-model-batch.ts,
image-batch-operations.ts (context normalization), and publication.ts (internal
commit precondition only). These paths have no initial unrelated edits. The
existing pipeline plan, equation evidence and output trees are excluded. async_review owns
read-only independent review, no edits or Git operations.

## Agent QA procedure

1. Read root instructions, the three specifications and complete API/test
   inventories. Preserve all public owner/inherited/enum/underscore obligations.
2. Write original memfs tests and run before implementation for default and
   supplied model contexts, byte/stream/path admission, deterministic creation,
   synchronous formatting, always-async save and combined cancellation.
3. Extend existing Styles/Image admission and publication; no second editor,
   placeholder Document, ambient filesystem, clock, identity, font or network.
4. Exercise failures, copied bytes/chunks/context values and stale in-place
   publication through existing publication engine. Run maintained docx tests,
   lint/typechecks and scoped formatting. No CLI presentation changes.
5. Independent worker reviews the candidate. Commit only owned paths and this
   plan, with Conventional Commits and hooks. Report local hash only.

Initial observation: no Document factory or general live owners exist. This
async task cannot honestly complete their surface by renaming a style-only
editor. Extend available live types and retain missing-owner obligations.

## Execution receipts

- Initial original red: five tests failed for omitted/null context, stream input,
  ignored author/time, lost publication cancellation and invalid time. Added
  stale-serialization red also failed, then all six passed after implementation.
- Additional original reds reproduced context accessors/null fallback, live
  mutation during final sink commit, malformed resolver methods, inherited/nested
  getters, ignored internal-stage cancellation, lost image-source receiver and
  an unrelated exhausted publication reservation ledger. Assertions were retained.
- The first internal-stage probe used an unimplemented test session reader and
  failed admission instead of the intended cancellation check. It was corrected
  to use actual admission; the corrected cancellation test failed before code.
- Final focused run: five files, 54 passes, including 23 original capability
  cases and actual SDK-backed style/Image command and guide checks.
- Independent async_review read-only review passed the final implemented scope,
  including the reservation-ledger correction. No worker edited files or Git.
- Maintained lint, source/test TypeScript and selected docx workspace build
  closure passed. Lint retains one operation-types.test.ts warning, no errors.
  Portable dependency build selected zero native assets; no native decoder ran.
- New source/test/evidence/plan Prettier and git diff --check passed.
- Two intermediate maintained suite runs overlapped development: five failures
  in the first candidate and one exhausted-budget failure in the next. Both are
  retained as failed candidate evidence, not passes. Final receipt follows below.

## Remaining prerequisite

Document, paragraph/run, table, section/header/footer, comments and general
package/part live owners required by the public inventory remain absent. Their
factories, save/load and input-admitting methods cannot be qualified by a
style-only editor. No placeholders or competing domain editor were created;
all 1,337 API rows, 920 source records and original test denominators remain.
Metric-consuming APIs are likewise pending. This task and later states remain
unchanged; these scoped corrections do not establish full task completion.

One focused atomic improvement implements the available async admission/context
and safe publication boundary together, including its original red/green cases.
Commit only the listed owned paths after the final maintained suite passes.
No push, release, README change or QA-input cleanup is authorized/performed.

Final maintained candidate: `npm test --workspace=docx` exited 0 with 182 files,
3,501 passing tests and four explicitly skipped tests retained separately.
`npm run lint --workspace=docx` and
`npm run build:workspaces -- --workspace=docx` both exited 0. The selected build
used maintained dependency declarations. Raw candidate logs remain disposable
`/tmp/docx-async-{test,lint,build}-candidate.log`; focused evidence remains
`/tmp/docx-async-focused-final.log`. No failed candidate was counted as passing.
