# Table, section and review task verification

Scope: verify the existing local-main feature `297ab9490`, not reimplement the
pipeline or promote whole-format coverage. Root AGENTS.md applies; no additional
AGENTS.md exists in packages/docx or packages/office-package. No safe-bash source
is changed. Existing equation/pipeline/discovery work and untracked QA directories
are unrelated and preserved; the initial index was empty.

## Acceptance inspection

Read the DOCX/shared office specifications and the four required API/test
audit/inventory resources. Parsed inventories contain 920 unique API records,
1,609 unit variants and 650 expanded BDD cases. Exact namespace closures reconcile
to the overlays: 52 table rows, 45 section rows, and 33 comment/link/break rows.
Historical dispositions remain research provenance, not new product passes.
Inherited members, enums/helpers, collections, APIs without source tests and
public underscore-prefixed owners remain visible in their respective registers.
Whole-public-API adaptation is still partial.

Inspected original tests and implementation for omitted versus empty cells,
horizontal/vertical logical aliases, direct nested block order, section sequence
and content partitioning, all six linked story slots, rich comments, metadata,
range validation, inert hyperlink traversal and detached cached-break fragments.
The comment guide corrections retain comment_id/timestamp and paragraph-owned
add_run; table direction remains table_direction. No invented id/date aliases.
Shared async admission/publication, synchronous admitted models, checked units,
explicit timestamps, owner-bound views and closed typed operations remain the
documented JS/security mappings. No product networking or host/native authority
was added.

Built public-index schema inspection returned 1,517 declared operations. It
contains images list, tables list, properties list and text replace; table row
lookup/iteration/length/slicing remain declared read operations. Comment id/date
and table direction alias operation IDs are absent. This is discovery evidence,
not 1,517 executed operation passes. Original structure command tests inspect
versioned JSON, dry-run input preservation, binary publication, explicit comment
timestamp and narrowed publication ceilings through the SDK-backed CLI engine.

## Original red/green evidence

Prior feature plans retain specific missing-entry-point and semantic red/green
descriptions and original tests. Raw prior red logs are not retained in those
records, so their historical execution is not freshly reverified. No source
runtime or publisher binary was rerun as a substitute.

Three new original memfs regressions reproduced current defects before code:
numeric table collection lookup returned undefined, invalid indexes threw generic
TypeError, and fractional row slicing did not reject. The focused red result was
3 failed / 11 passed (1.38 seconds). The initial maintained full run also observed
these same three failures: 193 files passed / one failed; 3,620 passed / three
failed / four skipped, 137.56 seconds. That run overlapped the red-test addition;
it is not the final-code verification.

After reusing the existing numericSequence adapter and correcting checked index
and slice validation, the focused green result was three files / 25 tests passed
(1.76 seconds): 14 table, seven closed registry and four real SDK/CLI command
cases. No existing acceptance was removed or weakened. Numeric writes, deletes
and definitions reject; lookup stays live after growth, absent/omitted slots
throw BoundsError, invalid types throw InputTypeError, and columns gain no slice.

## Maintained checks

- Final-code npm run lint --workspace=docx: exit 0; one existing type-only unused
  variable warning at operation-types.test.ts:20, no errors.
- Final-code npm run build:workspaces -- --workspace=docx: exit 0; maintained
  selected five-build dependency closure, including portable safe-fs output.
- Final-code npm run test:unit --workspace=docx: exit 0; 194 files passed,
  3,623 tests passed / four skipped (3,627 total), 136.91 seconds. The full
  final-code run has no failed tests or new skips. Raw local output is retained
  at /tmp/docx-table-sequence-final-unit.log; it is disposable execution evidence.

## QA and gaps

Inspected retained /tmp/docx-live-model-qa/help-wide.png. Its SHA-256 is
e8083e8e7fbc4d1e1229787dff2e1b6f936618dfb1fb9277ae698a92df9bb871; help.txt is
1405923f8d69ed00676a79b697cf55260df12769442b8d2f5e6282d352f87a7f. Both match
the original record. The operation/receiver/arguments and common flags/statuses
are readable; this is retained transcript screenshot inspection, not newly
executed root docx dispatch or office rendering. The correction changes no human
CLI presentation.

The four maintained suite skips are cross-format CLI cases: PPTX validate and
DOCX tables list, unscoped diff and public-engine cancellation. They are explicit
unexecuted coverage gaps, not schema prerequisite skips or passes. The independent
test:schemas route uses a pinned native xmllint/schema profile and was not run
under this task's no-native-runtime restriction. Native office rendering, corpus
QA, publisher documents, reference binaries and network QA were not executed.
No unavailable QA is claimed passed; no disposable asset was acquired or removed.

Delivery is local main only with explicit owned paths, enabled hooks and no
README changes, broad staging, ignored fixtures, push or release. The agent QA
procedure and correction ownership are in
[the plan](../plans/docx-table-sequence-verification.md).
