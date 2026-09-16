# Tracked text creation

Status: original milestone committed; scoped field-boundary correction requalified.
Implementation commit `76bb5dcd9` and isolated status commit `2f7c47cae` are local.

## Setup and owned paths

Task 60 passed and was committed locally as
`b8f37b569f754a84670e87d030aaf034203ab1ed` on main. The index is empty;
pre-existing pipeline status edits for tasks 48–59 and the untracked Pyodide
plan remain unowned and untouched. Root owns this plan, the authoritative
`docs/specs/docx.md` clarification, task 61's pipeline status hunk, research
evidence and separately assigned integration/export wiring. Leaves do not
stage/commit/push. Implementation/review source ownership is assigned separately
before edits; independent review uses a different worker.

Explicit implementation ownership:

- Domain leaf: `packages/docx/src/tracked-text.ts`, `revision-edit.ts`,
  `revision-edit-command.ts`, `tracked-text.test.ts`, `text-replace.ts`.
- Schema leaf: `packages/docx/src/command.ts`, `command-selection.ts`,
  `operation-schema-data.ts`, `operation-types.ts`, `operation-json-schema.ts`,
  `discovery.ts`, `discovery-result-schema.ts`, `tracked-text-command.test.ts`,
  and separately notified `discovery.test.ts` exact advertisement expectations.
- Root integration owner: `packages/docx/src/index.ts`, `inspection-command.ts`,
  `scripts/docx-exports.test.ts`, plus this plan/spec/status and research evidence.
  Root wiring contains no new domain logic.
- Shell leaf: `packages/safe-bash/tests/commands/docx/tracked-text.test.ts` only.
  Root owns its exact literal registration in
  `packages/safe-bash/scripts/integration-inputs.test.mjs`; historical membership
  and seals are preserved. A different worker reviews the integration.

Both investigation leaves confirmed before product code that text.replace lacked
the tracking options required by this task and revisions.add placement was
unspecified. The sole format contract now declares trackChanges/author/timestamp,
caret/append and whole-text deletion, exact views/formatting, unsafe-boundary
rejection and identity allocation. The shared command/SDK contracts remain intact.
This plan records execution; it is not a competing format specification.

No source case is assigned to this task by the current crosswalk; the reviewed
public inventory has no tracked-change live owner. Original additive F26 tests
remain required. Core document revision metadata is not tracked-change support;
no historical inventory or whole-API status is promoted by this task.

## Ordered acceptance procedure

1. Write original failing memfs tests for tracked insertion/deletion/replacement,
   split formatting runs, scalar Unicode ranges, required explicit metadata,
   deterministic scoped IDs and exact original/final/all text.
2. Implement one domain primitive shared by revisions.add and tracked replacement;
   retain the existing untracked editor. Reject affected review/property/range,
   field/control/opaque boundaries before mutation and preserve unrelated parts.
3. Verify dry-run, validation/limit/cancellation/publication failure preservation,
   metadata escaping and CLI/SDK/schema/capability parity. Do not execute task 62.
4. Independently review corrections, run maintained uncached DOCX unit/lint/build
   closure and appropriate existing opt-in shell/public-export checks. Any new
   safe-bash integration tests need exact literal registration and owned paths.
5. Execute actual supported command recipes, capture help/results/errors, render
   with maintained terminal tooling and inspect the screenshot. No screenshot
   unit tests or persistent scripted QA procedure.
6. Commit only verified owned paths/status hunk as an atomic Conventional Commit
   on main. No README edits, ignored fixtures, co-author, hook bypass, push/release.

Corpus acquisition/census and reference passes remain preparation. No native
product dependency, ambient host I/O, implicit network or downloaded product
asset is permitted. Corpus cleanup is not part of this task.

## Verification evidence

Final maintained uncached checks passed: `npm test --workspace=docx` (78 files,
1,916 tests), `npm run lint --workspace=docx`, and
`npm run build:workspaces -- --workspace=docx` (declared selected closure).
Logs are `/tmp/docx-tracked-final-unit.log`, `-lint.log`, and `-build.log`.
`git diff --check` passed. These scoped results do not claim the final
cross-workspace integration gate, remote delivery or a release.

Original failing tests preceded implementation. Domain evidence includes the
hidden sibling offset, CR scalar and complete result-envelope budget regressions;
the final focused domain/replacement suite passed 42 tests. Schema/discovery
focused checks passed 37 tests. Independent review passed 20 domain/command tests
and found no remaining concrete product blocker. Its original-view wording
clarification was applied to the sole format specification.

Real Shell verification passed four tests with zero skips, including VFS scripts,
binary stdout/stdin pipes, caret insertion, deletion, explicit metadata and
failure preservation. Integration-input runner checks passed 515 tests; the new
test is registered by exact literal path without rewriting historical seals.
Portable public exports plus existing command checks passed seven tests; this
is browser-conditioned bundle closure executed in Node, not browser/workerd QA.

Actual Shell recipes were executed against an original in-memory Coastal survey
paragraph. Tracked replacement yielded original Coastal survey, final Estuary
survey and all CoastalEstuary survey. Paragraph insertion yielded Coastal
survey!; absent metadata returned usage status 2 with affected zero. Help, these
results and the error were captured at `/tmp/docx-tracked-visual.ansi`, rendered
with terminal-png and inspected at `/tmp/docx-tracked-visual.png`. The current
wide help layout is legible in the full-resolution artifact; no Word rendering
or corpus qualification is implied.

## Field-boundary requalification

Task 62 investigation reproduced a task 61 tracked replacement inside the cached
result of an enclosing complex body field. The guard parsed the document root,
whose field traversal skips the body, rather than its admitted story. Root assigned
only `tracked-text.ts` and `tracked-text.test.ts` back to the domain leaf for a
failing original memfs regression before correction. No unvalidated unrelated
editor is changed. This invalidates the affected earlier field-boundary evidence;
the historical passing checks above are retained, and a separate correction and
scoped requalification are required before task 62 closes.

The valid original field regression failed before code at
`/tmp/docx-decisions-prerequisite-structural-red.log` (one prerequisite failure;
two separate task 62 paragraph-mark failures). Corrected combined checks passed
35 tests; these are not all prerequisite tests. Independent review approved the
exact nearest-story/path field guard. Root requalification passed 43 tracked and
existing replacement tests, maintained DOCX lint and selected build closure at
`/tmp/docx-tracked-field-final-focused.log`, `-lint.log` and `-build.log`.
Actual tracked replacement of the cached field returned unsupported-edit,
status 1 and affected zero with dry-run. The terminal capture and inspected PNG
are `/tmp/docx-tracked-field-visual.ansi` and `.png`. Historical screenshots are
retained. No complete corpus/renderer/whole-API gate or remote delivery is claimed.
