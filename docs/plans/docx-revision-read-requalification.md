# Revision read verification recovery

Status: implemented and verified. Ordered task 60, `revision-read-views`,
passed its recovery gate. Task 61 and all later tasks remain pending here.

## Checkout and ownership

Execution began on `main` at
`48f8b120e3685f42593f5d1c2e3ec73c543ce719`, with an empty index.
Pre-existing unstaged changes to `docs/plans/docx-typescript-safe-bash.md` and
the untracked `docs/plans/pyodide-cloudflare-safe-bash.md` are preserved.
The pipeline's pre-existing task 60 state is implement done, test failed;
the earlier implementation record's passing evidence does not clear that state.

Root owns this record, Git coordination and any separately assigned integration
or export correction. No integration/export correction is currently assigned.
Root also owns the task 60 status hunk in the pipeline and the supplemental
link in the original revision task record; other pipeline changes are unowned.
The implementation leaf owns `packages/docx/src/revisions.ts`,
`revision-markup.ts`, `revisions.test.ts` and `text-replace.ts`.
A different read-only leaf independently reviews correctness and verification.
No safe-bash source or guarded historical evidence is owned for editing.

Root and workers read the root/scoped instructions, task prompt, authoritative
format/shared contracts and existing revision evidence. Corpus and upstream
audits/inventories remain preparation/provenance, not product test results.
No downloaded assets, reference code, native product dependency, implicit I/O,
networking or README edits are authorized by this recovery.

## Verified interpretation boundary

Original direct snapshots are supported only for the exposed context fields:
run `b`, `i`, `rtl`, `vanish`, `rStyle`, `lang`, `rFonts`; paragraph `pStyle`,
`bidi`. Other standard properties and extensions remain opaque; original view
retains current direct context and discloses a warning rather than inventing
rollback. Supported snapshots require singleton fields, admitted attribute
namespaces/names, valid toggle lexemes, no nested properties and only XML
space/tab/CR/LF text. Language/font strings remain lexical metadata; this is not
full schema validation, style resolution or accept/reject support.

## Validated defects and acceptance procedure

1. Add a failing original in-memory regression: final revision listing must omit
   nested history in deleted rows; original must omit it in inserted rows.
   Verify scoped one-based revision ordinals after filtering and all-view retention.
2. Add a failing original in-memory regression: literal replacement inside a
   story-level move/custom-XML review range must reject before publication.
   Verify unrelated edits remain possible and inactive alternatives remain inert.
3. Investigate malformed/opaque property snapshots; only reproduced defects
   receive failing regressions and code corrections.
4. Independently review corrected source/tests and rerun maintained DOCX unit,
   lint and selected workspace build routes. Run existing portable exports and
   safe-bash DOCX integration tests without changing their literal registration.
5. Capture actual command-engine help, view-filtered JSON and unsafe-edit error
   output. Render with the maintained terminal renderer and inspect the PNG.
6. Commit only verified owned paths as an atomic Conventional Commit on main.
   Preserve the unrelated pipeline edits and index. Do not push or release.

## Baseline reconciliation

The preparation snapshot is historical. Current SHA-256 inputs are:

| Input | Current SHA-256 |
| --- | --- |
| Format contract | `cd64a8cfa3b080129cce9074554549d284c4ffe8c7e8ebbaa8367e426216563e` |
| Shared CLI | `cb5614e03c841f31d98efe4bcf2aabdb419926aa26775d17b401598d9a2d74ce` |
| Shared SDK | `a73354b0e643eef159f9bda0cb9b096234fb34f0d224c3fbead5a92f38e673b9` |
| Corpus manifest | `e77009a4942a6841184076ad7eb401725476ef5d8bc18ea74b1a5444acfb4b1f` |
| API inventory | `10955a17b17ac1b334c5854ce7048970f9033ddb0408322bef3e3586d19e44ac` |
| Test inventory | `14c609ceb775158cb36c0423d24678b4a3e9f09d429085730b28103a759ad797` |

The manifest now has 23 real downloads, with the earlier 19-file census preserved;
the reconciled API inventory has 920 records. The source-case inventory remains
1,609 unit variants plus 650 expanded BDD cases. The original task's mapping
record finds no revision-specific live owner in that finite public inventory;
this recovery implements additive format-contract tests, not a public-API closure.
No corpus operation or cleanup is performed. Recorded wording drift is already
resolved in the authoritative contract: original behavioral adaptation is allowed,
`allowEmpty` and explicit match cardinality govern replacement, and CLI geometry
remains distinct from model native-image sizing. No competing spec is added.

## Interim evidence

The implementation worker recorded six failures against the previous product
files in `/tmp/docx-revision-investigation-red.log`, then 53 focused passes in
`/tmp/docx-revision-investigation-green.log`. Independent review reproduced
malformed/duplicate property-history acceptance; three additional red failures
are recorded in `/tmp/docx-revision-investigation-malformed-red.log`.

The malformed log contains two validated failures plus an incorrectly expected
missing-style outcome already rejected by existing package admission. That case
now asserts existing rejection and is supplemental, not a newly fixed defect.
Two non-whitespace-content failures precede their fix in
`/tmp/docx-revision-investigation-content-red.log`; two NBSP failures precede
explicit XML whitespace admission in
`/tmp/docx-revision-investigation-xml-whitespace-red.log`.
There are twelve validated pre-code failures in total and one supplemental case.

Root workspace unit runs overlapped addition of the failing regressions and remain
interim failure evidence, not final passing checks. The first reports 6 failures
and 1,883 passes; the second is also superseded by the snapshot correction.
An intermediate frozen workspace run passed 1,894 tests before the NBSP change;
it is retained separately from the final revision's required checks.
Initial maintained lint and selected build passed before that last correction
and will be requalified. The actual command-engine screenshot
`/tmp/docx-revision-requalification-cli.png` was inspected: help, filtered row
inventory, final text and unsafe-edit exit 1 are readable and unclipped. No
independent document renderer was used. Logs/images remain disposable QA outputs
outside the product and commit.

Independent review approved the final bounded diff and whitespace correction.
The worker's final focused run passed 60 tests (30 revision, 30 replacement),
and final direct scoped safe-bash integration passed 42 with no skips.
This direct Node route is not a maintained full virtual-bash npm test claim.
Existing literal integration-input membership is unchanged; no historical seal
was rewritten. Product source/comments/tests/fixtures/output introduced by this
task contain no reference identities, copied code or downloaded binaries.

## Final maintained checks

The final frozen source passed:

- `npm test --workspace=docx`: 76 files, 1,896 tests, no skips;
  `/tmp/docx-revision-final-unit.log`.
- `npm run lint --workspace=docx`: ESLint, source/test TypeScript;
  `/tmp/docx-revision-final-lint.log`.
- `npm run build:workspaces -- --workspace=docx`: declared selected workspace
  closure and native postbuild hooks; `/tmp/docx-revision-final-build.log`.
- `npx vitest run scripts/docx-exports.test.ts packages/docx/src/text-command.test.ts`:
  seven tests; `/tmp/docx-revision-final-exports.log`.
- Direct scoped safe-bash DOCX integration: 42 passed, none skipped;
  `/tmp/docx-revision-requalified-shell.log`.
- Independent bounded review, inspected CLI screenshot and `git diff --check`.

F26/F27 read interpretation and affected-edit rejection are qualified only for
the recorded subset. Tracked creation, acceptance/rejection, whole public API,
corpus/large-document campaigns, native-renderer evidence and the final
cross-workspace gate remain pending. No downloads or manifest files were
deleted. README permission is still pending; no README is changed. The sole
format contract remains proposed with Implemented Through unchanged.

This recovery is one atomic local Conventional Commit of explicitly owned paths
on main. Only task 60's status hunk enters the pipeline-plan commit; pre-existing
status edits for tasks 48–59 remain unstaged. The unrelated untracked plan is
preserved. No push, remote-main delivery or release publication is claimed.

This record supplements the original task evidence; it does not replace the
format specification or erase historical passes/failures. No whole-API, corpus,
rendered-document or full OOXML completion follows from this scoped gate.
