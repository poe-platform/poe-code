# Whole public API acceptance

Task: `whole-api-acceptance` only. Branch: `main`. No push or release.

## Ownership

Root owns this record, `docs/docx/public-api-map.json`,
`docs/docx/public-api-map-review.md`, new `docs/docx/whole-api-acceptance.json`,
new `docs/docx/whole-api-acceptance.md`, and new
`packages/docx/src/guide-style-identification.test.ts`. Existing modified and
untracked paths are unrelated and excluded from staging. In particular, root
does not own the existing edits to index.ts, inspection-command.ts, discovery,
packing/extraction, the format specification or the pipeline plan.

After the original guide test reproduced a getter-count defect, root additionally
owns `packages/docx/src/styles-model.ts` and `style-model-batch.ts` for actual
creating-getter mutation accounting only. These paths had no pre-existing edits.
The test expects no affected objects for existing-definition reads; creation
must still count and retain publication requirements. CLI execution uses explicit
dry-run because the model getter is permitted to create missing definitions.

The pipeline setup requires a different-worker review. `api_review` owns
read-only investigation and independent review, with no edits or Git operations.
No substantive safe-bash changes are authorized by this ownership assignment.

## Agent QA procedure

1. Read root/scoped instructions, the three specifications, both audits, complete
   API/test inventories and API reconciliation. Preserve all 1,337 map rows,
   all 920 source records, inherited/returned members, public underscore types,
   262 enum values and twelve guide files. Do not change the denominator to the
   implemented subset.
2. Bundle actual public exports in memory with browser/worker conditions and no
   external imports. Before documentary reconciliation, check the required
   `Document` factory and direct enum protocols. Missing prerequisites are
   failed acceptance evidence, never expected-failure passes.
3. Execute an original style-identification workflow through public synchronous
   model properties, the async SDK batch and the actual CLI command engine using
   only memfs. Check identical values, pure JSON, no publication and unchanged
   input. This qualifies this finite workflow, not general Document ownership or
   all style-guide headings.
4. Reconcile each row with actual operation schema IDs and available scoped
   original test links. A schema/export/test-title observation is structural
   evidence only. Mark missing owners and unresolved protocols as blockers;
   retain required behavior and prior disposition. Do not promote unexecuted
   methods, guide workflows or security/language mappings to implemented.
5. Run maintained package tests and lint, focused original workflow checks and
   scoped formatter checks. Preserve failing acceptance and tooling mistakes
   separately. Have the independent worker review the final documentary changes.
6. Commit each verified atomic improvement with explicit owned paths and this
   record. No ignored inputs, README edits, coauthors or hook bypass. Keep this
   task open if any public behavior remains unsupported; keep later tasks pending.

## Initial evidence

- Actual browser-bundled public `Document` is undefined; its required factory
  acceptance check fails. The proposed `WD_UNDERLINE.fromValue` is also undefined.
- The original register has 1,329 non-documentation-error rows without passing
  evidence. Existing bounded style/image implementations make the research-only
  wording stale, but do not establish whole model or guide coverage.
- A first scratch probe treated the operation register as an array. It is an
  object; the corrected probe enumerates its keys. This tooling mistake is not
  a product regression or a passing acceptance case.
- Independent review confirms missing Document/Paragraph/Run/Table/Section,
  comments, headers/footers and other public owners. Utility edits cannot close
  their synchronous/live/return/ownership obligations.

## Verified getter correction

- Original red: existing-definition read expected affected 0, received 1.
- Independent review prompted an original ordering red: a point-value operation
  before bootstrap caused creation to report affected 1 instead of 2. The test
  failed before the attribution correction. Neither expectation was weakened.
- Final focused run: 3 files / 16 passing tests, including three new memfs cases.
- Final maintained `npm test --workspace=docx`: 173 files / 3,426 passing tests,
  four skipped cases retained separately; exit 0. The earlier 172-file run
  predates the fix and is not the final candidate receipt.
- Maintained `npm run lint --workspace=docx`: exit 0, no errors and one existing
  operation-types.test.ts warning; source and test TypeScript checks passed.
- Final actual browser/worker barrel bundle: 175 working-tree exports, 1,517
  declared operation schema IDs, zero external imports. This snapshot includes
  unrelated uncommitted extraction/packing work and is not packed delivery proof.
- Human CLI check returned exit 0, no diagnostics and
  `docx batch: dry-run; 2 operations; 0 changes`. The general maintained screenshot
  route captured its exact output because DOCX is an optional command engine,
  not a root poe-code subcommand. Inspected
  `screenshots/cat-tmp-docx-whole-api-human-output.txt.png`: complete readable
  output, zero changes, no clipping. No screenshot test or fixture was added.
- Scoped documentary Prettier and `git diff --check` passed. Code source formatting
  follows the existing maintained package ESLint/type routes.
- Independent `api_review` final read-only review passed corrected creation
  attribution, capability boundaries, all 1,337 unique row/count/guide links,
  exact Image types and matching input hashes. No whole-owner claims were added.
- Raw run logs are disposable `/tmp/docx-whole-api-*-final.log`; reduced counts
  remain here and in docs/docx. No binary cleanup, native/runtime invocation,
  README change, push or release occurred.

Whole-row and complete-guide acceptance remains blocked. The pipeline and later
task states remain unchanged; no previous task is promoted by these checks.
