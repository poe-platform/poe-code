# Table, section and review API requalification

Execute only `sdk-table-section-review-api`. Later tasks remain pending. Root
owns `packages/docx/src/review-model.ts`, the new
`packages/docx/src/comment-creation-rollback.test.ts`, this plan and
`docs/docx/table-section-review-requalification.md`. Existing unrelated edits,
including the parent pipeline plan, remain outside staging. No README, push or
release is authorized.

## Procedure

1. Read root instructions, format/shared specifications and pinned API/test
   inventories. Validate existing table/section/review behavior rather than
   treating historical pending statements as defects.
2. Reproduce failed rich comment creation with original small memfs packages
   before implementation. Check archive and live owner rollback.
3. Use the existing model transaction and SDK-backed typed batch engine; retain
   neutral spellings, explicit time, scoped I/O and comment_id/timestamp.
4. Run maintained package tests/lint and selected fresh build closure. Recheck
   omitted/merged cells, ordered blocks, all linked stories, ranges, links and
   cached fragments using existing original tests. Human CLI output changes
   require screenshot inspection; no screenshot tests.
5. Record concise evidence under docs/docx and commit only literal owned paths
   on main after checks pass. Never create a read-only empty commit.

## Completion

The invalid-content regression failed before code. Existing model transaction
now encloses comment style resolution and insertion. Three original invalid-field
cases verify byte/owner rollback, ID reuse and memfs save/reload. Existing scoped
table/section/review and SDK-backed CLI acceptance passed without weakening
assertions. Maintained package lint, fresh selected build closure and all 5,147
package tests (247 files, zero failures/skips) passed. Exact mappings and measured
limits are recorded in the owned docs/docx evidence. Only this task is qualified;
later tasks remain pending. Root commits the four literal owned files locally
on main. No parent pipeline-plan edits, README, push or release.
