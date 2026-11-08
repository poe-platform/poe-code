# Owned archive cleanup

Root-authorized cleanup only, after independent candidate acceptance `303d18449c6e01bae4f33dada2f2022f95a56d49`. No test, native, typecheck, or global-gate rerun. No acceptance claims are revised.

## Exact removals

| Relative directory | Regular files | Symlinks |
| --- | ---: | ---: |
| `tests/shell-stress/canonical-profile-migration/.candidate-A-MCzKZA` | 215 | 1 |
| `tests/shell-stress/canonical-profile-migration/.candidate-A-Utom8y` | 215 | 1 |
| `tests/shell-stress/canonical-profile-migration/.candidate-B-hwqqUo` | 218 | 1 |
| `tests/shell-stress/canonical-profile-migration/.candidate-C-jWPzgO` | 218 | 1 |
| `tests/shell-stress/canonical-profile-migration/.candidate-FINAL-T42B3X` | 218 | 1 |
| `tests/shell-stress/canonical-profile-migration/.source-6e-9PS0KC` | 201 | 1 |
| `tests/shell-stress/errexit-legacy-policy/.correction-archive-bLk5Ko` | 190 | 1 |

All seven were untracked. The 1,475 regular files were generated archive copies; the seven links were archive-root `node_modules` links to the repository tooling. Every file hash, directory inode/device/mode, symlink identity/target, count, committed proof association, and pre-removal manifest digest is retained in `cleanup-preflight.json`. Complete manifests matched before any removal. Six matched committed after-manifests directly; phase B matched the committed C manifest with exactly the original holdout hash restored from committed preparation evidence. The B recorder failure remains a failure to retain execution evidence, not a reconstructed passing run.

Deletion used exact-root, bottom-up lstat verification and unlink/rmdir, never symlink traversal. No tracked file or link target was deleted. Open-file/cwd checks found no archive users. Two command-line matches were this cleanup session and launcher carrying the authorized paths in the task prompt, not test children. No process was signaled.

## Preservation and qualification

`cleanup-receipt.json` records per-root removal timestamps, all seven absent afterward, root tooling identity unchanged, and no remaining dot entries in either owned proof directory. Source and all previously tracked files in both owned proof directories, plus the four canonical tests, have identical before/after hashes (240 guarded files). Historical native/proof artifacts are unchanged.

Frozen shell source remains commit `6e3e3165e3b88aa5518eac33afd0b2ecdfa5fd2a` content: runtime SHA256 `5589f60a1db983538d37168e3b9276555ef71a2bc67446783535e47789f9d6eb`; parser SHA256 `10d015eb62fd4e4f964666c04e5869ea78afdb76d930181760adecbcf16ab65e`. Four test hashes are explicit in the receipt/preflight file maps.

The global index/unstaged-diff endpoint guards are **false**, retained without relabeling: HEAD advanced from `04879692a66d88eee129b8ffd6e7ca93c7a9476a` to `bf8b5540fd2d222a273922b12d347f3aa5d07d3b` during cleanup via a foreign regex-review commit. The cached diff remained unchanged/empty. No global frozen-index or clean-worktree claim is made. Only these three NEW cleanup documents are committed with explicit `git commit --only` paths; foreign staging is not incorporated. Existing foreign changes/artifacts remain outside this cleanup. Endpoint/process checks are observations, not an atomic filesystem snapshot.

After deletion, while preparing the commit, foreign `src/index.ts` changed from `59feca270ddb39073148032b6d53225b932979faaeb5f244158eff44bd347ff2` to `c9d4d5693dd65dfcb90ff14c43631d00d9d2975a5f58ab03df7ff0e1d34a3e6e`. This is retained in the receipt; the frozen runtime/parser and four canonical tests still match. The earlier full source guard describes only the deletion endpoints, not the later concurrent publication interval.

Raw receipts retain all pre-removal identities and deletion results. No source, test, helper, manifest, core, contract, or runtime dependency was edited by this cleanup.
