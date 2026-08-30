# Compiled legacy v2 — bounded author replay passed

August 27, 2026. The single corrected readiness attempt, unchanged **505-row**
core cohort, unchanged **203-row** state cohort and both original direct-source
noEmit commands passed. No additional tests, retries, builds or source changes.
This closes only the requested bounded author replay, not independent acceptance.

## Candidate and pre-execution freeze

- Candidate: `eba049535d154f4e028f57ffd8efd7622b2239ca`.
- Tree: `62d75ef09e89d4d3b6afc032c518d2846dcd03b7`.
- All-src SHA-256: `40914b93fe1a1a82d9abdcdf4f4cc4360ab6e85ab16b5d9f75768e00c73213ec`.
- Nine-path patch SHA-256: `83b339002970df881efb56cc50fa0e0e74f1f832edb6c8706287827a3dc5e4ad`.
- Orchestration frozen before execution: `492d2cd6b4eacc492fbca704ab3e5d4d290ca988`.
- Exact probe delta SHA-256: `63b26436a778f3e17a6804fbcc114f6c3e878e0d7518b94d54fe0f85d63893fe`.

`FREEZE.json` binds the bootstrap, parent probe, exact historical delta, plan and
orchestration. These committed bytes were checked before/after execution. The
bootstrap uses explicit ESM import of `node:worker_threads`, dynamically imports
the exact generated worker URL, then reports completed import and closes its port.
Parent observations are the unchanged product ready message, author import-complete
message for that URL, no worker error and **actual worker exit 0**. No separate
port-close event is claimed; the historical unconditional closure label is absent.
Worker bytes/protocol and the 300-second outer bound were not weakened.

## Actual commands and rows

| Command/cohort | Result | Command seconds |
| --- | --- | ---: |
| Bootstrap static ESM parse under pinned Node22 | exit 0 | 0.030048333 |
| Parent probe static ESM parse under pinned Node22 | exit 0 | 0.029877250 |
| One worker readiness attempt | exit 0; ready/import/exit observed | 0.057601833 |
| Same 27 core/network/etc entrypoints | **505 pass / 505; 0 fail/skip/cancel/TODO** | 14.134137750 |
| Same 6 state entrypoints | **203 pass / 203; 0 fail/skip/cancel/TODO** | 0.604735625 |
| Original focused strict direct-source noEmit | exit 0, stdout/stderr empty | 0.770854375 |
| Original source-wide noEmit | exit 0, stdout/stderr empty | 1.565517500 |

Original commands are authenticated from `f27b7b595c529d26161a21cf86d2a86fc0d2cee3`;
all exact argv, environments, raw stdout/stderr, timings and hashes are in
`PREFLIGHT.json` and `runs/*/RUN.json`. No assertions, inputs, goldens or native
oracles changed. Static/readiness/type processes are not test rows. Execution
window including evidence/inventory overhead: `2026-08-27T20:20:08.077350+00:00`
through `2026-08-27T20:20:33.025508+00:00`.

Focused noEmit uses the four original author TS inputs and original strict flags.
Source noEmit is `node node_modules/typescript/bin/tsc --noEmit -p tsconfig.build.json`.
Neither is the maintained global tests/consumer typecheck. No global diagnostics
were investigated, fixed, excluded or rescored. Earlier 42 runtime checks were
not repeated, and no other worker's checks substitute for these cohorts.

## Reused build identity and integrity

Only this author's retained regular snapshot was reused:
`/tmp/safe-bash-owned-output-built-legacy-a_x4yi9h/candidate`.
Its complete immutable inputs/tools/dist matched the committed cf597 manifests,
including added-entry detection, and all selected archive files matched exact eba
Git bytes. Archive SHA-256:
`8fc214ffbe8544703d3f7b47cb2e6df98805fe1aaa30b03a790d47217438e162`.

The prior successful build has exactly 824 generated regular files. Dist inventory
SHA-256: `3189d7dd493248d41de38f01055e1ecf844bf10e7226d9b453ad3a1f0d03dfd9`.
Worker: 1981 bytes, SHA-256
`46479e6d87bd5d20371a2e523310b2275c74d32d15105fcc9678ec73410efe4f`.
Complete snapshot inventory before/after:
`50727697894edc0a1e6ccc8fbf276de5ba2e0e23ebd5f35a76ebc4e80196be52`.

Node `/Users/kjopek/.nvm/versions/node/v22.22.2/bin/node` is pinned v22.22.2
darwin/arm64. The same seven installed/copied tool packages, TypeScript 5.9.3,
compiler entry/implementation and three external executable inventories match
the immutable prior manifests. These complete manifests are linked by commit and
hash rather than copied again. All snapshot/tool/orchestration guards passed
before/after every command, including unexpected regular entries. Fresh per-run
HOME/TMP: `/tmp/safe-bash-owned-output-built-legacy-v2-9cbbjquh`.

No process-group remainder was observed after any command; all exited without
outer timeout, kill or forced worker termination. The readiness probe observed
natural worker exit; tests settled normally. This is not separate port-close,
host-wide detached-process/FD/syscall, OS-library, timestamp/xattr, atomic or
intervening-state proof. Snapshots and scratch remain retained.

## Historical contrast and limits

`cf59762539aff3f5454ad9b048598fdff4268b2c` stays unchanged: build passed, author
readiness bootstrap failed before worker import, legacy/type commands not run.
`f8fdae7289162494d09f887bed4846edfd6575cf` stays unchanged: 487/505 pass, 18 fail
in the source-only profile, including 17 explicit missing-worker errors and the
separately unclassified pipeline expected `3\n` versus actual `0\n`.

`CONTRAST.json` binds all 18 corresponding names/numbers to **observed passing
TAP rows in v2**, including pipeline row 231. They are not another test cohort or
retroactive passes/invalid fixtures. No isolated native cause for the historical
pipeline mismatch was established; no product fix was made. Original qualified
live results remain historical, and the five custom first-read requirements stay
separate and not measured here.

Zero private queries/imports, builds, packs, installs or root-dist writes in v2.
No product/config/legacy-test edits, getopts, full gate, extra audit or other-worker
data access. AUTHOR verification only; no independent, release or promotion claim.
The bounded run is complete and stops after this handoff.

Sealing note: `git diff --check` reports trailing whitespace on two raw state TAP
lines containing the unchanged test name `origin and binary cursor `.
Those raw bytes are preserved; no formatting rewrite or test retry occurred.
