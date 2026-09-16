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

## Follow-up ownership and contract review

Execute only `cross-format-cli-conformance`; later tasks remain pending. Baseline
main is `bc3b0fef9`. The index was empty. Preserve the initial OMML evidence/plans,
pipeline status edits, untracked discovery plan and QA outputs. None is owned by
this task. Root owns the paired tests, DOCX command/comparison integration, this
plan and cross-format evidence. Delegated leaves own the table reader/batch/schema
and narrowly reproduced PPTX validation/discovery/extraction corrections. A
separate worker reviews the final diff read-only. No safe-bash source change is
assigned or required by the evidence below; its public adapters are exercised.

The reference API/test inventories were parsed and reviewed: 920 API records,
23 documentation decisions, 1,609 unit variants and 650 BDD cases. Historical
status dispositions remain unchanged. The exact utility/model/security mappings
remain those recorded in cross-format evidence and the API reconciliation;
inherited/protocol/enum/helper and documented underscore-prefixed members remain
visible obligations. This task does not execute a reference runtime or download,
copy, remove or depend on QA documents/binaries.

### Failing-first corrections

- DOCX bare CLI diff, default SDK comparison and optional-scope schema/help failed
  before code. Reconcile the format wording with the authoritative shared grammar:
  parts/package defaults, text/structure body defaults, explicit incompatible
  pairs rejected. Focused comparison checks passed; the selected DOCX build and
  maintained lint passed. The actual built diff-help screenshot was inspected.
- Three original SDK table-list cases failed before implementation; read-only
  batch/schema cases also failed before registration. Share the existing logical
  table reader, honor selected owners/stale tokens, declare exact records and
  route public CLI/batch through that domain API. Focused table checks and package
  lint passed.
- DOCX acquired-input, pre-aborted, JSON-source and discovery-output cancellation
  failed before code. Fulfilled inspect/diff stdout and inspect diagnostics also
  reproduced status 0 instead of 130. Preserve typed image/archive extraction
  receipt exceptions required by the format specification; ordinary command
  cancellation resolves 130. Reconcile the older ordinary diagnostic test's
  rejection expectation with the shared status contract.
- PPTX validate failed before code. Use existing admitted package/semantic SDK
  validation, declare XML schema validation not checked, reject inapplicable flags
  before input, and expose truthful help/schema/capabilities. Focused checks/lint
  passed. Missing discovery declarations and unsupported-path failure labels
  were independently red before correction. Inspect limit schema/runtime drift
  was red before enabling only supported lowered ceilings; output-count limits
  still reject before input.
- DOCX rejected spellings initially returned status 2 with empty JSON transport.
  Original paired failure-envelope assertions failed before early JSON detection;
  retain option-value and terminator boundaries rather than accepting aliases.
- Actual image and package extraction checks exposed nonzero successful PPTX read
  effects. Original public-engine memfs regressions were red before correction;
  preserve precise output counts/bytes in manifests and explicit partial failures.

### Extraction profile qualification

Shared CLI section 6 and PPTX section 6.7 require an explicit output directory,
safe manifest and transaction or explicit partial intent; neither promises to
create an absent output root. Independent scoped review found no requirement to
change ordinary parent-directory publication. The paired package extraction
recipe therefore supplies an existing PPTX output directory; DOCX exercises its
specified absent/new-tree destination. PPTX materializes generated flat names,
DOCX retains the admitted member tree. The command path/flags and read envelope
are compared; these format publication profiles are disclosed, not equated.
The initial absent-PPTX-root status 3 and incorrect test assumption about flat
names are QA findings, not product fixes or passes.

### Final agent QA procedure

1. Repeat the complete paired public-adapter suite after integration; assert all
   common paths are declared, old spellings fail with JSON errors before reads,
   ordinary statuses and comparison/cancellation statuses agree, and real image
   replacement/extraction retains original bytes. Observe the actual injected
   publication sinks for dry-run, not merely the read-only backing Volume.
2. Run both maintained format package suites and lint after the final code/test
   revision. Run each selected workspace build closure separately; the maintained
   runner rejects multiple --workspace selectors in one invocation.
3. Capture built public help/errors and actual table-list output with the maintained
   screenshot route and inspect the PNGs. The root CLI does not register these
   explicitly injected format adapters; no root-CLI screenshot substitutes for
   the actual public-adapter invocation. Keep screenshots disposable and untracked.
4. Record exact current schemas, maintained checks, red/green observations,
   language/security mappings and remaining whole-format/API obligations under
   docs/docx. Make no whole-format or renderer fidelity claim.
5. Stage each atomic correction's owned hunks and relevant plan update explicitly;
   inspect the index and make Conventional Commits on main without hook bypass.
   Do not push, release, stage unrelated pipeline edits, edit README or clean
   another campaign's files.

### Table-list delivery

Original reader/batch/schema cases and paired table-list cases pass. Final DOCX
maintained suite: 4,930 tests across 218 files; scoped lint and build pass.
Stage only table domain/SDK/batch/discovery and CLI integration for this commit.

### Cancellation delivery

Fulfilled usage stdout/stderr reproduced 2 instead of 130 before the last fix.
The final ten focused cancellation cases and complete DOCX suite pass. Preserve
typed image/archive extraction receipts; commit only ordinary cancellation paths
and their original regression tests.

### Rejected-path transport delivery

Paired alias failure-envelope assertions reproduced empty/mislabelled transport
before correction. All eight paired spelling cases now pass with help-labelled
JSON failures before reads; option-value and terminator boundaries are retained.
Commit only early DOCX JSON detection, PPTX fallback label and paired assertions.
