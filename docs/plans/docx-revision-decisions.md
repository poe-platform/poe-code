# Selected revision acceptance and rejection

Status: ordered task 62 verified, ready for its owned local commit. Task 61 passed maintained checks and independent
review; local implementation commit `76bb5dcd9` and status commit `2f7c47cae`.
Checkout is main, index empty. Unrelated tasks 48–59 pipeline edits and untracked
Pyodide plan remain unowned. No push/release or README edits are authorized.

## Ownership and contract preparation

Root owns this plan, sole `docs/specs/docx.md` wording, research evidence and only
task 62's pipeline status hunk; product integration is limited to
`packages/docx/src/index.ts`, `inspection-command.ts` and
`scripts/docx-exports.test.ts`. Root owns exact literal safe integration test
registration in `packages/safe-bash/scripts/integration-inputs.test.mjs`.

Domain leaf owns new `packages/docx/src/revision-decisions.ts`,
`revision-decisions-command.ts`, `revision-decisions.test.ts`; any shared change
to `revisions.ts` needs notification first. Schema leaf owns `discovery.ts`,
`discovery-result-schema.ts`, `discovery.test.ts`, `operation-schema-data.ts`,
`operation-types.ts`, `operation-json-schema.ts`, and new
`revision-decisions-command.test.ts`. Schema leaf additionally owns separately
assigned `command-selection.ts` for
whole-token admission; its new conditions require original failing tests.
The existing `tracked-text-command.test.ts` former unsupported-decision assertion
is separately assigned to the schema leaf for bounded task 62 advertisement.
Final maintained checks separately assigned `revisions.test.ts` to that leaf for
the canonical exact support assertion that still expected unsupported decisions;
all revision-read behavior tests remain intact.
Shell leaf owns only new
`packages/safe-bash/tests/commands/docx/revision-decisions.test.ts`. A different
leaf independently reviews the final diff. Leaves do not perform Git operations.

Investigation before code identified that read-supported insertion/deletion and
move metadata does not imply editing admission. The sole format contract now
states exact inline text and direct exposed-property snapshot decisions, required
containers, conservative structural/nested boundary rejection, selection/report
and repeated-operation semantics. This plan adds no competing format contract.
All candidates must preflight before staged mutation/publication. Unsupported
mixed selection fails atomically. Range and namespace preservation remain required.

## Ordered QA procedure

1. Write original small failing memfs tests before product code. Check accept
   final/reject original text, direct format keep/rollback, namespace scope,
   selection ordinals/tokens/all and unchanged unrelated ranges/review.
2. Reject mixed unsupported/nested/structural candidates before staging. Exercise
   dry-run, invalid/limit/cancellation/publication failure and repeated no-match
   semantics; do not pretend removed annotation tokens remain live.
3. Run focused leaf tests, then independent review and maintained uncached DOCX
   unit/lint/selected build closure, public export and actual opt-in Shell checks.
   Register the new integration input by exact literal path; preserve seals.
4. Execute actual supported help/results/errors and original/final text workflows;
   render terminal captures and inspect screenshots. No screenshot unit tests.
5. Record exact checks and limitations, then make verified atomic local
   Conventional Commits of explicit owned paths. Isolate only task 62's status
   hunk from unrelated pipeline edits. Do not start task 63 before verification.

Corpus manifests, both upstream test/API audits and inventories remain preparation.
Product parity and corpus/renderer qualification remain unverified by these unit
checks. No copied reference identities/code/assets, native product dependency,
ambient host I/O or implicit network is admitted. All QA procedure stays here;
durable findings belong under docs/docx. Cache cleanup remains later work.

## Red evidence and registration

Root portable-export test failed with the absent public decision function at
`/tmp/docx-decisions-public-red.log` (one failed/one passed). Real Shell tests
failed all three at `/tmp/docx-revision-decisions-shell-red.log`: commands returned
unsupported-profile rather than executing decisions or semantically rejecting
mixed unsupported selections. Schema leaf reproduced accepted range tokens and
missing decision advertisement, then separately absent/conflicting selection
types and missing generated schema alternatives before their corrections.

The new Shell test is registered by exact literal path. Maintained
`npm run test:runner --workspace=virtual-bash` passed 515 tests with zero skips
at `/tmp/docx-decisions-integration-registration.log`; membership verification
alone is not passing product decisions or the full safe-bash unit gate.
Independent read-only investigation confirmed the clarified contract and sent
namespace, deletion-text, property-container and annotation/field boundary hazards
to the domain leaf. Final independent implementation approval remains pending.

## Earlier evidence requalification

Expanded task 62 tests reproduced an enclosing complex field bypass when a guard
parsed the document root rather than the admitted story; the root-level traversal
skips body content. During the same investigation the leaf concretely reproduced
that bypass in task 61 tracked replacement. Root separately assigned only
`packages/docx/src/tracked-text.ts` and `tracked-text.test.ts` for a failing
original regression and prerequisite correction. The earlier affected evidence
must be requalified and the correction committed separately before task 62 closes.
Task 63 remains pending; no unvalidated unrelated editor is changed.

The task 61 prerequisite correction was independently approved and requalified
with 43 tracked/replacement tests, maintained DOCX lint and selected build closure,
then committed locally as `817f97802`. The field-error screenshot was inspected;
task 61 retains historical and corrected evidence separately.

Final independent task 62 review reproduced lost inherited xml:lang/xml:space
when unwrapping a review owner. Root reactivated only the domain decision utility
and its original tests for red-before-code fidelity correction; effective XML
inheritance and descendant overrides were clarified in the sole format contract.
The independent all-DOCX Shell check passed 49 tests with zero skips at
`/tmp/docx-decisions-independent-shell.log`, but predates this required correction
and remains baseline evidence until reverified. Schema/discovery is independently
frozen with 29 focused tests and maintained DOCX lint passing; its advertisement
does not substitute for final implementation approval.

Corrected inherited XML cases passed 29 decision tests and maintained DOCX lint.
Final independent review approved bounded domain/schema/export/adapter wiring;
43 focused tests and all 49 DOCX Shell tests passed with zero skips at
`/tmp/docx-decisions-independent-shell-final.log`. Root maintained lint, selected
build closure and seven public-export/existing command tests passed. The first
full DOCX unit attempt found one stale canonical support expectation in
`revisions.test.ts`; its full result remains preserved and a corrected maintained
unit rerun is required before completion.

Actual help, binary acceptance-to-text, VFS `.sh` rejection-to-text, human dry-run
and missing-selection JSON were executed on original in-memory Morning/Evening
tide review. Acceptance produced Evening tide, rejection Morning tide, dry-run
reported two revisions and missing ordinal returned status 1 with affected zero.
Capture `/tmp/docx-decisions-visual.ansi` was rendered through terminal-png and
the resulting `/tmp/docx-decisions-visual.png` inspected. Current help uses a wide
layout; this is terminal evidence, not independent Word rendering or corpus QA.

Final maintained uncached unit rerun passed 80 files/1,952 tests at
`/tmp/docx-decisions-final-unit-corrected.log`; original one-failure/1,951-pass
attempt remains at `/tmp/docx-decisions-final-unit.log`. Corrected maintained
lint passed at `/tmp/docx-decisions-final-lint-corrected.log`; selected build
closure and seven portable export/existing command checks passed at
`/tmp/docx-decisions-final-build.log` and `-public.log`. Diff checks passed.
Final independent review and all 49 DOCX Shell checks qualify the frozen corrected
source. No full pipeline, model parity, corpus/renderer gate, remote delivery or
release is claimed. Task 63 remains pending until the owned local commit.
