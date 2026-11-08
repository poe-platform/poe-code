# Pinned XAN composition harness

Explicit opt-in historical-candidate harness, not canonical test discovery.
Only the two public final-freeze files are read; independent fixtures are neither
read nor copied. The tool authenticates unique `5137`, full freeze, public SHA256s,
and all seven shared-contract bindings before building.

```sh
node tests/commands/xan-author-20260828/assembly/assemble.mjs
node tests/commands/xan-author-20260828/assembly/assemble.mjs --candidate FULL_COMMIT
node tests/commands/xan-author-20260828/assembly/assemble.mjs --candidate FULL_COMMIT --audit-from FULL_PARENT --factory createXanCommand --runtime-entry tests/commands/xan-author-20260828/core/compiled.test.mjs
```

No output option: every invocation creates its own OS-temp directory, prints its
location, and retains receipts, failed builds, stdout/stderr, source/tool archives,
and sorted per-file SHA256 inventories. Do not manufacture the CLI output directory.
Processes have 120-second bounds and run synchronously; no background workers.

## Exact inputs

- Baseline `5137a74ec855a32d8a8860eb66b62eb44d11e290` supplies all 211 TypeScript
  files selected by its actual `src/**/*.ts` build include, plus its exact
  `package.json`, `package-lock.json`, `tsconfig.json`, `tsconfig.build.json`.
  This is the full baseline build set, **not** a proven minimal dependency closure.
- Freeze `55810d4aea70fadf151c2fbf746a17f96bfeb599` supplies only public
  `FINAL-CONTRACT-V4.md` and `FINAL-BINDING-V4.json` as evidence.
- Candidate must be a full commit and contain `src/commands/xan/index.ts`.
  Only module `.ts` files outside design-evidence enter the product build. No
  root exports, contracts, provider, runtime, package or configuration overlay.
  Documents and author-core tests are separately bound and copied as evidence.
- The candidate tip's first-parent diff is reported. `--audit-from` additionally
  rejects any diff path outside the author module/core ownership. Without that
  option, unrelated ancestor/tip changes are reported but cannot enter composition.
- Existing locked development packages and their installed dependency closure are
  copied into an authenticated tool archive. Versions must match the baseline
  lock. No installs, ambient private package loading, worktrees or Git histories.
  Node's executable hash and real Node/npm/Git/tar versions are recorded.

The baseline package has empty runtime/optional/peer dependency maps. This does
not mean its development tooling has no dependencies. Archives contain no
AGENTS, Git metadata, historical/native tests, or the original node_modules tree;
the separate tools archive contains only explicitly traversed compiler/test tools.

## Checks and interpretation

Baseline build and source-only no-emit typecheck execute **before** overlay.
Failures are retained without repairing foreign code or dropping compiler errors.
Candidate build/typecheck execute independently; emitted files from a failing
build are never used for moved consumer acceptance. This is not `typecheck:all`:
baseline historical tests and maintained public consumers are intentionally absent.

The moved package consists of compiled `dist` and the byte-exact baseline package
manifest, with no `src`. A strict NodeNext consumer imports the actual internal
`dist/commands/xan/index.js`, exercises factory parameter/return types and checks
`CommandDefinition` compatibility; a separate runtime smoke instantiates it. The
factory defaults to `createXanCommand`; select an actual exported name explicitly
if the author chooses a different name. No public export is invented.

Author runtime scripts are optional, committed under the author core, and run in
the moved directory with `XAN_PACKAGE_ROOT` pointing to the compiled package.
Use `pathToFileURL(join(process.env.XAN_PACKAGE_ROOT, 'dist/...'))` for runtime
imports. Source-relative tests deliberately fail rather than redirect to live
source. The runner copies the core tree separately, does not rewrite test bytes,
and does not duplicate independent semantic cases. Scripts may import Node test
tools; dependency lookup outside the isolated directory is not a supported input.
Trusted author test code is not an OS security sandbox.

Input and moved package checks re-enumerate files to detect new entries as well as
changed/deleted files at checkpoints. This is not concurrent tamper prevention.
Archive byte hashes identify this capture, not deterministic tar serialization.
An `ok` receipt with author runtime `NOT_RUN` certifies only the stated assembly,
build/typecheck and factory smoke scope, never semantic acceptance or superiority.

## Initial capture

`INITIAL-BASELINE-MANIFEST.json` binds the initial harness bytes, all 215 baseline
inputs, all 313 tool files, exact package metadata, exclusions, commands and real
tool versions. The initial run completed at `2026-08-28T04:34:34.293Z`; baseline
build and source-only typecheck both returned 0. No foreign diagnostics occurred.
Its source archive is 418,023 bytes; the separate tool archive is 13,852,085 bytes.
Archives and logs remain in the task-owned OS-temp directory named in the manifest,
not in Git. Installed tool bytes are hashed; recorded registry lock integrity is
not a claim of a fresh registry download/SRI verification.

A second run with candidate `5137a74ec855a32d8a8860eb66b62eb44d11e290`
correctly returned 1 with `Candidate module index.ts absent`, after baseline build
and typecheck again passed. Its unmodified failure receipt and logs are under
`/var/folders/rw/s4cy76hn6v55qrp0dhcbtplc0000gn/T/xan-baseline-harness-20260828-6XMQ9t`.
The two runs have the same sorted baseline manifest identity; tar archive bytes
differ because capture metadata is not normalized. Syntax, durable manifest
identity and recorded harness hash checks passed. Candidate composition, moved
strict/factory smoke and author semantic runtime remain unexecuted until an author
candidate is supplied. No source was awaited or fabricated to claim those passes.
