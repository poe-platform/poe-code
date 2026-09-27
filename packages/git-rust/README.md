# `@poe-code/git-rust` (`git-rust`)

Pure Rust Git engine with full [`isomorphic-git`](https://github.com/isomorphic-git/isomorphic-git) API parity and virtual filesystem (`GitFs` / `MemoryFs`) support for `safe-bash`.

## Features

- **Complete Object & Pack Engine**: Loose objects (`blob`, `tree`, `commit`, `tag`), Packfiles v2 (`.pack`, `.idx`), `OFS_DELTA` and `REF_DELTA` decoding and delta compression.
- **Working Tree, Staging & Index**: Binary `.git/index` v2/v3 with conflict stages (`0..=3`), `TREE` cache extension, `.gitignore` rules, `status`, `statusMatrix`, `add`, `remove`, `resetIndex`, `updateIndex`, `checkout`.
- **Branching, History & Merging**: `init`, `commit`, `log`, `branch`, `deleteBranch`, `renameBranch`, `listBranches`, `currentBranch`, `tag`, `annotatedTag`, `deleteTag`, `listTags`, `findMergeBase`, `isDescendent`, 3-way `merge` (with diff3 file merge), `abortMerge`, `cherryPick`, `fastForward`, `stash`, `notes`, `walk`.
- **Smart HTTP v1/v2 & Wire Protocol**: `GitPktLine`, `GitSideBand`, `clone`, `fetch`, `pull`, `push`, `getRemoteInfo`, `getRemoteInfo2`, `listServerRefs`, `uploadPack`, `packObjects`, `indexPack`, plus an in-memory Smart/Dumb HTTP server for deterministic testing.
- **`safe-bash` CLI Frontend**: Built-in `git` command dispatcher operating directly against any `GitFs` virtual filesystem.
