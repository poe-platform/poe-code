# Advanced chart CLI preservation

## Ownership and scope

Assigned adapter evidence lives in the existing clean
`packages/safe-bash/tests/commands/pptx/chart-editing.test.ts`; no new test
discovery registration or adapter implementation is required. The domain owner
implements package import safety separately. Root owns commits and integration.
No README, downloaded fixture, pipeline, push or release work is included.

Apply root and safe-bash AGENTS, `docs/specs/pptx.md` F08/F39 and shared office
CLI/SDK contracts. Consult both upstream audits/inventories and the corpus
manifest. Source-case accounting belongs to the domain/research receipt; these
original adversarial graph cases supplement that inventory and do not establish
live model API parity.

## Original regression design

- Author an original memfs package with combined 3D and line plots, trendline,
  error bars, a chart extension, chart-style relationship and transitive image.
- Run actual Shell plus `pptxCommands` using the public `pptx` engine import.
  Inject memfs reads and request binary stdout; there is no implicit host I/O.
- Replace slide-local text and independently inspect output ZIP records/CRC.
  Compare SHA-256 for every input part except the changed slide.
- Import into a deck with colliding original part names. Assert exact chart,
  style and image hashes, retained relationship IDs and remapped targets at
  both graph edges, plus unchanged source and destination input bytes.
- Put unknown foreign content in a chart extension. Require status 1,
  `unsupported-edit`, zero affected objects/null data for JSON dry-run and
  zero binary stdout for failed publication.

## TDD receipt

The first focused Node run reproduced safe import failing with status 1:
`Import encountered an unsupported dependency type.` Unrelated text replacement
already preserved all non-slide hashes. The initial negative-case assertion
expected the later remapping message, but the earlier dependency rejection had
the same required stable error code; the assertion now checks that contract.

## Manual QA procedure

1. Rebuild the selected pptx workspace through the maintained workspace builder
   after domain changes, so CLI checks exercise current public exports.
2. From `packages/safe-bash`, run `node scripts/test-reporting.mjs --import tsx
   tests/commands/pptx/chart-editing.test.ts
   tests/commands/pptx/chart-inventory.test.ts`. Validate style with the appropriate
   maintained lint route and inspect the final diff.
3. Capture chart help or a bounded chart import failure through the maintained
   `npm run screenshot` generic route. Inspect the PNG for legible error text,
   correct branding and no XML/document-content leakage. Keep screenshots under
   `.cache/pptx-corpus`; never commit binary QA artifacts or ad hoc executables.
4. Publisher corpus QA, if run, must use a manifest-listed input with matching
   SHA-256. No corpus bytes or downloads are unit-test prerequisites. Unavailable
   or unexecuted corpus cases remain unverified.
5. Root commits explicitly owned changed files only after checks pass. Report
   local commit separately; do not push or release.

## Final validation

After root's maintained selected pptx build passed, the maintained reporter
command above passed all nine cases in 1.82 seconds, including the three new
regressions. A first reporter invocation omitted `--import tsx` and failed module
resolution before running tests; supplying the loader used by the maintained
package runner corrected the invocation. That failure was not a product defect.

`npm exec -- prettier --write packages/safe-bash/tests/commands/pptx/chart-editing.test.ts`
formatted the owned test. Root coordinates the guarded lint check.

The full root `npm run lint:eslint` run was incomplete: exit 2 at the 12,000
subject cap, with zero reported errors before the cap. This is not a root lint
pass. The safe-bash package has no maintained narrower lint script and the root
wrapper intentionally rejects path arguments.

Root authorized a focused call through the existing exported guard capability.
Procedure: in a fresh Node process, bootstrap-read the package/config bindings;
load the unchanged guarded root configuration; assert matching bindings and no
bulk-suppression file; create its `createLintSelection`; begin the one-shot guard;
load and verify all 25 boundary receipts; classify the one exact owned test path;
read it once through `guard.read(path, "subject")`; pass those admitted bytes to
the selection's existing `eslint.lintText` with its exact absolute filename.
Do not change config, caps, ignores, formatters or selection rules. Record the
literal subject hash, messages and guard counters rather than claiming traversal.

Focused result: exit 0, one subject, 11,445 bytes, zero errors/warnings/messages,
25 receipts verified, `receiptsComplete: true`, `failed: false`, and 2,009 opens
matched by 2,009 closes. SHA-256:
`050b90cb179aa856c0097eea8332e293402783b01b09d737553bef0333df32eb`.
The first ad hoc invocation attempted to reread the subject for a post-read
comparison; the one-shot guard correctly refused `duplicate lint subject` with
exit 2. The successful fresh invocation made exactly one subject read. This is
changed-file guard-API evidence, not full-root completion or a new lint route.
No executable QA/lint script is committed.

The maintained generic screenshot command captured an actual Shell invocation of
unsafe chart import against a small original memfs deck. The inspected image is
`.cache/pptx-corpus/advanced-chart-import-rejection.png`: legible command/error,
exact `pptx` branding, `unsupported-edit`, exit status 1 and no binary stdout or
document XML/text leakage. The PNG is disposable and excluded from the commit.
No publisher-corpus acceptance is claimed by this CLI regression task.
