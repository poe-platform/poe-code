# Fix agent-stash tar dependency security

## Scope

One dependency-configuration bugfix, limited to:

- `packages/agent-stash/package.json`
- `package-lock.json`
- `docs/plans/bugfix-stash-tar-security-update.md`

Use the configuration-only TDD exception: no production code changes or new
tests. Do not update shell-quote, add a resource-budget API, modify README files,
or commit/push. The parent owns real-codec manual QA, screenshots, and git/release
workflow. Leave the concurrent worktree worker's changes untouched.

## Review

- Initial manifest minimum: `^7.5.16`; installed and locked tar: `7.5.16`.
- Target manifest minimum: `^7.5.22`; target locked/installed tar: `7.5.22`.
- GHSA-23hp-3jrh-7fpw is patched in `7.5.19`. The application's default
  `TarArchiveCodec.read` calls `tar.extract` and inherits parser limits.
- GHSA-r292-9mhp-454m is patched in `7.5.21`. Its member-selection path is not
  reached here: extraction passes an options object with a custom filter, but
  no member-selection array. The dependency upgrade includes that fix anyway.
- Reviewed upstream tag `v7.5.22`, `src/parse.ts`: line 64 defines
  `MAX_DECOMPRESSION_RATIO = 1000`; lines 129-133 apply it when the caller does
  not supply a numeric override; lines 428-441 abort when the cumulative
  decompressed/compressed byte ratio exceeds that limit.
- This can reject legitimate exceptionally compressible archives above the
  limit. It is not an absolute archive-size, total-output, entry-count, disk,
  or CPU budget; large low-ratio and uncompressed input still need separate
  resource policy if required. No such policy is introduced in this bugfix.
- Registry metadata for `tar@7.5.22` retains Node `>=18`, compatible with this
  package's existing Node `>=18.18` floor. Direct dependency ranges match
  `7.5.16`, so no transitive version upgrades are necessary.

## Implementation

- [x] Review source and manifests before modifying dependencies.
- [x] Confirm read-only `ps` shows no parent Vitest process; parent also confirms
  its prepush suite has finished.
- [x] Apply the manifest minimum change with `apply_patch`.
- [x] Run the targeted dry-run, then
  `npm install tar@7.5.22 --workspace=agent-stash --save-prefix='^' --ignore-scripts --package-lock-only --no-audit --no-fund`.
- [x] Resolve unexpected unrelated lock reconciliation with the parent before
  any additional dependency writes; parent authorizes restoring precisely the
  two metadata lines removed by this task's npm invocation.
- [x] Install the accepted lock resolution with scripts disabled and verify
  the active application-relative tar implementation.
- [x] Run existing package tests and package typecheck against installed 7.5.22.
- [x] Parent executes the real-codec roundtrip and bounded in-memory ratio QA
  below and reports both passed.

Screenshots and git/release workflow remain parent-owned; their completion is
not asserted here. No further shared dependency changes while parent push hooks
run.

The initial targeted lock-only install relocated tar and removed `auth-store`
from the `packages/toolcraft-openapi` lock entry's `bundleDependencies` and
`dependencies`. Dependency writes stopped before touching `node_modules`, and
the parent authorized restoring exactly those two npm-generated removals.

After another read-only process check found no active parent Vitest process,
`npm install tar@7.5.22 --workspace=agent-stash --save-prefix='^' --ignore-scripts --no-audit --no-fund`
changed exactly one installed package. npm retained tar at `node_modules/tar`
without any forced hoisting. The two unrelated metadata lines were restored
with `apply_patch`; all other concurrent edits were preserved.

Final lock comparison against the pre-task snapshot changes only
`node_modules/tar` (version, resolved URL, integrity) and
`packages/agent-stash` (tar dependency range). There are no required or actual
transitive changes: `@isaacs/fs-minipass` stays `4.0.1`, `chownr` `3.0.0`,
`minipass` `7.1.3`, `minizlib` `3.1.0`, and `yallist` `5.0.0`.

## Validation

- `npm run test --workspace=agent-stash`: **469 tests passed across 12 files**,
  wall time 28.66 seconds, including all 20 archive-operation tests. Those tests
  inject an in-memory codec; the parent separately reports the real-codec manual
  QA below passed.
- `node_modules/.bin/tsc -p packages/agent-stash/tsconfig.json --noEmit`: passed
  with no diagnostics.
- Application-relative `createRequire` resolves installed `tar@7.5.22` to
  `node_modules/tar/dist/commonjs/index.min.js`. ESM resolution from the package
  directory resolves `node_modules/tar/dist/esm/index.min.js`.
- Runtime assertions using the installed ESM package pass: a real `Parser`
  and `tar.extract({ strict: true, filter: ... })` stream both expose
  `maxDecompressionRatio === 1000`; extraction retains `strict === true`.
  No archive input or filesystem extraction is needed for these assertions.
- Inspected installed ESM and CommonJS `parse.js`: both define the default,
  abort when the cumulative ratio exceeds it, and invoke the guard on
  decompressor output. The upgraded implementation is active, not merely locked.
- Scoped `git diff --check` passes. Only the three authorized files were edited
  by this task. No code changes, tests added, README edits, commits, or pushes.

Audit baseline on August 26, 2026: **11 vulnerable packages** (1 critical,
8 high, 1 moderate, 1 low). Tar carries five advisory records, including the two
named above plus GHSA-w8wr-v893-vjvp, GHSA-8x88-c5mf-7j5w, and
GHSA-gvwx-54wh-qm9j. Both the initial lock-only audit and final `npm audit --json`
after installation and the precise metadata restoration report
**10 vulnerable packages** (0 critical, 8 high, 1 moderate, 1 low), with tar
absent and no new vulnerable packages. Tar is the only removed audit package
entry; its five advisory records are gone. shell-quote remains `1.8.4` and high
severity. Audit still exits 1 for the ten unrelated findings; this is not a
claim that the entire dependency tree is vulnerability-free.

## Manual QA for the parent

These are agent-executed steps, not a permanent QA script. Do not use real user
archives, Gists, home directories, or repositories, and do not run upstream
destructive exploit examples.

### Small real-codec roundtrip

1. Create a dedicated `fs.mkdtemp` directory beneath `os.tmpdir()` and retain
   its exact returned path as the only outer cleanup target.
2. Inside that owned directory create separate source and destination project
   roots and a fake home. Seed only the source with a small synthetic
   `.claude/skills/tar-roundtrip/SKILL.md` containing valid frontmatter and
   known UTF-8 text including `café`; keep the complete fixture comfortably
   below a few KiB.
3. Call the real `exportArchive` with a context using real filesystem promises,
   the temporary source cwd/fake home, `scope: "project"`,
   `agent: "claude-code"`, and an output archive inside the owned directory.
   Omit `archiveCodec` so the private `TarArchiveCodec.write` is used; do not
   inject the existing tests' `InMemoryArchiveCodec`.
4. Call the real `importArchive` with the isolated destination context,
   the same fake home and archive, `scope: "project"`,
   `agent: "claude-code"`, and `yes: true`. Again omit `archiveCodec` so this
   exercises `TarArchiveCodec.read` and installed tar extraction.
5. Inspect the export/import item counts and manifest, and read the imported
   `SKILL.md` to assert exact content equality with the seeded file. Confirm
   all application state/backup paths are inside the owned temporary tree.
6. In `finally`, remove only the exact outer directory returned by this run's
   `mkdtemp`. The codec cleans its own internal temporary directories. Never
   glob-clean shared temp paths or remove another process's directories.

Parent-reported result on August 26, 2026: **passed**. Public export/import ran
without a codec mock against one synthetic Claude skill, producing a **656-byte
`.tar.gz`** with **1 exported / 1 imported** item. Imported UTF-8 content,
including `café`, matched exactly. Source, destination, fake home, and backup
were isolated in the owned temporary tree; the owned temporary directory was
cleaned afterward.

### Optional bounded in-memory ratio check

1. Resolve the real `tar@7.5.22` parser from agent-stash and assert its default
   `maxDecompressionRatio` is `1000` without overriding it.
2. Build a **2 MiB zero-filled Buffer** representing a valid empty tar archive
   with zero padding after its end blocks. Compress it in memory with
   `gzipSync`; assert the measured decompressed/compressed size ratio exceeds
   `1000` before proceeding. Keep the entire decompressed fixture at or below
   **2 MiB**; do not add a regular-file body or grow the fixture to force the
   ratio premise.
3. Feed only that bounded gzip Buffer to `new tar.Parser({ strict: true })`.
   Register an error handler before writing and drain entries in memory.
   Expect an abort/error containing `max decompression ratio exceeded`.
4. Do not call `tar.extract`, create output files, stream unbounded input,
   allocate an expanding fixture, or weaken the default limit to force success.
   Record this only as optional bounded manual validation, not a new test/API.

Parent-reported result on August 26, 2026: **passed**. The bounded **2 MiB**
zero-padded empty tar compressed to **2067 bytes**. The real parser retained
the default limit **1000** and emitted `max decompression ratio exceeded`,
without disk extraction. The initial regular-file fixture at or below 2 MiB
had a ratio below 1000 and failed the QA premise, not the guard assertion; it
was replaced with the valid empty-tar padding fixture rather than increasing
the size budget or changing the default limit.
