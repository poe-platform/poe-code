# Paragraph insertion acceptance verification

Scope: the `adapt-upstream-text-style-document` verification task, on local main
at `7d94f691baed0cc9dbae4b98ec0bb1418db9ee25`.
Verify existing behavior, reproduce defects before
fixing, and leave whole-task acceptance open until every residual obligation has
evidence. No delegation or additional scoped AGENTS.md applies to packages/docx.

Owned files: packages/docx/src/block-model.ts,
packages/docx/src/paragraph-insertion-contract.test.ts, this plan, and explicitly
named records under docs/docx/paragraph-insertion-verification-20260915. Preserve
unrelated changes and index entries. No README edits, broad staging, push,
release, reference execution or disposable fixture cleanup.

Agent QA procedure:

1. Read root instructions, DOCX/shared CLI/SDK contracts, DOCX test/API audits and
   inventories, counterpart audits and scoped overlays. Inspect existing outputs
   and retained red/green evidence; do not infer current passes from old receipts.
2. Reproduce insertion style-name/ID, typed-style, absent/empty text and validation
   defects with small original memfs tests. Assert owner equality, XML and Unicode.
3. Extend failure assertions to public package part bytes to detect lazy styles
   creation on rejected insertion. Run this red before adding transaction coverage.
4. Use the existing style resolver, typed public signature and domain transaction;
   exercise the closed SDK-backed batch route and save/reopen through memfs sinks.
5. Check all four mapped text/style combinations and retained paragraph ID/order
   through exact XML. Replace private proxy call-count checks with observable
   content/cardinality/style and returned-owner assertions.
6. Run maintained docx unit/lint and selected workspace build closure. Attempt the
   independent schema route once; record missing prerequisites as unexecuted.
   No human help/layout changes are introduced; no new visual QA pass is claimed.
7. Retain original red/green outputs and exact JS mappings in docs/docx. Commit
   explicitly named owned paths after checks pass, with enabled hooks, no
   coauthor, ignored files or empty commits. Keep broader acceptance gaps visible.

Execution and actual checks are recorded in
[the verification receipt](../docx/paragraph-insertion-verification-20260915/review.md).
