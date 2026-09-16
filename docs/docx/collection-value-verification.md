# DOCX collection/value verification evidence

Verified on 2026-09-15 at local main `46aeea7e1`, following the
[owned QA procedure](../plans/docx-collection-value-verification.md).
This verifies a bounded increment, not whole-public-API acceptance.

## Maintained checks and actual outputs

- `npm test --workspace=docx`: exit 0, 181 files passed, 3,478 tests passed,
  four skipped. Includes 18 original enum and 21 original collection/value cases,
  public built-consumer checks, shared CLI contracts and operation-schema tests.
- `npm run lint --workspace=docx`: exit 0, source/test TypeScript passed;
  zero ESLint errors and one existing unused-type-variable warning in
  `operation-types.test.ts`.
- `npm run build:workspaces -- --workspace=docx`: exit 0; maintained five-build
  dependency closure completed, including portable safe-fs and DOCX.
- `npm run test:schemas --workspace=docx`: exit 1 at setup because
  `DOCX_SCHEMA_ROOT` is unset; ten cases skipped, none validated. The maintained
  setup invoked the installed `xmllint --version` probe before reaching that
  missing prerequisite. No document schema validation, runtime installation or
  network acquisition followed. This is unavailable QA, not a passing result.

An ad hoc comparison of built public exports with all 262 inventoried enum named
values found no numeric discrepancies. XML metadata matched after the documented
four `UNMAPPED` sentinel-to-null mappings; original tests separately assert their
conversion rejection. Ten documented public family aliases and the retained
header/footer constructor alias have exact exported identity.

The original memfs tests exercise signed lookup, half-open RGB slices, bounds,
snapshot iteration, shared tab ownership, removal invalidation, keyed styles,
null/false/zero, unit boundaries and CLI JSON/error statuses. Sparse style IDs
remain keys; this does not qualify missing sparse comment/relationship owners.

Inspected retained screenshots `cat-tmp-docx-enums-batch.txt.png` and
`cat-tmp-docx-collections-error.txt.png`: complete readable output for
`docx batch: 2 operations; 0 changes` and the bounded missing-selection diagnostic.
These are prior human-output captures, not freshly executed shell/rendering QA.

## Evidence limits and acceptance gaps

The existing plan/evidence records the initial twelve enum failures, six of nine
collection failures and subsequent original security/protocol reds. Those prose
receipts and current original tests were inspected; raw red/green logs for these
two increments were not found in their retained DOCX evidence. Fresh green checks
do not independently reconstruct their historical red executions. The upstream
audit also records absent raw baseline artifacts; its historical 1,609 unit and
650 BDD results were not rerun or promoted to target passes.

The actual built barrel still lacks Document, Sections, \_Rows, \_Columns,
InlineShapes, Comments, ImageParts and Relationships. Source inspection also
shows missing general Paragraph/Run/table/story/comment live owners. Their
inherited members, documented slicing, sparse ID lookup and mutation protocols
remain acceptance gaps. Utility arrays/editors cannot qualify those APIs.
Public underscore-prefixed obligations remain visible. Full per-member,
untested-public-API and original guide-workflow acceptance remains incomplete.

No new product defect was reproduced, so no code was changed. The verified
documentary correction removes the stale claim that direct enum protocols are
absent and links their bounded evidence, leaving historical JSON observations
and missing-owner findings explicit. Existing local implementation commits are
`c6e27953d` and `46aeea7e1`; this verification performs no push or release.
