# Paragraph formatting namespace ownership

Task: `adapt-upstream-tables-bdd` only. Retained workflow formatting reds preceded the owner serializer correction. A paragraph fragment must carry inherited namespace bindings when admitted to the formatting parser. Use the shared standalone owned XML serializer, retaining original text and formatting edits.

Original in-memory regression: `packages/docx/src/paragraph-format-namespace-owner.test.ts`. Evidence: `docs/docx/workflow-behavior-evidence-20260915/paragraph-font-table-red.log`, final exact workflow report and `paragraph-namespace-green.log`. Renderer QA is not required for namespace admission; page-layout QA remains explicitly not run in the aggregate plan. No README, push, release or later tasks.
