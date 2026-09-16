# DOCX live table model API

Scope: only table owners for the active SDK table/section/review task. Later tasks
remain pending. Owned implementation and original tests are table-model.ts and
table-model.test.ts; evidence is docs/docx/table-model-api.md. The coordinating
owner integrates shared ModelStore, exports and commits. No README edits or push.

## TDD execution

1. Five authored memfs tests failed against the unimplemented Table constructor.
2. Implement owner-backed logical aliases, omissions, direct nested block order,
   nullable formatting, row/column additions and content-preserving merges.
3. Add shared ModelStore save/reopen regression and independent null height/rule
   regression. Both failed; add the style owner bridge in shared infrastructure
   and correct attribute-level null removal in the owned format implementation.
4. Reproduce cross-owner paragraph-style acceptance through cell insertion with a
   failing original test, then pass the supplied style owner through shared
   validation without converting it to an interchangeable ID.
5. Add the missing inventoried Table.table self-owner regression, observe its
   semantic failure and add the getter. Add direct inherited/protocol coverage
   and record a per-member historical-inventory overlay with candidate counts.
6. Reproduce detached-cell part/owner metadata acceptance after merge with a
   failing original test, then validate handles before metadata/owner traversal.
   Cover all table-family metadata after explicit table removal.
7. Run focused tests, lint and package type checks; the coordinator executes the
   maintained package checks and records the owned atomic commit.

## Agent QA procedure

- Inspect a tiny authored in-memory table with an omitted first slot and a
  two-column cell repeated through a vertical continuation. Confirm logical
  aliases share identity, omissions throw bounds errors and an ordinary empty
  cell remains accessible with empty text.
- Traverse cell paragraph/table/paragraph order and confirm descendant paragraphs
  do not leak into the direct cell paragraph collection.
- Change a table style through the shared owner, add a column and row, change a
  retained cell and save into memfs. Reopen and inspect text/style preservation.
- Clear row height and rule independently. Confirm the remaining attribute is
  retained.
- Merge an authored rectangle and inspect joined paragraph order and repeated
  logical grid positions. No renderer, native runtime, external acquisition or
  downloaded binary is required for these model-only cases.

Parent final maintained checks: all 194 docx test files pass (3,620 passing,
four existing skips); maintained docx lint and selected build closure pass.
Owned files are delivered in the local main feature commit; no push or release.
