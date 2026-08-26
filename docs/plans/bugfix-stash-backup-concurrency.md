# Isolate agent-stash backup staging across concurrent writers

## Scope

- Change only `packages/agent-stash/src/backup-store.ts`, `packages/agent-stash/src/backup-concurrency.test.ts`, and this plan.
- No manifests, dependencies, README edits, user-file operations, network, Git operations, commits, or releases.
- Use deterministic memfs fixtures and gates, not timing sleeps, real filesystem fixtures, or LLM calls.

## Confirmed failures

- Same-timestamp allocation checks existence without claiming a staging directory. Concurrent callers can share metadata and payloads, return a record that does not match persisted metadata or restored bytes, or delete another caller's payload during failure cleanup.
- Different-timestamp writers have separate staging directories, but pruning interprets complete staging metadata as an id mismatch and deletes a live writer's directory. Atomic allocation alone is insufficient.
- Enumeration and pruning can encounter entries removed by another pruner between filesystem operations.

## Protocol and TDD sequence

1. Add gated public-API regressions for shared and independent filesystem wrappers, record/payload isolation, symlink-error cleanup, stale final-path checks, ownership after publication, live staging during list/prune, and concurrent disappearance. Confirm failures before production edits.
2. Claim candidate staging with nonrecursive mkdir, retry only EEXIST, and recheck final existence after claiming. Preserve timestamp ids, numeric suffixes, and the existing allocation bound.
3. Clean only an owned staging directory; clear ownership immediately after successful rename. Do not introduce an in-process mutex or random-only allocation.
4. Recognize staging names by the existing repeated-id naming convention and exclude them from listing/pruning without bypassing symlink refusal. Tolerate only ENOENT races; propagate other filesystem errors rather than treating them as malformed metadata.
5. Keep MAX_BACKUPS and read-before-delete restoration unchanged. Run focused tests, the agent-stash package suite, package/test typechecks, and scoped lint. Parent handles manual multiprocess QA and any individual commit/release.

## Validation results

- Red, before production edits: `node_modules/.bin/vitest run packages/agent-stash/src/backup-concurrency.test.ts --reporter=dot` — 19 failed, 11 passed in 1.53 s. Failures include returned A metadata with persisted B metadata, exact restored B bytes for A, symlink-error cleanup removing A's payload despite successful A publication, stale final-path checks replacing a published backup, live staging deletion, and concurrent ENOENT failures.
- Green: `node_modules/.bin/vitest run packages/agent-stash/src/backup-concurrency.test.ts packages/agent-stash/src/backup-store.test.ts --reporter=dot` — all 72 tests passed in 1.24 s, including all 30 new concurrency/control cases. Existing symlinked-metadata pruning still removes only the backup entry, never the link target.
- Package suite: `npm run test --workspace=agent-stash -- --reporter=dot` — all 499 tests passed across 13 files in 28.24 s. The repository-wide suite was not run.
- Package types: `node_modules/.bin/tsc -p packages/agent-stash/tsconfig.json --noEmit` — passed.
- Production/test types: `node_modules/.bin/tsc --noEmit --target ES2022 --module NodeNext --moduleResolution NodeNext --strict --esModuleInterop --skipLibCheck --resolveJsonModule packages/agent-stash/src/backup-store.ts packages/agent-stash/src/backup-concurrency.test.ts` — passed.
- Scoped lint: `node_modules/.bin/eslint packages/agent-stash/src/backup-store.ts packages/agent-stash/src/backup-concurrency.test.ts` — passed.
- All new fixtures use memfs and explicit gates. Public create/list/restore checks compare returned records to persisted metadata and restore exact UTF-8 bytes, including Unicode, NUL, and differing line endings. Shared and independent filesystem wrappers cover both successful writers and failed-writer cleanup.
- Timestamp suffixes, the 1,000-candidate allocation bound, MAX_BACKUPS=20, and read-before-delete restoration remain unchanged. Non-ENOENT enumeration errors propagate; malformed metadata and metadata symlinks retain their existing pruning behavior.
- No CLI presentation changes, so no visual screenshots were needed. No user-file operations, network, Git operations, manifests, dependencies, README edits, commits, or releases were performed.

## Parent review and QA

- Reviewed the staging claim, ownership cleanup, and ENOENT-only enumeration handling. No dependencies or CLI presentation changes are introduced.
- Re-ran the focused backup suite: 72 tests passed in 602 ms.
- Ran independent Node processes against one disposable backup root, pausing each after metadata writes. Same-timestamp writers received distinct ids; returned metadata matched persisted metadata; restoration preserved exact Unicode, NUL, and line-ending bytes.
- Listing excluded live staging. While another process remained paused, 22 completed backups exercised retention without deleting its staging; the paused process then published successfully. The disposable directory was removed afterward.
- The initial QA invocation lacked the TypeScript import loader and stopped before launching writers. Re-running with the repository's existing `tsx` loader passed; no dependency was added.

## Original parent QA checklist

1. Review the three scoped paths and run manual multiprocess QA in an isolated disposable backup root.
2. Overlap independent same-timestamp writers with distinct payloads and verify distinct suffixes, returned/persisted metadata equality, and exact restored bytes for both records.
3. Pause one different-timestamp writer after metadata completion, run listing and retention pruning from another process, then resume publication and verify both snapshots.
4. Include a failing symlink source and confirm only that writer's staging is removed; retain storage/metadata symlink safety controls.
5. Perform the individual commit and release only after review and QA.
