# DOCX table sequence contract verification

Scope: verify the already committed table/section/review task. Own only the table
model correction, its original memfs tests and corresponding evidence. Preserve
unrelated work and index entries. No README edit, push, release or native QA.

## Red-before-code evidence

The shared SDK contract requires readonly numeric sequence lookup and typed
errors. The historical API inventory retains both table collection lookup
protocols. Three new original memfs tests failed against the existing code:

- Numeric row lookup returned undefined instead of the admitted row.
- Invalid table indexes threw generic TypeError rather than InputTypeError.
- A fractional row slice bound did not throw.

The focused red run passed the 11 existing cases and failed the three new cases.
Reuse the existing numericSequence adapter for both collections, declare readonly
numeric signatures, use InputTypeError/BoundsError for table selection, and check
slice bounds before normalization. The focused green run passes 14 table cases
and 11 related closed-registry/SDK-backed command cases.

## Agent QA procedure

1. Inspect the three original failures before modifying implementation.
2. Run the focused table and structure batch/command cases after correction.
3. Run maintained docx unit/lint and the selected maintained docx build closure.
4. Inspect existing task-owned help screenshots and compare retained hashes.
   No CLI presentation changes are introduced by this correction.
5. Record executed outputs and gaps in docs/docx, then explicitly stage only
   owned files and this plan for one atomic Conventional Commit on main.

Whole-format API adaptation, downloaded corpus, independent native schema and
office renderer QA remain separate; unavailable checks must not count as passes.

Final maintained checks pass: docx unit has 194 files / 3,623 passing tests and
four existing cross-format skips (136.91 seconds); lint exits 0 with one existing
warning; the selected five-build dependency closure exits 0. Built declarations
retain readonly numeric signatures for both table collections. Delivery is one
local-main fix commit with the five explicitly owned code/test/evidence/plan
files; the integration record's skip-label correction is a separate docs commit.
