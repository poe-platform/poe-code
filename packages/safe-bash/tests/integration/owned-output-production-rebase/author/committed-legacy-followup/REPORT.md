# Committed legacy replay — stopped author verification

August 27, 2026. **The requested frozen-candidate legacy qualification is not
closed.** No production source/test assertion/oracle/golden was changed and no
build, pack, install, private query/import, repair, waiver or retry was performed.

Evidence sealing: `git diff --cached --check` reports trailing whitespace in the
unaltered raw TAP `runs/core/stdout.txt`. Those captured bytes are preserved;
this formatting diagnostic caused no additional test run or evidence rewrite.

## Candidate and input identity

- Candidate remains `eba049535d154f4e028f57ffd8efd7622b2239ca`.
- Candidate tree: `62d75ef09e89d4d3b6afc032c518d2846dcd03b7`.
- Nine-path source diff: `83b339002970df881efb56cc50fa0e0e74f1f832edb6c8706287827a3dc5e4ad`.
- All-src identity: `40914b93fe1a1a82d9abdcdf4f4cc4360ab6e85ab16b5d9f75768e00c73213ec` (247 source
  entries including documentation, not a test count).
- Exact selected Git archive: `8fc214ffbe8544703d3f7b47cb2e6df98805fe1aaa30b03a790d47217438e162` (14663680 bytes).
- Original command bindings come from accepted evidence
  `f27b7b595c529d26161a21cf86d2a86fc0d2cee3`; no later HEAD or live overlay is used.

`PREFLIGHT.json` records every archived file and the complete selected directory
set. All src entries, required package/config inputs, whole helper/reference
folders, and the four author TS inputs come from the fixed commit. Unselected
files in these helper folders are inert inputs, not additional tests. The archive
contains neither dist nor a Git working tree. Foreign live HTML/getopts state is
recorded only as an observation, never input or admission veto. No active public
worker or final-reviewer files were read or awaited.

## Actual results and stop

| Requested cohort | Actual follow-up result |
| --- | --- |
| Same 27 core/network/etc entrypoints | **505 tests: 487 pass, 18 fail; 0 skip/cancel/TODO; exit 1** |
| Same 6 state entrypoints / 203 tests | **NOT RUN** after the core failure |
| Same focused strict no-emit command | **NOT RUN** after the core failure |
| Same source-wide strict no-emit command | **NOT RUN** after the core failure |
| Existing 42 committed-source author checks | Not repeated; previous scoped evidence unchanged |

Core process started `2026-08-27T19:54:45.785043+00:00`, finished `2026-08-27T19:55:14.627072+00:00`;
actual command duration **28.231324 seconds**. No 300-second
supervisor timeout or kill occurred. Counts are not projected onto unrun commands.
Both no-emit commands were inspected and target direct source; their NOT RUN state
is the failure-stop rule, **not** an invented built-declaration requirement or a
claim that a typecheck failed/passed. No type errors were measured in this follow-up.

Exact executed command, with cwd set to the isolated candidate:

```sh
node --unhandled-rejections=strict --import tsx --test --test-concurrency=4 tests/contracts/io.test.ts tests/contracts/io.stress.test.ts tests/contracts/command.test.ts tests/contracts/invocation-cleanup.test.ts tests/contracts/invoke.test.ts tests/contracts/stdin-provenance.test.ts tests/shell/invocation-cleanup.test.ts tests/shell/invocation-cleanup-setup.test.ts tests/shell/invocation-cleanup-lifecycle.test.ts tests/shell/invocation-cleanup-pipeline.test.ts tests/shell/input-return-cleanup.test.ts tests/shell/output-accounting.test.ts tests/shell/output-accounting-bounds.test.ts tests/shell/pipeline-effects.test.ts tests/shell/streaming.test.ts tests/shell/invoke.test.ts tests/shell/stdin-origin.test.ts tests/commands/streams.test.ts tests/commands/pipelines.test.ts tests/commands/network/byte-ownership.test.ts tests/commands/network/exports.test.ts tests/commands/network/files.test.ts tests/commands/network/http.test.ts tests/commands/network/safety.test.ts tests/commands/network/tls.test.ts tests/commands/network/zero-caps.test.ts tests/commands/network-zero-caps-review/holdout.test.ts
```

The other three original command arrays remain in `PREFLIGHT.json.receipts`.
Original arguments, entrypoints, concurrency=4, test assertions and golden bytes
are unchanged. Controlled execution environment (recorded in RUN.json) uses an
isolated HOME/TMP, C locale, UTC and TSX_DISABLE_CACHE=1, with no ambient
NODE_OPTIONS/NODE_PATH/proxy credentials. This environment control is disclosed,
not an assertion of identical ambient conditions to the old working-tree run.

## Exact failures / demonstrated prerequisite

- **17 failures, TAP rows 481–497:** `tests/shell/stdin-origin.test.ts:227` reports
  `rg: regex WORKER_ERROR: Cannot find module` for the missing snapshot path
  `dist/commands/regex-execution/worker.js`. Actual status is 2 versus required
  0 or 1. All distinct parameter names and exact diagnostics are in `FAILURES.json`.
- **1 failure, row 231:** `tests/commands/pipelines.test.ts:12`, the filtering /
  transforming / sorting / tee pipeline, returns stdout `0\n` instead of `3\n`.
  This assertion fails before its later stderr assertion. Its independent root
  cause was not replayed or guessed.
- Fixed-candidate `src/commands/regex-execution/client.ts:79` explicitly selects
  `../../../dist/commands/regex-execution/worker.js` when loaded from `.ts`.
  `src/commands/regex-execution/README.md:164` documents the emitted worker files.
  Source/blob/SHA-256 bindings for these paths and both failing test files are
  recorded in `FAILURES.json.sourceBindings`.

Thus this exact source-only cohort has a demonstrated compiled-worker runtime
prerequisite. This does **not** prove every failure has that cause or establish a
production semantic defect. The author did not build the worker, copy a live/stale
worker, redirect its URL, add a loader workaround, relax a test, rerun a subset,
or continue the remaining commands. ROOT must resolve the built-candidate
prerequisite through its authorized public-build worker before a new replay is
requested; this author did not inspect that worker's unsealed outputs.

## Tools and integrity

- Node `v22.22.2` at `/Users/kjopek/.nvm/versions/node/v22.22.2/bin/node`;
  host platform `darwin/arm64`.
- Regular copied packages: tsx 4.23.12, typescript 5.9.3, @types/node 22.20.1, esbuild 0.28.2, @esbuild/darwin-arm64 0.28.2, undici-types 6.21.0, fsevents 2.3.3. All versions match the frozen
  package-lock entries. Complete installed/copy file hashes and modes are sealed.
- Native test oracles: `/bin/bash` 3.2.57(1)-release (Apple Darwin profile),
  `/usr/bin/curl` 8.7.1; full version reports and executable before/after hashes in
  `PREFLIGHT.json` and `runs/core/RUN.json`. These are not GNU/Linux semantics.
- Source/test/config/copied-tool **regular-file bytes and modes, descendant
  directory names and modes** match before/after. Full enumeration detects
  unexpected regular files/directories and rejects symlinks/special nodes.
  Original installed tool-package trees and the three external executables also
  match before/after. Snapshot inventory SHA-256 remains
  `09365e7df933c169283c027863d06dd330eb355f61e526d79573838c597d8c9f`. No dist was created.
- Only separate, named per-run scratch paths are outside the input guard; their
  remaining inventory is captured. No exclusion of a source/test/config/tool
  descendant. Checks are sequential, not an atomic/intervening-state proof; they
  do not cover timestamps/xattrs, root-directory metadata, external OS libraries,
  all host processes or syscall-level network policy.
- Unchanged original tests perform explicit loopback/native-oracle work. No
  dependency installation, external service request, full suite, broad syntax
  campaign, native benchmark or capability expansion was introduced.
- Private queries/imports/builds: **0**. Project builds/packs/installs: **0**.

The unique regular snapshot is retained at `/tmp/safe-bash-owned-output-committed-legacy-l_ryg_s7/candidate` for bounded
inspection if ROOT authorizes it. No other TMP directory was touched. Source and
all prior captures remain unchanged.

## Additive qualification

The original exact 42-pass source snapshot, live 505+203 passes and their existing
foreign-dirty/typecheck qualifications remain historical scoped evidence. This
new result must not be rewritten as a pass or used to infer that the five foreign
HTML paths are irrelevant. The additional compiled-worker prerequisite further
prevents transferring live results into a complete clean frozen-candidate gate.

The original five first-read requirements are not rerun, migrated or rescored.
No release acceptance, promotion, independent review or different verifier
appointment follows. ROOT retains consolidation with the already assigned
public/moved-package/current SafeJS author worker and Curie final review.
