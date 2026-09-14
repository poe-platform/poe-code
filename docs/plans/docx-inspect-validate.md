# DOCX inspection and validation

Scope: implement only byte inspection and partial core-v1 validation with the
safe-bash command adapter and SDK parity. Later editing/model tasks remain pending.
No pushes or releases are authorized by this task.

## Owned implementation

- Add original minimal, complex and invalid in-memory regressions before code.
- Reuse bounded ZIP/OPC/XML admission, semantic validation, location indexing and
  explicit I/O cleanup. Keep product logic in packages/docx; root exports already
  route to that package, and the existing safe-bash plugin forwards capabilities.
- Inventory parts, sizes, content types, relationships, properties, active
  structure, annotation metadata, protection, media, fonts and signatures.
- Preserve unknown/unmeasured values: cached pages versus rendered pages,
  referenced versus installed fonts, present versus verified signatures.
- Expose deterministic JSON, bounded human summaries, profile warnings and
  supported schema/discovery metadata. Do not invoke creating model getters,
  network resources, host files, renderers or a native reference build.
- Validate original invalid inputs without repair. Preserve original tests and
  unrelated plan/archive changes. Stage only owned files in one atomic feature
  commit on main after maintained checks.

## Evidence

Initial inspection regression run: 12 failures before implementation (missing
inspectDocument/validateDocument exports). The richer fixture's initial memfs
setup was corrected from Uint8Array JSON values to Buffer values before code.
Repeated red run retained missing-function failures. The first implementation
passed all 12 cases. Added red regressions then exposed relationship ID sorting
instead of XML order and hexadecimal cached-page coercion; fixed both and added
invalid-date/cache metadata handling. All 14 inspection regressions pass.

A maintained package test run passed 747 tests across 27 files. The maintained
selected docx build closure passed all five declared build tasks. Final checks,
command integration and visual review are recorded below when complete.

## Mapping and task boundary

Read docs/specs/docx.md, office-cli.md and office-sdk.md alongside the root and
safe-bash AGENTS.md. Reviewed the API audit and all 920 inventory records and
status/mapping links. Those records remain model research: 410 planned,
378 security-mapped, 124 language-mapped and eight documentation-error records.
No model API becomes implemented through inventory support. Inherited members,
enums, collections, helpers and public underscore-prefixed types remain visible
in discovery/schema and the existing research register.

Exact utility mappings and closed result additions belong in
[inspection evidence](../docx/inspection-profile.md). No upstream names/assets
were introduced in product source or tests. The scenarios use existing original
garden, museum, observatory and equipment data plus original metadata. No
substantially derived material or new legal notice is involved.

## Review and final verification

A read-only review found discarded ignorable extension markup missing from
feature/warning detection and unsupported custom-property vectors flattened into
strings. Original memfs regressions failed for both before fixes; raw MCE/opaque
inventory now remains distinct from active structural counts, and unsupported
property values are null with a warning. Feature F41 now detects custom XML and
glossary resources, rather than arbitrary unknown namespaces; settings alone
satisfy the F42 inventory detector.

A macro-bearing ancillary declaration reproduced inspect/validate disagreement:
inspection rejected it while byte validation passed. Both admission and the
existing semantic validator now share the same macro content-type exclusion.
All 17 focused SDK regressions and 53 existing validator cases pass.

The public browser export check reproduced an accidental node:path import from
the new command's filesystem-contract import. Switching to the existing portable
safe-fs/core route fixed it without adding a dependency or changing shared code;
the original public export/bundle tests pass 2/2.

The maintained focused safe-bash reporting wrapper passed all ten registration
and real Shell integration tests. An attempted SAFE_BASH_TEST_RG filter was not
supported by the workspace test script; the unintended unfiltered run was stopped
and is not counted as a pass. The focused maintained command used was:
`node scripts/test-reporting.mjs --import tsx tests/commands/docx-registration.test.ts`
from packages/safe-bash. No skipped profiles are counted as passes.

Visual QA executed the actual inspection command engine using original in-memory
bytes and captured its stdout/stderr with the existing terminal PNG renderer.
Both inspect and validate exited zero. The screenshot at
`/tmp/docx-inspect-validate-qa.png` was inspected: readable bounded summaries,
explicit cached/unmeasured labels, and passed versus unvalidated check statuses.
This is ad hoc QA, not a screenshot test, renderer/layout test or reference build.
The disposable screenshot is not staged. No QA script was added.

Dedicated link/control/revision/shape/field/bookmark scalar selectors remain
explicit unsupported-profile errors; existing indexed selectors and tokens work.
Those location-index extensions and full F01–F50 capability/model coverage remain
later tasks. This milestone does not silently treat unsupported selectors as
successful reads.

Final maintained results after the fixes: docx package tests 752/752 across
27 files; selected docx workspace build closure 5/5 declared build tasks;
docx ESLint and production/test TypeScript checks passed; focused safe-bash
reporting wrapper 10/10; original public browser/export tests 2/2; diff whitespace
check clean. No ignored fixtures, downloaded documents, co-author trailer,
push or release are included. The local atomic commit owns the feature and
this evidence; unrelated main-plan edits and the historical plan move are left
uncommitted.

## Verification correction: feature families (2026-09-14)

Reviewed the implementation commit `57dbc37a6`, its recorded red/green evidence,
the shared contracts and the model research inventory. The current baseline
passed 752 tests. The inventory still records 410 planned, 378 security-mapped,
124 language-mapped and eight documentation-error records; this verification
does not promote model members or remove public underscore-prefixed types.

Two original memfs regressions reproduced an incorrect F27 detector: a content
control returned true and a move revision returned false. The focused red run
passed the original 17 inspection cases and failed both new cases. Controls now
map to F28; F27 detects inventoried move/table/section review annotations. These
remain bounded inventory subsets, not complete complex-review semantics.

After this correction, `npm run test --workspace=docx` passed 754 tests in 27
files; `npm run lint --workspace=docx` passed ESLint and both TypeScript checks;
`npm run build:workspaces -- --workspace=docx` passed its five declared build
tasks. The focused safe-bash reporting route passed 10 tests. The attempted
package-test file filter also selected the whole package and reproduced the
same two red failures; it is not counted as a separate focused pass.

The atomic correction owns only inspection.ts, its original test file and this
plan update. No README, model mapping, unrelated index entry, push or release
is included.
