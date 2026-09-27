# `git-rust` (`@poe-code/git-rust`) — Full `isomorphic-git` Parity & `safe-bash` Git Engine Plan

## 1. Objective & Scope

Build a comprehensive, standalone Rust Git implementation in `packages/git-rust` (`@poe-code/git-rust`, crate `git-rust`) modeled on [`isomorphic-git`](https://github.com/isomorphic-git/isomorphic-git) with:

1. **Full `isomorphic-git` API, Model, Manager, Storage, Wire, and Error Parity**:
   - Every error class/code (`NotFoundError`, `InvalidRefNameError`, `InvalidOidError`, `CheckoutConflictError`, `MergeConflictError`, `FastForwardError`, `PushRejectedError`, `SmartHttpError`, `HttpError`, `UnmergedPathsError`, `IndexResetError`, `UnsafeFilepathError`, `InvalidFilepathError`, `MissingParameterError`, `MissingNameError`, `NoCommitError`, `CommitNotFetchedError`, `EmptyCommitError`, `CherryPickMergeCommitError`, `CherryPickRootCommitError`, `ObjectTypeError`, `AmbiguousError`, `AlreadyExistsError`, `MaxDepthError`, `ParseError`, etc.).
   - Every model (`FileSystem`, `GitObject`, `GitCommit`, `GitTree`, `GitAnnotatedTag`, `GitConfig`, `GitIndex`, `GitPackIndex`, `GitPackedRefs`, `GitPktLine`, `GitSideBand`, `GitRefSpec`, `GitRefSpecSet`, `GitRefStash`, `GitWalkerFs`, `GitWalkerIndex`, `GitWalkerRepo`, `RunningMinimum`).
   - Every manager (`GitConfigManager`, `GitIgnoreManager`, `GitIndexManager`, `GitRefManager`, `GitRemoteManager`, `GitRemoteHTTP`, `GitShallowManager`, `GitStashManager`).
   - Every storage primitive (`readObject`, `readObjectLoose`, `readObjectPacked`, `writeObject`, `writeObjectLoose`, `hasObject`, `hasObjectLoose`, `hasObjectPacked`, `expandOid`, `expandOidLoose`, `expandOidPacked`, `hashObject`, `readPackIndex`).
   - Every wire protocol parser & formatter (`parseRefsAdResponse`, `writeRefsAdResponse`, `parseCapabilitiesV2`, `parseListRefsResponse`, `writeListRefsRequest`, `parseUploadPackRequest`, `writeUploadPackRequest`, `parseUploadPackResponse`, `writeReceivePackRequest`, `parseReceivePackResponse`).
   - Every high-level command & API (`init`, `clone`, `fetch`, `pull`, `push`, `checkout`, `branch`, `deleteBranch`, `renameBranch`, `listBranches`, `currentBranch`, `add`, `remove`, `resetIndex`, `updateIndex`, `status`, `statusMatrix`, `commit`, `log`, `readBlob`, `readCommit`, `readTag`, `readTree`, `readObject`, `readNote`, `writeBlob`, `writeCommit`, `writeTag`, `writeTree`, `writeObject`, `writeRef`, `addNote`, `removeNote`, `listNotes`, `tag`, `annotatedTag`, `deleteTag`, `listTags`, `resolveRef`, `expandRef`, `expandOid`, `deleteRef`, `listRefs`, `listFiles`, `listRemotes`, `addRemote`, `deleteRemote`, `getRemoteInfo`, `getRemoteInfo2`, `listServerRefs`, `getConfig`, `getConfigAll`, `setConfig`, `merge`, `abortMerge`, `cherryPick`, `fastForward`, `findMergeBase`, `isDescendent`, `isIgnored`, `hashBlob`, `indexPack`, `packObjects`, `uploadPack`, `stash`, `walk`, `TREE`, `WORKDIR`, `STAGE`, `findRoot`, `discoverGitdir`, `version`).
2. **All 190 Unit Test Suites (1,285 Test Cases) Rewritten in Rust**:
   - Every single test file from `isomorphic-git/__tests__/` (all 102 base test files + all 88 `-in-submodule` test files) ported to Rust integration tests under `packages/git-rust/tests/`.
   - Pure in-memory fixture hydration (`MemoryFs` + deduplicated `__fixtures__` archive + in-memory Smart/Dumb HTTP mock server) so tests create zero disk files and execute deterministically.
3. **`safe-bash` / Node Integration Readiness**:
   - Virtual filesystem trait (`GitFs`) compatible with in-memory filesystems (`MemoryFs`) and N-API / `safe-bash` integration.
   - Built-in CLI command frontend (`git init`, `git status`, `git add`, `git rm`, `git commit`, `git log`, `git branch`, `git checkout`, `git switch`, `git tag`, `git diff`, `git merge`, `git cherry-pick`, `git stash`, `git remote`, `git config`, `git rev-parse`, `git cat-file`, `git hash-object`, `git ls-files`, `git show-ref`, `git symbolic-ref`, `git update-index`, `git reset`, `git clone`, `git fetch`, `git pull`, `git push`) for seamless `safe-bash` adoption.

## 2. Crate Architecture (`packages/git-rust`)

- `src/lib.rs`: Public exports matching `isomorphic-git` (`api`, `commands`, `models`, `managers`, `storage`, `wire`, `utils`, `errors`, `http`, `fs`, `cli`).
- `src/errors.rs`: Complete `GitError` enum & `ErrorCode` metadata matching `isomorphic-git/errors`.
- `src/fs.rs`: `GitFs` trait, `FileSystem` wrapper (matching `isomorphic-git` `FileSystem` model), `MemoryFs` (in-memory POSIX VFS with symlinks, modes, mtimes, inodes), and `StdFs`.
- `src/utils/`: SHA-1, zlib deflate/inflate, OFS_DELTA/REF_DELTA `apply_delta`, diff3 3-way merge (`merge_file`), `merge_tree`, path normalization (`join`, `dirname`, `basename`, `posixify_path_buffer`), author/committer parser & formatter, ref validation (`clean_git_ref`, `is_valid_ref`), `compare_path`, `compare_ref_names`, `compare_tree_entry_path`, `flat_file_list_to_directory_structure`, `extract_auth_from_url`, `format_info_refs`, `split_lines`, `is_binary`, `discover_gitdir`, `assert_no_symlink_in_leading_path`.
- `src/models/`:
  - `git_object.rs` (`GitObject::wrap`, `GitObject::unwrap`)
  - `git_commit.rs` (`GitCommit` parse, render, headers, payload, GPG signing/verification)
  - `git_tree.rs` (`GitTree` parse, render, sort, entry validation)
  - `git_annotated_tag.rs` (`GitAnnotatedTag` parse, render, GPG signature extraction/signing)
  - `git_config.rs` (`GitConfig` parser/serializer preserving comments, subsections, multi-values, case rules)
  - `git_index.rs` (`GitIndex` v2/v3 binary index parser/writer, conflict stages 0..=3, `TREE` cache extension, `UNTR` extension)
  - `git_pack_index.rs` (`GitPackIndex` v2 `.idx` parser/builder from `.pack`, CRC32, 64-bit offsets, OFS_DELTA & REF_DELTA resolution)
  - `git_packed_refs.rs` (`GitPackedRefs` parser/serializer with peeled `^` lines)
  - `git_pkt_line.rs` (`GitPktLine` encode, decode, flush `0000`, delim `0001`, response-end `0002`)
  - `git_side_band.rs` (`GitSideBand` mux/demux channels 1=packfile, 2=progress, 3=error)
  - `git_ref_spec.rs` & `git_ref_spec_set.rs` (`GitRefSpec`, `GitRefSpecSet` wildcard translation)
  - `git_ref_stash.rs` (`GitRefStash` reflog entry creation/parsing)
  - `git_walker.rs` (`TREE`, `WORKDIR`, `STAGE` walkers + `walk` engine)
- `src/storage/`: Loose and packed object reading, writing, OID prefix expansion, pack index caching.
- `src/managers/`:
  - `git_config_manager.rs`
  - `git_ignore_manager.rs` (`.gitignore` hierarchical rule evaluation with negation & directory rules)
  - `git_index_manager.rs`
  - `git_ref_manager.rs` (loose refs, `packed-refs`, symrefs, cycle detection, reflogs, `updateRemoteRefs`)
  - `git_remote_manager.rs` & `git_remote_http.rs`
  - `git_shallow_manager.rs`
  - `git_stash_manager.rs`
- `src/wire/`: Smart HTTP v1 & v2 capability parsing, `list-refs`, `upload-pack`, `receive-pack` request/response framing.
- `src/api/`: All 69 top-level `isomorphic-git` API functions.
- `src/http/`: `GitHttp` trait + `MockHttpServer` (serving `__fixtures__` over Smart HTTP v1/v2, Dumb HTTP, redirects, auth, CORS proxy, and hosting provider simulations).
- `src/cli.rs`: Full `git` CLI command dispatcher for `safe-bash`.

## 3. Complete 190-Test-Suite Parity Checklist

1. `test_git_annotated_tag` + `test_git_annotated_tag_in_submodule`
2. `test_git_config` + `test_git_config_in_submodule`
3. `test_git_error` + `test_git_error_in_submodule`
4. `test_git_index` + `test_git_index_in_submodule`
5. `test_git_pack_index` + `test_git_pack_index_in_submodule`
6. `test_git_pkt_line` + `test_git_pkt_line_in_submodule`
7. `test_git_ref_manager` + `test_git_ref_manager_in_submodule` + `test_git_ref_manager_symref_cycle`
8. `test_git_ref_spec_set` + `test_git_ref_spec_set_in_submodule`
9. `test_git_remote_manager` + `test_git_remote_manager_in_submodule`
10. `test_git_side_band` + `test_git_side_band_in_submodule`
11. `test_git_tree_entry_name_validation`
12. `test_abort_merge` + `test_abort_merge_in_submodule`
13. `test_add` + `test_add_in_submodule`
14. `test_add_note` + `test_add_note_in_submodule`
15. `test_add_remote` + `test_add_remote_in_submodule`
16. `test_annotated_tag` + `test_annotated_tag_in_submodule`
17. `test_apply_delta_bounded_allocation`
18. `test_branch` + `test_branch_in_submodule`
19. `test_checkout` + `test_checkout_in_submodule` + `server_only_test_checkout_symlink_leading_path`
20. `test_cherry_pick` + `test_cherry_pick_in_submodule` + `server_only_test_cherry_pick_symlink_leading_path`
21. `test_clone` + `test_clone_in_submodule` + `test_clone_checkout_huge_repo` + `test_clone_checkout_huge_repo_in_submodule`
22. `test_commit` + `test_commit_in_submodule`
23. `test_config` + `test_config_in_submodule`
24. `test_current_branch` + `test_current_branch_in_submodule`
25. `test_delete_branch` + `test_delete_branch_in_submodule`
26. `test_delete_ref` + `test_delete_ref_in_submodule`
27. `test_delete_remote` + `test_delete_remote_in_submodule`
28. `test_delete_tag` + `test_delete_tag_in_submodule`
29. `test_discover_gitdir_worktree` + `test_worktree`
30. `test_expand_oid` + `test_expand_oid_in_submodule`
31. `test_exports` + `test_exports_in_submodule`
32. `test_fetch` + `test_fetch_in_submodule`
33. `test_find_merge_base` + `test_find_merge_base_in_submodule`
34. `test_find_root` + `test_find_root_in_submodule`
35. `test_flat_file_list_to_directory_structure` + `test_flat_file_list_to_directory_structure_in_submodule`
36. `test_get_remote_info` + `test_get_remote_info_in_submodule` + `test_get_remote_info2` + `test_get_remote_info2_in_submodule`
37. `test_hash_blob` + `test_hash_blob_in_submodule`
38. `test_hosting_providers` + `test_hosting_providers_in_submodule` + `server_only_test_http_client`
39. `test_init` + `test_init_in_submodule`
40. `test_is_binary` + `test_is_binary_in_submodule`
41. `test_is_ignored` + `test_is_ignored_in_submodule`
42. `test_list_branches` + `test_list_branches_in_submodule`
43. `test_list_commits_and_tags` + `test_list_commits_and_tags_in_submodule`
44. `test_list_files` + `test_list_files_in_submodule`
45. `test_list_notes` + `test_list_notes_in_submodule`
46. `test_list_objects` + `test_list_objects_in_submodule`
47. `test_list_refs` + `test_list_refs_in_submodule`
48. `test_list_remotes` + `test_list_remotes_in_submodule`
49. `test_list_server_refs` + `test_list_server_refs_in_submodule`
50. `test_list_tags` + `test_list_tags_in_submodule`
51. `test_log` + `test_log_in_submodule` + `test_log_file` + `test_log_file_in_submodule`
52. `test_merge` + `test_merge_in_submodule` + `test_merge_file` + `test_merge_file_in_submodule`
53. `test_normalize_author_object` + `test_normalize_author_object_in_submodule`
54. `test_normalize_committer_object` + `test_normalize_committer_object_in_submodule`
55. `test_pack_objects` + `test_pack_objects_in_submodule` + `test_packfile_integrity`
56. `test_pull` + `test_pull_in_submodule`
57. `test_push` + `test_push_in_submodule`
58. `test_read_blob` + `test_read_blob_in_submodule`
59. `test_read_commit` + `test_read_commit_in_submodule`
60. `test_read_note` + `test_read_note_in_submodule`
61. `test_read_object` + `test_read_object_in_submodule`
62. `test_read_tag` + `test_read_tag_in_submodule`
63. `test_read_tree` + `test_read_tree_in_submodule`
64. `test_remove` + `test_remove_in_submodule`
65. `test_remove_note` + `test_remove_note_in_submodule`
66. `test_rename_branch` + `test_rename_branch_in_submodule`
67. `test_reset_index` + `test_reset_index_in_submodule`
68. `test_resolve_ref` + `test_resolve_ref_in_submodule`
69. `test_stash` + `test_stash_in_submodule`
70. `test_status` + `test_status_in_submodule`
71. `test_status_matrix` + `test_status_matrix_in_submodule` + `server_only_test_status_matrix_symlink`
72. `test_submodules` + `test_submodules_in_submodule`
73. `test_tag` + `test_tag_in_submodule`
74. `test_unicode_paths` + `test_unicode_paths_in_submodule`
75. `test_update_index` + `test_update_index_in_submodule`
76. `test_upload_pack` + `test_upload_pack_in_submodule`
77. `test_utils_extract_auth_from_url` + `test_utils_format_info_refs` + `test_utils_join` + `test_utils_join_in_submodule` + `test_utils_mkdirp` + `test_utils_split_lines`
78. `test_validate` + `test_validate_in_submodule`
79. `test_version` + `test_version_in_submodule`
80. `test_walk` + `test_walk_in_submodule`
81. `test_wire` + `test_wire_in_submodule`
82. `test_write_blob` + `test_write_blob_in_submodule`
83. `test_write_commit` + `test_write_commit_in_submodule`
84. `test_write_object` + `test_write_object_in_submodule`
85. `test_write_ref` + `test_write_ref_in_submodule`
86. `test_write_tag` + `test_write_tag_in_submodule`
87. `test_write_tree` + `test_write_tree_in_submodule`

## Completion Status

- [x] All 6 milestones implemented, verified in-memory via `MemoryFs`, and passing `cargo test --manifest-path packages/git-rust/Cargo.toml`.
