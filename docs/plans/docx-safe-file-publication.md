# DOCX safe file publication execution record

Status: implemented and verified.

Scope: only `safe-file-publication` in the ordered DOCX pipeline. All later tasks
remain pending. Work is on main. Existing edits to the main pipeline and the
archived-plan move are unrelated, remain unstaged, and are not included here.
This record is the owned task-state update; it does not rewrite that dirty plan.

## Owned paths

- `packages/docx/src/publication.ts` and `publication.test.ts`.
- Publication exports in `packages/docx/src/index.ts`.
- `docs/docx/file-publication.md` and this execution record.

No safe-bash product changes, shared codec changes, root wiring changes, README
edits, downloads, native reference builds, product host I/O, or networking.
The existing safe-bash VFS and byte-sink contracts supply the needed authority.
Command construction and selectors remain later tasks; this engine does not
claim public command or model-save coverage.

## Red/green evidence

The first maintained DOCX run had 17 new failing tests (missing publication
exports) and all 407 original tests passing. Tests preceded product code.
The first implementation exposed two new-fixture mistakes: directory snapshot
checks incorrectly included mutable timestamps/access time, and captured mock
wrappers recursed after replacement. The memfs fixture now checks the actual
VFS identity/revision contract, including synchronous conditional publication.
All 424 tests then passed.

Seven further regressions produced two product failures: the caller could reuse
archive bytes during awaited destination inspection, and dry-run did not reject
a stale admitted in-place snapshot. A third failure identified missing realpath
and access methods in the new mount fixture; the fixture was completed to use
actual mount and read-only forwarding over memfs. The corrections passed all
431 tests. Cancellation after commit preserves receipts; cancellation after
staging acquisition awaits owned cleanup. Cleanup failure retains the published
manifest and never deletes the committed file.

Three original protection-marker regressions proved force could publish packages
with protection or locked controls. Publication now conservatively refuses those
markers and signed content pending the later feature-specific authorization task.
The initially attempted budget test used an invalid subclass field on the frozen
budget; a second version overrode a method not retained by lowered budget views.
Neither was accepted as evidence. The final regression uses a real successful
budget ledger and repeats with its retained-byte ceiling lowered by one. It
reproduced `sink-failure` instead of `limit-exceeded` during internal byte staging;
the internal staging boundary now preserves the actual resource failure.
All 435 tests passed after these corrections. A final targeted red assertion
proved post-staging cancellation had the correct code but the wrong class. The
publication cancellation subtype now extends the existing CancellationError and
retains completed-file and partial-stdout evidence.

Two final original regressions showed extraction dry-run options could be changed
during preflight, and truthy nonboolean flags could authorize publication. Both
failed before adding common option validation and owned extraction intent.
The final package run passed 437 tests with no skips.

The tests use original package data and memfs for every mutation, including
hard-link aliases, actual mount/read-only wrappers, remote-like missing
capabilities/identity, concurrent destination creation, partial stdout, extraction
preflight, partial publication and cleanup. No historical tests were rewritten.

## Maintained verification

- `npm test --workspace=docx`: 437 passed across 14 files, no skips.
- `npm run lint --workspace=docx`: passed ESLint plus source/test TypeScript checks.
- `npm run build:workspaces -- --workspace=docx`: passed the maintained safe-fs, office-package and docx dependency closure.
- `git diff --check`: passed.

Final exit statuses were checked before committing this record. The name-filtered
budget red run was targeted evidence, not a substitute for the full package gate.
No public command/UI changed; screenshots do not apply to these package-only
publication primitives. Model, command, full protection editing and whole-format
conformance remain unverified. No push or release is authorized.
