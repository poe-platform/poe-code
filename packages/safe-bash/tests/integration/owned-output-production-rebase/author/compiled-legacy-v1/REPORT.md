# Compiled-prerequisite v1 — author harness stop

August 27, 2026. **The isolated candidate build passed; legacy qualification
remains open.** The new author-owned readiness bootstrap failed before importing
the generated worker. No legacy test or no-emit command ran. No source fix,
bootstrap repair, automatic retry or second build was performed.

## Frozen inputs and successful build

- Candidate remains `eba049535d154f4e028f57ffd8efd7622b2239ca`.
- Tree: `62d75ef09e89d4d3b6afc032c518d2846dcd03b7`.
- All-src SHA-256: `40914b93fe1a1a82d9abdcdf4f4cc4360ab6e85ab16b5d9f75768e00c73213ec`.
- Nine-path patch SHA-256: `83b339002970df881efb56cc50fa0e0e74f1f832edb6c8706287827a3dc5e4ad`.
- Selected archive SHA-256: `8fc214ffbe8544703d3f7b47cb2e6df98805fe1aaa30b03a790d47217438e162`, 14663680 bytes.
- Regular snapshot: `/tmp/safe-bash-owned-output-built-legacy-a_x4yi9h/candidate`.

The archive contains all 247 src entries (206 TS files), the original required
test/helper directories, four focused author TS inputs, package/lock and both
build configs. Everything comes from eba Git blobs, not current HEAD. The archive
hash equals the prior source-only archive; the artifact profile is different.
No dist was present initially and no built output was copied from anywhere.

The single build command was the frozen package build script's direct equivalent:

```sh
node node_modules/typescript/bin/tsc -p tsconfig.build.json
```

Build exit **0**, duration **2.411831958 seconds**, stdout/stderr both empty.
Started `2026-08-27T20:08:33.494094+00:00`; finished
`2026-08-27T20:08:36.290178+00:00` (capture/inventory overhead is outside the
command duration). Frozen `tsconfig.build.json` extends only frozen
`tsconfig.json`; neither was edited. Config Git blobs and all selected source/test
Git entries are in `PREFLIGHT.json`.

`BUILD-OUTPUT.json` records exactly **824 generated regular files**, matching
four outputs per source TS file, their modes/bytes/hashes, directories and map
bindings back to exact archived source bytes. Canonical dist inventory SHA-256:
`3189d7dd493248d41de38f01055e1ecf844bf10e7226d9b453ad3a1f0d03dfd9`.

The generated `dist/commands/regex-execution/worker.js` exists as a regular file:
1981 bytes, mode 0644, SHA-256
`46479e6d87bd5d20371a2e523310b2275c74d32d15105fcc9678ec73410efe4f`.
This establishes its fresh build provenance and presence, not successful runtime
readiness or the cause of all earlier legacy failures.

## Readiness probe failure — author-owned, not product

The parent probe runs Node with `--input-type=module`. Its eval-worker bootstrap
starts with `const { parentPort } = require("node:worker_threads")`, then intends
to import the generated worker and close its parent port. The actual bootstrap
executes in ESM scope and fails on that first `require`, before the dynamic import:

```text
ReferenceError: require is not defined in ES module scope, you can use import instead
    at file:///private/tmp/safe-bash-owned-output-built-legacy-a_x4yi9h/candidate/[eval1]:1:24
```

Probe exit **1**, duration **0.046871541 seconds**. Actual stdout:

```json
{"ready":false,"exitCode":1,"naturalPortClosure":true}
```

The last field is an **unconditional author probe label**, not an observation of
successful port closure. The failing bootstrap never reached that closure. It
must not be used as readiness or natural-port-cleanup evidence. The complete
command and unaltered output are in `runs/worker-prerequisite/`; the helper stays
unchanged to preserve this failed attempt. This is a demonstrated harness error,
not a valid legacy test failure or a generated-worker/source defect verdict.

## Requested cohorts — not run

| Requested command | Actual status in this profile |
| --- | --- |
| Same 27 legacy entrypoints / 505 rows | NOT RUN: readiness prerequisite failed |
| Same 6 state entrypoints / 203 rows | NOT RUN: readiness prerequisite failed |
| Same focused strict direct-source noEmit | NOT RUN: readiness prerequisite failed |
| Same source-wide noEmit | NOT RUN: readiness prerequisite failed |
| Earlier 42 exact-source author checks | Not repeated; earlier scoped record unchanged |

Zero test rows were executed; build/version/probe processes are not test rows.
Both noEmit commands target direct source and retain their original exact command
bindings in `PREFLIGHT.json`. The successful emitting source build is not a run
of either noEmit command or the maintained global test/consumer typecheck.
No global type diagnostics were investigated, repaired, excluded or rescored.

## Tools, integrity and process settlement

Node is `/Users/kjopek/.nvm/versions/node/v22.22.2/bin/node`, v22.22.2 darwin/arm64.
Compiler version command returned `Version 5.9.3`, exit 0 in 0.092312167 seconds.
Compiler entry `node_modules/typescript/bin/tsc` SHA-256:
`8d5fa5bd883fec0979fc2004f1fe1d99aef40570155d550eadc0b03b55513bf0`;
implementation `node_modules/typescript/lib/_tsc.js` SHA-256:
`e8f349eabd48486bdb2bf9dc1a00c89d58297270c54b745838879e2859194419`.

The same seven complete regular installed tool packages and three external
executables match the previous profile by full inventory/hash, not just version:
tsx 4.23.12, TypeScript 5.9.3, @types/node 22.20.1, esbuild and
@esbuild/darwin-arm64 0.28.2, undici-types 6.21.0, fsevents 2.3.3; Node,
`/bin/bash`, `/usr/bin/curl`. The native oracles were versioned but no legacy
cohort ran to use them. Absolute original package roots and executable hashes
are retained in `PREFLIGHT.json`; only regular copies enter snapshot node_modules.

Source/test/config/copied tools and original tools match before/after, including
unexpected regular file/directory additions. Generated dist also remains unchanged
after its single build. Final complete snapshot inventory SHA-256:
`50727697894edc0a1e6ccc8fbf276de5ba2e0e23ebd5f35a76ebc4e80196be52`.
No live source, stale dist, other-worker files or private inputs entered the archive.
Per-command HOME/TMP is isolated outside the guarded snapshot. Controlled PATH,
locale, timezone and cache policy are recorded; inherited NODE_OPTIONS/NODE_PATH
and proxy credentials are absent.

All three process groups were absent at the immediate post-exit observation.
No outer timeout, kill or forced worker termination occurred. The failed probe
exited through its error path; no successful worker-ready settlement is claimed.
No test children were started. These sequential checks do not prove host-wide
detached-process/FD absence, intervening-state integrity, timestamps/xattrs or
OS-library closure. The retained regular TMP is this author's own output only.

## Additive qualification and handoff

`f8fdae7289162494d09f887bed4846edfd6575cf` remains unchanged: 505 source-only
rows, 487 pass and 18 fail; 17 explicitly missing dist worker, plus the separately
unclassified pipeline expected `3\n` versus actual `0\n`. The worker is now built,
but **none of those cases was rerun**, so none is reclassified as passing or an
invalid fixture. No new native cause or pipeline diagnosis was observed.
Original 42 exact-source passes and qualified live 708/type results stay historical.

One isolated public build; zero private queries/imports, packs, installs, root-dist
writes or source/assertion/config changes. No test retry, extra behavioral cases,
getopts, global/full gate, benchmark or release claim. The original five custom
first-read requirements remain separate and not measured. Active public/private
and Curie work was neither opened nor polled.

ROOT must route any corrected readiness probe and subsequent fresh replay; this
bounded attempt stops without a repair or additional proof iteration. This record
is AUTHOR verification only, not independent review, release acceptance or promotion.
