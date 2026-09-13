# Legacy comments implementation and verification

Scope: F50 legacy comment CRUD and F07/F08 author reconciliation when slides are
removed/imported. The requested task does not authorize a whole pipeline, push,
release, README edits or changes outside each worker's ownership.

## Ownership

- Engine worker: original comment model/editor and package regressions.
- CLI worker: comment routes/schema and original memfs command regressions.
- Research worker: this plan and `docs/pptx/comments-evidence.md`,
  `docs/pptx/comments-case-map.json`, `docs/pptx/comments-usage.md`.
- Coordinator: shared integration/export wiring, import/delete reconciliation,
  maintained checks, review and atomic local commits with explicitly named files.

## Sequence and acceptance

1. Read the format/shared specs, pinned unit/BDD/public-API inventories and corpus
   manifest. Distinguish legacy annotations from core-property description fields.
2. Write original failing tests before implementation. Assert authored XML and
   unrelated member bytes independently of SDK readback. Use supplied bytes and
   memfs; unit tests neither write host files nor download documents.
3. Implement explicit author/time CRUD. Verify duplicate display names, stable
   author IDs, author-local indices, comment positions, timestamp validation,
   imported/deleted slides and conservative author cleanup.
4. Expose plural `comments list/get/add/set/remove`, common selectors/publication,
   JSON, schema and capabilities through the same SDK domain behavior. Reject
   stale/ambiguous selection and invalid inputs before publication.
5. Run the maintained selected workspace build, pptx unit and lint routes and the
   focused safe-bash command suite and lint. Capture and inspect CLI help/output
   with the maintained screenshot tooling; keep outputs disposable and untracked.
6. Stage only owned implementation/tests and this focused research receipt after
   checks pass. Commit on main with a Conventional Commit, without pushing.

## Disposable QA procedure

Read only manifest-listed cached files. Verify each selected file's SHA-256
against the manifest before using it. Independently enumerate ZIP members and
parse XML to census legacy comment/author and modern annotation parts. Start with
small template inputs; inspect a larger presentation only if useful. Do not infer
legacy annotation coverage from a document with no annotation parts.

For a admitted document, create a comment on an existing slide using an original
text, explicit author and UTC timestamp; read/update/remove it in memory. Compare
all unrelated uncompressed member bytes. Import/remove a commented slide and
inspect author references directly. Preserve original cached bytes; no downloaded
asset becomes a permanent fixture. Reduce a meaningful failure into a small
original in-memory regression before fixing it. Record executed evidence and
limitations separately from this procedure.

All QA binaries, screenshots and outputs remain uncommitted. Do not delete any
unowned cache data. Reference provenance belongs in research and required legal
notices only; preserve existing MIT notices.

## Executed research and QA receipt

Reviewed both expanded inventories and public API reconciliation. No direct
legacy annotation cases exist in the pinned baseline; the focused ledger retains
false-positive metadata/enum matches and 121 adjacent lifecycle cases without
claiming their implementation. No source assets were copied.

Verified two manifest hashes and performed in-memory SDK add/read/set/remove on
both. Creation touched only required registration parts; set changed only the
selected comment XML. Original inputs remained unchanged. Captured the real
safe-bash comment help and missing-timestamp error through the maintained generic
screenshot runner and opened the output for visual inspection. Screenshot remains
at `.cache/pptx-comments-cli.png` and must not be staged.

No whole pipeline, push, release, README edit or binary cleanup was performed.
Final maintained check results and local commit hash are the coordinator's
responsibility. See the focused evidence for the remaining position convention
source/renderer-validation limitation.

Independent cross-API review reproduced invalid singular comment MIME registration
and missing duplicate author-local identity checks during import. Both were reduced
to original regressions before correction. Repeated both corpus CRUD checks after
the MIME fix, independently parsing and asserting the registered plural content
type. Refreshed and inspected the final help screenshot after selector help changed.

Coordinator verification checkpoint: maintained whole pptx tests passed 161 files
and 4,152 tests; a subsequent test-only unfiltered-get regression passed in the
13-case focused command suite. Full safe-bash pptx suite passed 156 tests.
Final maintained selected workspace build and `npm run lint --workspace=pptx`
passed. Scoped command/test ESLint passed. Local commit recording remains the
coordinator's responsibility. Counts refer to distinct checkpoints, not additive suites.
