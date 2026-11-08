# Plan: `git-rust` Integration Test Parity (All 190 Test Suites — 1,280 `#[test]` Functions)

## Goal
Verify and harden `packages/git-rust` by porting all 190 Git test suites (both standard and `-in-submodule` variants, 1,275+ test cases) into Rust integration tests in `packages/git-rust/tests/` (`git_batch1.rs` through `git_batch6.rs`), and fixing every implementation gap uncovered.

## Architecture & Fixture Infrastructure
- **Bundled Fixture Archive**: `packages/git-rust/fixtures/git-fixtures.bin.zlib` embedded into `git_rust::fixtures`:
  - `make_fixture(name)` loads the fixture working tree and gitdir into `MemoryFs`.
  - `make_fixture_as_submodule(name)` sets up a parent repository with `.git/modules/mysubmodule` and a submodule worktree at `mysubmodule` with `.git` pointing to `../.git/modules/mysubmodule`, matching every `-in-submodule` test suite.
- **`dual_fixture_test!` Macro**: Every test case runs twice (`<name>` and `<name>_sub`), exercising both standard repository layout and submodule worktree/gitdir indirection.

## Test Batches & Results (1,280 Total Passing `#[test]` Functions)
1. **Batch 1 (`packages/git-rust/tests/git_batch1.rs` — 274 tests passing)**:
   - Models (`GitAnnotatedTag`, `GitConfig`, `GitIgnore`, `GitIndex`, `GitObject`, `GitPackIndex`, `GitPktLine`, `GitRefSpecSet`, `GitSideBand`, `GitTree`), wire parsers/writers (`parseRefsAdResponse`, `writeRefsAdResponse`, `parseUploadPackRequest`, `writeUploadPackRequest`, `parseUploadPackResponse`), and utility helpers (`applyDelta`, `extractAuthFromUrl`, `flatFileListToDirectoryStructure`, `formatInfoRefs`, `isBinary`, `join`, `mergeFile`, `mkdirp`, `normalizeAuthorObject`, `normalizeCommitterObject`, `splitLines`, `version`, `exports`, index validation).
2. **Batch 2 (`packages/git-rust/tests/git_batch2.rs` — 219 tests passing)**:
   - Object storage & managers (`discoverGitdir`, `expandOid`, `readObject`, `writeObject`, `packfileIntegrity`, `GitRefManager`, `GitRefManager-symref-cycle`, `GitRemoteManager`, `init`, `findRoot`, `config`, `resolveRef`, `writeRef`, `deleteRef`, `listRefs`, `isIgnored`, `hashBlob`, `readBlob`, `writeBlob`, `readTree`, `writeTree`, `readCommit`, `writeCommit`, `readTag`, `writeTag`, `packObjects`).
   - Fixed `is_ignored` for nested `.git/...` paths and `info/exclude` evaluation when `.gitignore` is absent (`packages/git-rust/src/managers/mod.rs`).
3. **Batch 3 (`packages/git-rust/tests/git_batch3.rs` — 263 tests passing)**:
   - Refs, branches, tags, remotes, notes, and history traversal (`branch`, `renameBranch`, `deleteBranch`, `listBranches`, `currentBranch`, `tag`, `annotatedTag`, `deleteTag`, `listTags`, `addRemote`, `deleteRemote`, `listRemotes`, `addNote`, `readNote`, `removeNote`, `listNotes`, `log`, `isDescendent`, `findMergeBase`, `indexPack`, `uploadPack`).
   - Fixed root-commit rename continuation in `log(..., follow=true)` (`packages/git-rust/src/commands/plumbing.rs`).
4. **Batch 4 (`packages/git-rust/tests/git_batch4.rs` — 180 tests passing)**:
   - Worktree & staging operations (`listFiles`, `status`, `statusMatrix`, `add`, `remove`, `resetIndex`, `updateIndex`, `commit`, `submodules`, `unicode-paths`, `symlink-protection`, `autocrlf`, `ValidRefError`) and CLI worktree subcommands (`status`, `add`, `rm`, `mv`, `restore`, `clean`, `reset`, `diff`, `show`, `branch`, `tag`, `remote`, `config`, `rev-parse`, `ls-files`, `switch`, `log`, `commit`).
   - Fixed `checkout` submodule gitlink (`160000` / `commit`) handling in `packages/git-rust/src/commands/worktree.rs`.
5. **Batch 5 (`packages/git-rust/tests/git_batch5.rs` — 132 tests passing)**:
   - `checkout`, `merge`, `abortMerge`, `cherryPick`, and `stash` plus CLI `merge`, `cherry-pick`, `stash`, and `--git-dir`/`--work-tree` global flags.
   - Fixed `write_stash_reflog_entry` ordering (`stash@{0}` newest first) and `stash drop` reflog preservation (`packages/git-rust/src/managers/mod.rs`, `packages/git-rust/src/commands/worktree.rs`, `packages/git-rust/src/cli.rs`).
6. **Batch 6 (`packages/git-rust/tests/git_batch6.rs` — 120 tests passing)**:
   - `getRemoteInfo`, `getRemoteInfo2`, `listServerRefs`, `uploadPack`, `fetch`, `clone`, `pull`, `push`, `hosting-providers`, and plumbing CLI commands (`ls-tree`, `show-ref`, `symbolic-ref`, `update-ref`, `rev-list`, `merge-base`, `check-ignore`, `cat-file`, `hash-object`).
7. **Additional Integration Suites (`packages/git-rust/tests/test_*.rs` — 92 tests passing)**:
   - CLI end-to-end, portable execution, parser safety, security fixes, and issue regression suites.
