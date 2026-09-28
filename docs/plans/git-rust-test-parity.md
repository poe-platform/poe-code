# `git-rust` Git 100% Test Parity Plan

## Objective
Port all 190 upstream `git` test files (standard and `-in-submodule` variants) into Rust integration tests in `packages/git-rust/tests/` and fix all implementation gaps uncovered in `packages/git-rust`.

## Completed Implementation Fixes
1. `packages/git-rust/src/models/git_index.rs`:
   - `GitIndex::from_buffer` validates empty buffers, `DIRC` magic header, and 20-byte SHA-1 trailer checksum, and tracks `dirty` state.
   - `GitIndex::delete` removes both exact filepath matches and directory prefix matches (`filepath/`), matching `GitIndex#delete` in upstream `git`.
2. `packages/git-rust/src/managers/mod.rs`:
   - `GitIndexManager::acquire` only writes `.git/index` back when `index.is_dirty()` is `true`.
3. `packages/git-rust/src/commands/plumbing.rs`:
   - `read_blob` peels annotated tag objects (`"tag"` -> target object) when `filepath` is `None`.
4. `packages/git-rust/src/commands/walk.rs` & `packages/git-rust/src/commands/mod.rs`:
   - Implemented and exported `walk`, `WORKDIR()`, `TREE()`, `STAGE()`, `Walker`, and `WalkerEntry` (with `.git` and `.gitignore` filtering, `core.autocrlf` CRLF normalization, symlinks, unborn branches, and stage entries).
5. `packages/git-rust/src/commands/worktree.rs`:
   - `status_matrix` normalizes trailing `/` on `filepaths` filter entries (`"c/"` -> `"c"`).
6. `packages/git-rust/src/utils/mod.rs`, `src/models/git_tree.rs`, `src/wire/mod.rs`, `src/storage/mod.rs`:
   - Author/committer normalization, empty tree entry validation, `deepen-relative` wire line, and packfile integrity checks.

## Completed Parity Test Suites (190 Upstream Files Covered)
- [x] **Batch 1 (`packages/git-rust/tests/git_batch1.rs`)**: 274 tests passing (Utils, Errors, Wire, Models, Config, Index, PackIndex, Tree validation, Delta bounds — 32 upstream files).
- [x] **Batch 2 (`packages/git-rust/tests/git_batch2.rs`)**: 157 tests passing (Managers, Storage, Refs, Init, Branches, Tags, Remotes, Notes, Packfile integrity — 43 upstream files).
- [x] **Batch 3 (`packages/git-rust/tests/git_batch3.rs`)**: 73 tests passing (Plumbing Read/Write Blob, Tree, Commit, Tag, Object, Log, MergeBase, Walk — 40 upstream files).
- [x] **Batch 4 (`packages/git-rust/tests/git_batch4.rs`)**: 30 tests passing (Add, Remove, ListFiles, Status, StatusMatrix, ResetIndex, UpdateIndex, Commit, Unicode paths, Submodules — 26 upstream files).
- [x] **Batch 5 (`packages/git-rust/tests/git_batch5.rs`)**: 18 tests passing (Checkout, Clone-checkout-huge-repo, Merge, AbortMerge, CherryPick, Stash — 24 upstream files).
- [x] **Batch 6 (`packages/git-rust/tests/git_batch6.rs`)**: 18 tests passing (GetRemoteInfo, GetRemoteInfo2, ListServerRefs, UploadPack, Fetch, Clone, Pull, Push, Hosting Providers — 25 upstream files).
