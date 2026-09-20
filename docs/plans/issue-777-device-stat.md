# Issue #777: complete virtual-device stat metadata

## Scope

Supply stable virtual ownership for `/dev/null` and `/dev` in the shared
`DeviceFileSystem` stat record. Preserve the existing frozen records, timestamps,
inode numbers, and device identity scope, which is separate from backing storage.
Path `stat`/`lstat` and retained descriptor `stat` must observe the same metadata.
Do not relax Python's required-metadata validation or change backing metadata.

## Execution plan

1. Read worktree/root and Safe Bash instructions; validate the current constructor.
2. Reproduce missing ownership with focused in-memory device regression tests.
3. Add actual Python assertions to the maintained workerd/Pyodide JSPI fixture
   and reproduce native `os.stat('/dev/null')` failure before changing production.
4. Add `uid: 0, gid: 0` to the shared virtual stat record without changing identity.
5. Run focused maintained unit tests, package typecheck, and actual native Python
   acceptance; record lint limitations and hand off an unstaged owned patch.

## Verified results (September 18, 2026)

- Baseline: detached `98db897d2` in the assigned home-owned sparse worktree.
- RED: all five new device metadata tests failed because ownership was absent.
- Native RED: pinned Pyodide in actual workerd reproduced `OSError: [Errno 61]
  canonical identity or required stat metadata unavailable: '/dev/null'`.
  The fixture subsequently returned HTTP 500 because its expected output file
  was never written; captured Python stderr establishes the original stat error.
- GREEN: 157 tests in 10 focused files passed using maintained `vitest.config.ts`.
  Coverage includes absent/historical entries, aliases, symlink `lstat`, stable
  snapshots, all descriptor access modes, and separate translated identities.
- `npm run typecheck --workspace=@poe-code/safe-fs` passed.
- Native GREEN: the maintained `python-jspi.test.mjs` passed, including real
  `os.stat`, `os.lstat`, `os.fstat(os.open(...))` with read/write/read-write flags,
  `/dev` directory metadata, zero ownership/timestamps, repeated identity, and
  identity separation from `/work/input.bin`. Existing native I/O, finalization,
  cancellation, and shell-pool assertions also passed. Native acceptance is
  separate from the mock-based syscall unit tests.
- Host workerd cannot start with the host's older glibc. Native RED and GREEN
  used the existing `node:22-bookworm-slim` image and home-owned Miniflare
  `5.20260917.0-alpha` / workerd `1.20260917.1` toolchain; no downloads or installs.
- Maintained `npm run lint:eslint -- --no-cache` exited 2 during receipt
  registration: `exact pathname spelling required` for the unmaterialized
  `packages/safe-bash/integration-lint-audit/boundary-leaf-receipts.json`.
  No subjects were linted. The guarded root route supports no file selector;
  this is not a lint pass. Integration must run maintained lint from the parent
  checkout rather than materializing the full Safe Bash test/evidence tree.
- `git diff --check` passed. No CLI presentation changed; screenshots do not
  exercise this filesystem-only metadata change. No commits, staging, or pushes.

## Reproduction commands

Parent integration at `492a3b641` reran all 157 focused tests and the maintained
Safe FS package typecheck successfully. Maintained root ESLint policy applied to
the three changed implementation/test files reports zero errors and warnings;
this scoped policy check is not the repository-wide guarded lint route.
`git diff --check` passed. Remote delivery and publication remain to be verified.

From the assigned worktree, create `out/tmp` and keep `TMPDIR` there:

```bash
TMPDIR="$PWD/out/tmp" node_modules/.bin/vitest run --config vitest.config.ts \
  packages/safe-fs/tests/devices*.test.ts \
  packages/safe-fs/tests/python-stat.test.ts \
  packages/safe-fs/tests/python-native.test.ts \
  packages/safe-fs/tests/character-metadata-forwarding.test.ts
TMPDIR="$PWD/out/tmp" npm run typecheck --workspace=@poe-code/safe-fs
TMPDIR="$PWD/out/tmp" npm run lint:eslint -- --no-cache
docker run --rm --user "$(id -u):$(id -g)" \
  -v /home/kjopek:/home/kjopek -w "$PWD" -e TMPDIR="$PWD/out/tmp" \
  -e SAFE_BASH_CF_RUNTIME_ROOT=/home/kjopek/project/poe-issue-worktrees-20260918/issue-763/out/issue763-workerd \
  node:22-bookworm-slim node --import tsx --test \
  packages/safe-bash/tests/integration/python-jspi.test.mjs
```

Only needed source/test/configuration dependencies were materialized. Ignored
dependency directories contain links to existing producer dependencies and
pinned Pyodide assets. No full Safe Bash test checkout or `/tmp` scratch was used.
Temporary evidence and the patch are under worktree `out/`; parent integration
owns their retention/purge after handoff.
