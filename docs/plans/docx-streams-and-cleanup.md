# DOCX streams and cleanup execution record

Status: implemented and verified.

Scope: only `streams-and-cleanup` in the ordered DOCX pipeline. File publication
and all later tasks remain pending. Work is on main. The pre-existing pipeline
edits and archived-plan move are unrelated and remain unstaged.

## Owned paths

- `packages/docx/src/io.ts`, `io.test.ts`, and the package index export.
- `packages/safe-bash/src/commands/docx/io.ts` and its original command tests.
- The exact test discovery assertion in safe-bash's integration-input test.
- `docs/docx/stream-lifecycle.md` and this execution record.

The root owns core implementation/docs/Git. A leaf worker owns the safe-bash
adapters and scoped verification, as required by its AGENTS.md. A different
worker independently reviews lifecycle behavior and adapter changes. A separately
recorded type-only codec adapter correction resolves the maintained typecheck
prerequisite; it belongs to its own atomic commit.

## Evidence and implementation

The first maintained DOCX red run had 11 new failing cases (missing DocumentIo)
and all 388 existing tests passing. The first green attempt caught an incorrect
new-test main-part spelling, corrected to the established relative package name.
Existing tests and fixture data were preserved. Additional tests exercise immediate
registration cleanup, source acquisition reentry, cancellation during parsing and
finalization, and write-payload reuse.

Independent review reproduced a late sink failure hidden by the existing writer's
cancellation catch. The new original regression failed with `cancelled` instead
of `sink-failure` while 404 tests passed. The new I/O boundary now retains the
escaping sink error and its cause; borrowed caller cancellation still wins.
The existing archive-writer API and its historical tests are unchanged.

A separate original tiny-fragment regression tests admission of per-fragment
retained bookkeeping, in addition to byte storage: its red run produced 65 chunks
rather than rejecting the second, with 405 other tests passing. Empty chunks consume finite
work and never accumulate empty arrays. All file mutations in core tests use
memfs. No downloads, native reference build, host product I/O or networking were
introduced. A further red test showed acquisition work was charged without
feeding the cooperative scheduler (invalid-container instead of acquisition
cancellation, 406 other cases passing). Acquisition now checks work before
copying and charges it through the cooperative checkpoint after taking ownership.

Adapter tests failed before implementation, then passed for existing byte helpers,
borrowed cancellation/late rejection, backpressure, errors, reuse, cleanup before
owned output acquisition, pending-write drainage, sibling isolation and direct
contexts without hooks. A second red run established the `open` capability
spelling before aligning it with the API mapping. Exact discovery registration
preserves historical runner membership.

Core cleanup observes admitted promises, closes admission synchronously and
shares its draining completion across repeated/reentrant calls. The scope borrows
caller/budget signals without aborting them. Output scopes enroll destination
capabilities explicitly; borrowed opaque work retains the existing byte-helper
settlement contract. API and security mapping details are recorded in
`docs/docx/stream-lifecycle.md`. The model API inventory remains planned; byte
infrastructure does not certify a factory/save or whole-model implementation.

## Maintained verification

- `npm test --workspace=docx`: 407 tests passed in 13 files, including 19
  new original lifecycle cases and all 388 existing cases.
- `npm run lint --workspace=docx`: passed ESLint and source/test TypeScript.
- `npm run build:workspaces -- --workspace=docx`: passed the declared
  office-package/safe-fs/docx dependency closure.
- `npm test --workspace=virtual-bash -- --test-shard=158/1122
  --test-name-pattern='<anchored alternation of the 11 adapter titles>'`: 11
  passed, zero skipped. The shard numerator/denominator were derived from current
  `discoverTests`/`loadBoundaries` membership, not a fixed task list. The earlier
  name-filter-only run was interrupted after 200 file loads (exit 130); it is
  not a completed gate. The current runner does not consume SAFE_BASH_TEST_RG,
  so that unsupported environment filter was not used.
- `npm run test:runner --workspace=virtual-bash`: 500 runner tests passed.
- `npm run typecheck:all --workspace=virtual-bash`: passed production build,
  source/tests and the maintained 26 consumer groups, following the separately
  recorded declaration correction.
- Existing focused ZIP/compression tests: 91 passed. These direct node/tsx
  checks supplement, rather than replace, the maintained gates above.
- Final built ESM DOCX export plus safe-bash byte adapters: an original memfs
  document round-trip passed with both registered cleanup scopes and an unaborted
  borrowed caller signal.
- Independent review accepted core/adapter ownership and failure precedence,
  the capability spelling and the type-only declaration correction.
- `git diff --check`: passed.
- Guarded `npm run lint:eslint`: passed, complete=true, 12,393 configured
  subjects linted, zero errors and no gaps/unprocessed subjects. Twelve warnings
  concern existing disposable `.cache/pptx-usage-review/example.mts` QA, with no
  owned-source diagnostics. No scope drift was reported.
No public command/UI changed, so CLI screenshots are not applicable to this
transport-only task. No push or release is authorized.
