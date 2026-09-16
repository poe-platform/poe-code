# DOCX public API reconciliation task record

Task: `reconcile-documented-public-api` only.

Date: 2026-09-13. Branch: `main`. Local commit only; no push or release.

## Ownership and scope

Owned files:

- `docs/docx/upstream-api-inventory.json`
- `docs/docx/upstream-api-audit.md`
- `docs/docx/upstream-api-reconciliation.md`
- This task record.

The pipeline plan already had unrelated working-tree edits when this task began.
This separate owned record carries the task outcome without staging or changing
that plan. Its historical 331-record preparation snapshot remains historical;
the current evidence is the schema-version-2 inventory. The unrelated plan move
also remains untouched. No README, product source, package configuration, unit
tests, corpus binaries, or shared specifications are owned by this task.

The task uses root AGENTS.md; there is no scoped AGENTS.md under `docs`.
The DOCX specification and shared CLI/SDK specifications were read. Research
does not change their proposed status. All later tasks, starting with
`define-mirrored-js-api`, remain pending and were not executed.

## Agent QA procedure

This is an agent-executed review procedure, not a committed QA script.

1. Confirm the reference checkout is exactly the audited commit; verify all 39
   API/user RST hashes before using their content. Read published equivalents
   separately and record access failures accurately.
2. Parse the original API and complete test inventories. Preserve original IDs
   and test statuses. Independently inspect RST directives, class bases, source
   properties/setters, constructors, returned types, enum values/aliases and
   prose examples; never infer the API from tests alone.
3. Demonstrate an inventory defect before editing. A read-only presence assertion
   must fail on omitted `Drawing.image`, `WD_ORIENT`, `Inches.twips`, and `_Text`.
   This is documentary evidence, not a product TDD test. No product code changes
   are permitted; future source-defect adaptations require failing original
   memfs tests in their owning tasks.
4. Verify every explicit RST class/function/method/attribute directive resolves
   to a retained inventory ID. Every added source-backed record must point to
   an existing pinned source location. Every property must distinguish get/set
   signatures; no missing annotation may silently become a TS `any`/`void`.
5. Check enum aliases, same-value aliases, source-only values, explicit erroneous
   documentation rows and all discrepancy references. Review language/security
   decisions against the common contracts; keep later per-member API/CLI/test
   mapping pending.
6. Check JSON accounting, hashes, source ranges, local Markdown links and owned
   formatting. Review the diff for source/README/fixture changes. Stage only the
   four owned files. Inspect the index before a Conventional Commit on main.
7. Verify the local commit contains only the owned files and report its hash.
   Preserve all unrelated working-tree changes. Do not push or run a release.

## Execution evidence

- Confirmed pin `e45454602b53e8e572b179ccf1c91093ec9f4ed7`.
- Pre-edit presence assertion failed for the four omitted IDs listed above.
  `Sections` was already an ID, but its `ABCMeta` classification had left its
  class/protocol expansion incomplete.
- Read all 39 pinned API/user files and published equivalents. Direct HTTP
  downloads returned 403; the web research tool read the published pages.
  No exact Sphinx build, objects.inv acquisition or browser-byte hash is claimed.
- Expanded 331 IDs to 920 research records and retained all original IDs.
  Recorded 59 RST directives, 262 nested enum values, 11 enum type aliases,
  inherited/returned protocols and separate source getter/setter evidence.
- Reconciled 23 documentation/source discrepancies. Zero product members are
  claimed implemented. All 1,609 unit variants and 650 BDD cases remain unmapped.
- No reference runtime, native document renderer, corpus campaign or product
  tests ran. No visual CLI behavior changed, so CLI screenshots are inapplicable.
- Final structural validation passed: 331 original IDs retained, 920 unique
  records, 458 getter/setter contracts, all 59 RST directives resolved, all pinned
  documentation/source/discrepancy hashes and source ranges verified, 262 enum
  values and 11 type aliases accounted for, 23 discrepancy records resolved,
  all 2,259 source-test cases still unmapped, and local Markdown links valid.
- Scoped maintained formatter passed using `npm exec --no -- prettier --check`
  with the four owned paths. This uses the repository formatter without the
  root `format` script's unconditional whole-repository `.` operand. No package
  installation or network resolution was needed.
- `git diff --check` passed. Product build/unit/ESLint/runtime/corpus gates are
  inapplicable to this documentation-only change and are not claimed as passes.
- Local commit verification is reported in the delivery response; this record
  intentionally does not embed its own commit hash.

## Outcome

Documentation/research reconciliation is complete; the recorded scoped checks
passed. The next task must create the concrete public API map and cannot treat
this record count as an exhaustive certificate or a passing behavioral suite.
All subsequent tasks and disposable-corpus cleanup remain pending.
