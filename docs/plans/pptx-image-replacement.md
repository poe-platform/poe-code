# Occurrence-local image replacement

Scope: implement the requested F32 slice in `packages/pptx`, exposed by the existing
SDK-backed command engine and safe-bash adapter. This task does not run the wider
pipeline or claim complete image/model API coverage. Read root and safe-bash
AGENTS, the PPTX and shared Office CLI/SDK contracts, both upstream audits and
inventories, and the corpus manifest. Preserve unrelated working-tree changes.

## Ownership

Root owns image-replacement.ts, its original unit tests and index export, final
maintained package checks and local commits. The CLI worker owns command-engine,
image schema, command tests, registered safe-bash tests and its plan/usage draft.
The accounting worker owns the bounded research ledger and corpus QA receipt.
No README edits, push, release, native product runtime, ambient I/O or downloads.

## Behavior

`replaceImage` is always async and accepts explicitly admitted presentation/image
bytes and context capabilities. It snapshots caller bytes/options before awaiting
input. Default replacement clones the media and rebinds only selected occurrences,
including when two pictures use the same relationship ID. Explicit `shared`
retargets every relationship to the selected media part and reports occurrences
across slides, masters, layouts and notes, with affected slide positions.
`all` remains inside the selected scope until shared intent is explicit.

Crop, shape transform, description and title preserve by default. False crop
preservation removes srcRect; false geometry preservation resets the shape to
intrinsic image dimensions at origin without rotation/flips; false alt preservation
removes description/title. Supplied altText overrides description, including an
empty string. No supplied aspect/fit transformation is implied. Equal bytes/type
and unchanged preservation policies return the original package bytes.

Rebinding removes an old relationship only after checking the owner's remaining
relationship attributes, including unknown extension consumers. Old media is
removed only after all incoming relationships are rebound/removed. Its override
and newly unused extension default are removed, with case-equivalent OPC identity.
The new media gets a matching extension and explicit content type. Result package
validation and cancellation precede returned bytes/publication.

The bounded edit profile rejects external, SVG/fallback and resource-owned
relationship graphs, plus shared non-image consumers. These limitations are
explicit; F34 and complete Picture/placeholder model behavior remain separate.
See the research ledger for every relevant source case and remaining obligations.

## TDD and QA procedure

1. Write original memfs tests and independently inspect ZIP payloads and parsed
   attributes. Run the new tests to observe missing API failures before implementation.
2. Exercise one source resource across two slides (including two same-rId pictures),
   a master and notes. Assert exact bytes, graph bindings, occurrence reports,
   untouched owners, Strict dialect, crop/geometry/alt options, empty and stale
   selections, snapshots, limits and cancellation.
3. Add failing regressions for identical-byte no-change, case-equivalent stale
   content-type declarations and resources owning relationship parts; fix only
   demonstrated behavior.
4. Run maintained `npm test --workspace=pptx`, `npm run lint --workspace=pptx` and
   `npm run build:workspaces -- --workspace=pptx`; the CLI worker runs exact
   registered safe-bash tests and maintained scoped lint. Inspect help/error PNGs.
5. Execute the accounting plan's manifest-authenticated disposable shared-image
   corpus experiment. Preserve downloaded originals and keep all output untracked.
6. Review and stage only owned files; create atomic Conventional Commits on main.
   Report local hashes separately. Do not push or release.

## Evidence

Initial nine tests failed because the replacement API did not exist, after fixing
fixture construction to retain mandatory group/master/notes structures. The first
implementation passed those nine cases. Subsequent independent tests caught and
repaired unnecessary rewrites of equal media, stale case-equivalent overrides and
late graph failure when deleting media with its own relationship part.

Final domain suite: 28 passing original tests. Maintained `npm test --workspace=pptx`
passed all 3,140 tests in 110 files. Package lint and workspace build closure passed.
The CLI worker verified 10 direct command cases, the actual safe-bash memfs script
and cancellation case, and all 107 integration registration guard tests. Both help
and error PNGs were inspected. Manifest-authenticated local/shared corpus QA passed
with original fixture unchanged; see the accounting evidence receipt.

## Commit blocker

`npm run lint:eslint` exited 2 at its fixed 12,000-subject cap (zero lint errors and
warnings, 12,000 subjects linted, 12,001 configured before failure). The next subject
was `packages/acp-telemetry/src/trace-sink.ts`; guard counters recorded 3,307,195
metadata operations. The check is incomplete, not passed. The literal cap is in
`scripts/lint-input-guard.mjs` and scoped AGENTS requires other limits to remain
unchanged. Do not raise it, suppress inputs, or treat partial coverage as a pass.
No deterministic rerun can clear this cap without a separately authorized guard
policy change. No local commit was made because the task requires successful
maintained checks first. All owned files remain reviewable and unstaged. No push,
release, README change or whole pipeline execution occurred.
