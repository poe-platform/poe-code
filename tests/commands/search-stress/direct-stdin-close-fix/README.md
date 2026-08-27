# Direct search stdin close fix — bounded author proof

## Source and scope

Source/test commit: `c27249c8f6085d6d8366ae348b2b93aa0e377369`.
Only production change is `src/commands/search/rg.ts`: import the existing
`readBytes`, then select `readBytes(stdin, limits.signal)` for the stdin branch
before `AvailableRecords.source`. Exact two-line diff: `source.patch-data`.
No helpers, regex executor, workers, Shell, contracts, exports, configuration,
dependencies, existing tests, or existing timeouts changed.

The wrapper's inner pending read now observes cancellation and reaches the raw
structural iterator's independently callable return. The outer wrapper alone
could not do this. Existing fileInput already performs the inner readBytes.
This is direct-handler repair, not a claim that public Shell ownership was broken.
Opaque generator return invocation remains different from finally completion;
this patch does not make opaque host work preemptible.

- rg.ts before SHA256: `fee9a380679e17da179a1c6b4f9bacf9c89a10e0dd1d18981c26b9296f9846d3`
- rg.ts after SHA256: `1c38e14b811a46795af958a99b9fae6b02b415b6ff8363e5755ecd15bfdd9d5f`
- New canonical test SHA256: `d9cb40c6c1dc53365486ffab1492d4fa0e865d48b5ea8fa0deeac600c7c58c5b`
- Candidate src-path manifest SHA256: `cd07676b776d9650ba8e32ebe60916c3d10b5195308c6d671a78a6bf8d9cc618`

The last hash is SHA256(JSON.stringify(candidate.files filtered to `src/`)),
with ordered `{path,sha256}` entries. It is not a Git commit or full-release hash.
The typed factory and public API are unchanged; new tests use public typed
`createSearchCommands`, `CommandContext`, `Shell`, and `searchCommands` exports.
`source-commit.json` authenticates committed source/test bytes and unchanged
public/factory declarations from the two task-only builds.

## Authentication and build qualification

Frozen reference: `b494675c34dc289f4ad4b10a9201e1211eb0a7d8`; sidecar reference:
`c5d44262ecca11009df6ce32a180005d3f3cb574`. All 229 sidecar-listed frozen files
were checked against Git; relevant current search, helpers and old canonical
tests match. The three recorded current differences are `package.json`,
`tsconfig.json`, and `src/commands/execution.ts`. They are not silently replaced
by frozen bytes. All 31 sidecar evidence files remain identical to their commit.

A new task snapshot captured 232 current source/test/config paths, including 213
tracked `src/` paths, at 2026-08-27T13:27:04.249Z. The patched snapshot adds the
canonical regression and four separately authenticated author-test/helper paths
(237 paths total). Initial/live HEAD and source drift are recorded, not assumed
equivalent to b494675. Before committing, all candidate paths matched live bytes.

Existing Node v22.22.2 and pinned ripgrep 15.2.0 executable hashes match sidecar
evidence. The 192 copied tsx/esbuild/TypeScript files also match; additional copied
typing dependencies have separately recorded current hashes. Total copied tool
inventory is 307 files: tsx 4.23.12, TypeScript 5.9.3, esbuild 0.28.2,
@types/node 22.20.1. Nothing installed or fetched.

Builds run only in new task directories with the current tsconfig.build.json.
All 708 emitted files per build are hashed. All four regex JS modules have
identical pre/post build hashes. Their bytes differ from the sidecar's transpile
output by source-map trailers (verified identical when those trailers are removed),
not asserted historical emitted-byte identity. First patched runtime tests use
the copied pre-patch worker build; the subsequent patched build verifies those
worker bytes are unchanged. No root dist use/build or historical snapshot edits.

## Results — separate cohorts

| New run | Result | Wall ms |
| --- | --- | ---: |
| Original unchanged safety wrapper, pre-fix | outer 0/1; nested 9/10, line 39 false !== true | 1188 |
| Focused pre-fix fixture v1 | 8/14; four close failures, two fixture failures | 500 |
| Focused pre-fix fixture v2 | 9/14; four close failures, one fixture type mismatch | 485 |
| Final focused regressions, patched | **14/14**, no skips/cancellations | 843 |
| Original unchanged safety wrapper, patched | **1/1**, original nested 10-pass assertion unchanged | 552 |
| Original nested safety cases, separate raw replay | **10/10**, no skips/cancellations | 458 |
| Original author rg/safety/pipeline tests, serial | **107/107**, no skips/cancellations | 3308 |
| Before / after task-only source build | both exit 0 | 1594 / 1584 |
| Initial / final focused strict typing | both exit 0 | 1215 / 1173 |

The fourteen tests cover Error/zero/native-default cancellation identity, exactly
one structural close before direct settlement, late next rejection/no unhandled
rejection, input/output quotas, cleanup-error precedence, quiet/max-count stop,
natural UTF-8/null-data/no-match results, untouched unrelated stdin for file input,
actual public structural ownership, nonreturnable borrowing and nested/sibling
ownership, and direct/public opaque generator controls. All controlled gates are
released and their pending next/return work is awaited; owned Shells are disposed.
Chunk-boundary borrowing fixtures do not assert universal byte handback.

Test intentions were recorded before any focused runs. Both failed pre-patch
fixtures are preserved as inert `.data` with raw logs. Corrections are disclosed
in `fixture-corrections.md`; no old assertion or timeout changed. Final expected
bytes were frozen before patched execution. There is no measured final-fixture
pre-patch 10/14 claim. One production patch, one patched focused cause iteration.
Typing/build success is not service acceptance or a whole test gate.

## Exact reproduction

Retained executable task: `/tmp/safe-bash-search-stdin-close-fix-20260827`.
The task runner `run.mjs` fixes task temp/cache/home variables before loading tsx,
puts pinned rg first in PATH, removes NODE_OPTIONS/NODE_TEST_CONTEXT, runs one
child group at a time, records timestamps/load and installs 60/65-second watchdogs.
No watchdog fired, no signals were sent, and all eleven run groups exited and
were checked without survivors. Cohost work was not controlled; wall times above
are bookkeeping, not performance comparisons. No concurrency load was generated.

Original command, with `before` or `after` as cwd:

```sh
task=/tmp/safe-bash-search-stdin-close-fix-20260827
cd "$task/after"
export PATH="$task/native-bin:/Users/kjopek/.nvm/versions/node/v22.22.2/bin:/usr/bin:/bin"
export TMPDIR="$task/tmp" TMP="$task/tmp" TEMP="$task/tmp"
export TSX_DISABLE_CACHE=1 TSX_CACHE_DIR="$task/tmp/tsx" HOME="$task/home"
export LANG=C LC_ALL=C TZ=UTC RIPGREP_CONFIG_PATH= NO_COLOR=1
unset NODE_OPTIONS NODE_TEST_CONTEXT
node --import tsx --test --test-concurrency=1 \
  '--test-name-pattern=^isolated cancellation and iterator lifecycle checks$' \
  tests/commands/search-stress/safety.test.ts
```

Other exact node arguments, cwd, executable/environment and results are in
`runs/*.json`; stdout/stderr are unmodified `.data`. Canonical regression command:
`node --import tsx --test --test-concurrency=1 tests/commands/search-stress/direct-stdin-close.test.ts`.
Author scope: `tests/commands/search/{rg,safety,pipelines}.test.ts`, expanded as
three explicit arguments, not the separate search-stress differential corpus.

Snapshots are gzip-compressed JSON arrays of `{path,sha256,bytes,base64}` in
`before-source-snapshot.json.gz.data` and `after-source-snapshot.json.gz.data`.
They retain complete selected inputs, not merely hashes. Decode into a new task
directory only. Original executable task copies, tool copies, logs and programs
are preserved; raw code in this evidence directory is inert `.data`.

The staged all-evidence `git diff --check` reports trailing spaces in the three
pre-fix raw TAP stdout captures (Node assertion-diff indentation). Those bytes
are deliberately retained, not formatted away. Source/test and authored
Markdown/JSON whitespace checks are separate; raw capture warnings are not a
product/test failure or a reason to alter historical output.

## Limits and handoff

The recorded 10-second differential file-bootstrap/envelope failure remains
**UNRESOLVED**. Historical b494675 whole-gate results (16840 total, 16520 pass,
307 fail, 13 skip) and the separate 486/486 serial result remain historical,
separate cohorts. Neither is rescored here; no 486 replay, whole suite, global
typing, timeout increase, native-incompatibility claim, or release claim.

TEMP32/32 remains bounded-design-only; the future SafeJS owned-output membrane
audit remains NOT DONE. No first-read prototype production change, private
checkout change, independent Arch holdout inspection, delegation, reviewer
launch, or independent-acceptance claim occurred.

Source/test and evidence commits are separate and explicit-owned-path only.
Foreign work/index and native artifacts, especially `.native-1m4O1e/`, are left
untouched. `precommit-audit.json`, `source-commit.json`, `final-audit.json`, and
`evidence-manifest.json` record ownership and integrity. Root must verify the
leaf's actual exit before routing this handoff; this is not a readiness marker
or a 72-hour completion claim.
