# Tree author validation history

This is author evidence, not independent acceptance or a full repository gate.
Hidden filesystem-inspection tree holdouts were not read or run by this author.

The first scoped run had 37 tests: 35 passed, one failed, one optional native
replay skipped. The failure was an author test incorrectly reading nonexistent
`Shell.cwd`/`Shell.env` properties; it now observes state through actual shell
commands. The first strict typecheck reported those two test errors plus two
uses of `String.isWellFormed`, unavailable in the project's ES2023 type library.
The implementation now checks isolated UTF-16 surrogates with a Unicode regex,
without changing the project library target. These initial failures are retained
here rather than counted as initial passes. All 24 original native-exact rows
and four JSON-semantic rows passed in that first run; their inputs and captures
remain unchanged in `native-fixtures.json`.

## Final author validation

- `node_modules/.bin/tsc --noEmit -p tests/commands/tree/tsconfig.json`: pass.
  This checks owned source/tests and their imported types, not the full gate.
- `TREE_NATIVE_BIN=/tmp/safe-bash-tree-oracle-MlUjmM/unix-tree-2.2.1/tree node
  --import tsx --test tests/commands/tree/*.test.ts`: 58 tests, 58 passed,
  zero failures/skips/cancellations/TODOs. This includes 24 native exact cases,
  four parsed-JSON semantic cases and a live replay of all 34 original rows.
  Six divergent baseline rows are retained, not advertised as parity passes.
- The same 58-test cohort passed again with `NODE_V8_COVERAGE` enabled.
  `source-manifest.json` records 51 actually covered/loaded source file URLs
  (six owned tree modules), plus owned loaded test sources. Every recorded file
  has matching before/after SHA256 hashes. This is a stable invocation snapshot
  in a concurrently dirty working tree, not a clean/frozen whole-repository gate.
- The frozen native fixture JSON SHA256 is
  `a7c312188244ff48760b4a6b247983d2ffa66bcffd6072d67e63acd1f074a3ab`.
- Isolated ESM/declaration build passed using
  `node_modules/.bin/tsc -p tests/commands/tree/tsconfig.build.json --outDir
  /tmp/safe-bash-tree-author-build-rGXUaI`. No live `dist` writes occurred.
  A strict NodeNext `.mts` consumer using all three standalone factories and
  both option types compiled against emitted declarations, then ran under plain
  Node against emitted ESM through actual Shell/MemoryFS. This is **not** root
  package/subpath consumer evidence; those exports are intentionally absent.
- Memory, rooted real, readonly, mount, overlay and paginated mock-S3 adapters
  passed four common profiles each, with additional real symlink and mounted
  alias checks. No live S3/WebDAV provider was tested.

The native binary is tree 2.2.1, compiled unmodified from the official archive
under Darwin arm64 with Apple clang 21.0.0 and
`make CC=cc CFLAGS='-O2 -std=c11 -Wall -Wextra' LDFLAGS= tree`.
The upstream compilation emitted one unused-variable warning (`stddata_fd`),
not an error. The archive and binary SHA256 hashes are in `native-fixtures.json`;
the pinned `doc/tree.1` SHA256 is
`0900385101aa663c970b3e558ed3eec8b4fc96e175b70bedefcf32cf4f8bc3dd`.
No native executable was on PATH; no install target or main dependency was added.

The build/replay/profile are author work only. Independent hidden holdout review
and any root/default/public integration remain the coordinator's next step.
This candidate does not establish broad just-bash superiority, universal native
tree parity, deployed-provider support, a full test gate or 72 hours of work.
