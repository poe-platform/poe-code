# Cross-format CLI conformance

Owned task: `cross-format-cli-conformance` only. Later tasks remain pending.

Read root/scoped instructions, the three authoritative specifications, both
DOCX upstream audits and inventories, and the API reconciliation. Historical
920 API records and 1,609 unit/650 BDD cases are research obligations; this task
does not promote model members or claim whole-API coverage.

Ownership: new paired tests under packages/docx/tests, narrowly reproduced
format-package corrections, this plan, and evidence under docs/docx. Preserve
all preexisting worktree/index changes. No README edits, push or release.

## TDD and agent QA procedure

1. Author small original documents and presentations in memory. Inject memfs
   input through the actual public command adapters; no ambient product I/O.
2. Run identical common command recipes for discovery, text, plural resources,
   property mutation, output aliases, selection and publication validation.
3. Check all result-envelope fields and ordinary 0/1/2/3/4 statuses. Compare
   equal/different/trouble/cancellation as 0/1/2/130. Check ordinary cancellation.
4. Reject singular image/table, metadata and top-level replace, unknown flags,
   repeated scalars and inapplicable flags before acquiring document input.
5. Capture failing cases before production corrections; rerun original tests.
6. Run maintained DOCX/PPTX unit and lint checks plus selected workspace build
   closures. Inspect help/error screenshots where CLI behavior changes.
7. Record exact runtime coverage, schema differences and pending requirements in
   docs/docx. Commit atomic owned improvements on main with explicit paths.

No downloaded QA fixtures or reference runtime are needed for these cases.

## Execution

Initial inspection: both format engines and public adapters exist. The worktree
already contains unrelated DOCX packing, extraction and discovery changes.
The initial paired run had 29 passes and five failures. After correcting the
external-shell cancellation harness and normalizing JSON schema envelope
branches, 48 cases pass and four target cases remain explicitly pending. No
production correction was made. Both selected workspace builds, both format
package lint routes and both maintained package unit suites passed. DOCX has
3423 passing tests/four skipped; PPTX has 6874 passing tests. Targeted help/error
screenshots were inspected through the maintained screenshot route.

Exact schemas, cancellation outcomes, limitations and language/security mappings
are recorded in [the evidence](../docx/cross-format-cli-conformance.md) and its
JSON receipt. DOCX table listing, bare diff and cancellation status, plus PPTX
validation, prevent full paired conformance. Rejected-path JSON transport,
PPTX discovery-schema omissions and oversized targeted help are also recorded.
This task remains open for complete conformance; later tasks remain pending.
Only this plan, the new original test file and its evidence will be staged for
one atomic test-coverage commit. No push or release.
