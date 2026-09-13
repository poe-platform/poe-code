# PPTX bounded diagram implementation and QA

## Scope and ownership

Implement F40 resource inventory and preservation only. Keep logic in
`packages/pptx`, adapters in `packages/safe-bash/src/commands/pptx`, and root
wiring only. No whole pipeline, README edits, ambient I/O, native runtime,
product network, branch creation, push or release. Preserve unrelated work.

Root owns inventory/schema integration; delegated CLI and import workers own
only their assigned files; research worker owns this plan and
`docs/pptx/diagram-evidence.md`, `diagram-case-map.json`, `diagram-usage.md`.
See root/scoped AGENTS.md for commit and delegated ownership requirements.

## Acceptance

1. Add failing original memfs tests for data/layout/style/colors/drawing resources,
   multiple owners, complete cyclic closure, missing targets and fallback-only
   resources; verify deterministic independently expected records through SDK.
2. Preserve resource payload bytes, relationships, content types and sharing on
   slide import and unrelated text edits. Reject incomplete import closure
   atomically. Reduce meaningful failures to small original regressions.
3. Verify inspect JSON, schema and capabilities through the command engine and
   configured safe-bash adapter. Do not expose semantic diagram editing.
4. Keep every relevant expanded reference case and inherited/returned API
   obligation in the focused research ledger with honest status and exact
   language/security mappings. Original tests supplement missing diagram cases.
5. Run maintained focused package checks and the affected adapter checks. Commit
   each atomic improvement locally on main with only explicitly owned files
   and associated plan updates after its checks pass. Report hashes separately;
   do not push or release.

## Disposable QA procedure

Use only entries in `docs/pptx/corpus-manifest.json` and verify their recorded
SHA-256 before opening existing cached bytes. Do not download inputs for unit
checks or ship cached/output files. Apply each entry's trusted QA limit profile;
never silently raise product defaults. The two explicitly recorded later
censuses have zero diagram elements, so do not call these diagram acceptance
fixtures solely because the filename is a presentation.

When an admitted cached file contains diagram resources, compare package-part
hashes and relationship closure before/after an unrelated text edit and slide
import. Inspect original and saved appearances with an available viewer and
screenshots; record any viewer limitation separately from structural checks.
A missing viewer or zero actual diagrams is an explicit QA gap, not a pass.
Use an original disposable diagram fixture for focused visual inspection if no
manifest input exercises the feature. Record screenshots in ignored disposable
output storage. Never add a screenshot test or QA automation script.

If visual CLI output changes, use the maintained screenshot command for an
applicable invocation and inspect the resulting image. JSON assertions alone
do not establish visual correctness. Delete only owned outputs explicitly
created by this QA after evidence and original regression reduction; do not
clean another worker's cache files.

## Execution receipts

Research review completed: pinned audits/inventories, shared SDK/CLI contracts
and corpus manifest consulted. Focused ledger: 32 unit variants, 11 BDD rows,
60 API entries; no complete parity claim. Eleven discriminator unit cases and
five BDD examples have a bounded observable mapping while live getters remain
public API gaps. No corpus downloads or visual QA executed by research worker.

Inventory tests authored by root: `packages/pptx/src/diagram-inventory.test.ts`,
three expanded cases. Final maintained-check results and local commit hashes
must be entered by the integrating worker after execution; none are claimed by
this drafting receipt.

Research worker focused check: `npx vitest run
packages/pptx/src/diagram-api-contract.test.ts` passed 9/9, 12 ms test time.
An initial test-only wrong import was corrected; it was not product failure
evidence and no product implementation was changed by the research worker.
The seven graphic-frame families test generic-reader/ordinary-editor boundaries;
source live getter results remain deferred. Three diagram-related enum entries
now have passing original public-export assertions.

Integrator QA receipt: verified existing
`.cache/pptx-corpus/WWL-template-1slide.pptx` against manifest SHA-256
`0c728ea3fd2ab76906247931fcb5c966074d21e804187893d954cc913cc89689`.
SDK inventory reported 1 slide, 25 parts, 0 diagrams. This is general read and
absence-of-false-positive evidence only. Explicit QA limits: input/archive
2 MB, entry 1 MB, expanded total 4 MB, 500 members; XML 1 MB, 100000 nodes,
depth 128; 5000 relationships. No diagram corpus visual fidelity is established.

Integrator visual receipt: `/tmp/pptx-diagram-capabilities.png` captures the
actual command-engine diagram capability block and unsupported `diagrams edit`
error. Image inspected as legible without clipping. The root screenshot route
could not invoke the injected command, so the existing terminal-png capture
was used. No screenshot test was added; the disposable image is not staged.

CLI worker receipt: six configured safe-bash cases passed against built package
exports, including colliding slide import. Independent relationship parsing
checked copied data-to-drawing and drawing-to-image edges; original/imported
resource bytes matched and both inputs remained unchanged. Focused guarded lint
passed for that test and discovery registration. Research test ESLint also passed.

Integrator maintained checks: `npm run build:workspaces -- --workspace=pptx`
passed its three declared builds (office-package, toolcraft-schema, pptx).
`npm run test:unit --workspace=pptx` passed 131 files / 3662 cases before the
nine public-boundary cases were added to discovery; those nine passed separately.
`npm run lint --workspace=pptx` passed ESLint and source/test TypeScript checks.
The exact safe-bash discovery-registration test passed (one case); the focused
adapter reporter passed six cases. Guarded lint verified both adapter-test and
discovery-registration subjects with zero findings and all 25 receipts; see
[pptx-diagram-cli.md](pptx-diagram-cli.md) for exact hashes/counters.

TDD evidence: the three inventory cases initially failed on missing diagrams;
five initial import cases exposed rejected diagram dependencies. Subsequent
original regressions cover required edge selectors and missing graph edges.
The exclusive-branch duplicate-ID regression failed before the import-specific
local identity preservation was added. No source files, fixtures or assertions
were copied from the reference implementation; standalone existing legal notices
are retained separately. No README or corpus bytes are staged.

Final selective verification after the MCE identity change: 94 tests passed in
seven files covering diagram inventory/API/import, slide copy/import, advanced
chart import and command import. The diagram import file contains 13 cases,
including malformed repeated fallback rejection. The selected maintained
workspace build closure passed again; the six adapter cases passed against
those final exports. Focused import ESLint and package test TypeScript checks
also passed after the final change. Package-wide lint had already passed; no
whole pipeline, push or release was run.

Delivery is one atomic diagram inventory/preservation improvement, including its
SDK/CLI assertions, schema/capability description and research accounting. Stage
only the named diagram/domain files, these plans and the diagram research files;
apply only the diagram capability and exact discovery-registration hunks to the
index in the two files that already contained unrelated changes. Record the
resulting local commit hash in the final report; no remote delivery is authorized.
