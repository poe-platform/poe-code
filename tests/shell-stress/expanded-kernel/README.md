# Seven unchanged expanded-kernel recipes

This is a **new, seven-case replay cohort**, not a rerun or revision of the
224-case comparison. Invocation closure `V2_POSTFIX.md` was inspected first:
the discovery/read-N/sh-profile/BOM/diagnostic changes do not claim these seven
recipes now work. No author expectations were used as oracle.

## Frozen authority and reproduction

`corpus.json` contains the exact seven complete recipes, native observations,
and historical functional rows extracted with `git show 8e09db9:<path>`.
Its provenance includes full Git commit/blob IDs and SHA-256 hashes for the
corrected native capture, functional report, ANALYSIS, recipes, and harness.
Production in that comparison was `bd2cacb3a20403302fd0a49441932d5522793e56`.
The corrected harness was `0294afb6e690433aed994868e5ed437ecf58ae48`.

`frozen/common.mjs` and `frozen/engine.mjs` are byte-identical copies from
8e09db9, hash-checked before every replay. The engine's baseline branch is
never selected. No benchmark files or production files are edited.
Every replay additionally checks recipes and expectations against the original
Git-native artifact, including each serialized recipe hash. No recipe, argv,
stdin, expected byte, or denominator is replaced to obtain a better result.

From the repository root:

```sh
node --import tsx --test tests/shell-stress/expanded-kernel/replay.test.ts
node tests/shell-stress/expanded-kernel/replay.mjs --record next-replay.json
```

Use a fresh evidence filename. The replay exits **1 when any frozen comparison
fails**, or when source guards/native controls fail; it does not convert known
failures into successful assertions. The small test suite checks fixture/harness
integrity, not Bash parity. Only existing development tooling is used.

## Exact launch and capture

All seven use the frozen `/fixture` VFS, explicit empty stdin, no shell arguments,
the complete default `agentCommands()` registry, frozen environment, limits,
file bytes, executable modes, timestamps, and instrumentation. Product code runs
only against the memory filesystem; no network plugin is enabled, no native
subprocess is supplied to it, and no real-filesystem adapter is supplied.
Native subprocesses belong exclusively to this independent test harness.

Each native case gets its own temporary fixture directory and original role-bin
layout. Every recorded executable role is recreated from the frozen tool map and
hash-checked. The historical profile changes only bash/sh to `/bin/bash`.
The actual absolute `/usr/bin/env` interpreter is separately hashed.
Native argv is `--noprofile --norc -c 'umask 022\n<unchanged-script>' benchmark`,
with argv0 `bash`. Environment is the original C/UTC profile, PATH set to the
isolated role-bin, HOME to the temporary fixture, and TMPDIR to its `tmp` child.
No startup files, BASH_ENV, inherited shell options, or ambient PATH are supplied.

Independent controls check launcher `$0`/`$1`, locale/timezone, raw NUL/FF bytes,
native printf/cat roles, PATH resolution, and env-shebang target Bash version.
Only the frozen temporary-root and role-bin path rendering is used; raw bytes,
actual launch/env, and replacement pairs are also retained. These seven outputs
need no rendering changes, and file snapshots contain no host-root strings.
Full stdout/stderr/status/file-tree effects are retained as base64, not prefixes.
Native observations are compared both to frozen expectations and current output.

The native subprocess deadline is eight seconds; virtual startup/call deadline
is fifteen seconds, in addition to the frozen five-second execution signal.
All native process groups and the virtual worker are stopped; temporary fixtures
are removed. Evidence records PIDs and group-absence checks.

## Results on August 27, 2026

The first capture `replay-20260827.json` ran at 02:06:25–02:06:29 UTC, on HEAD
`b5ec52a0d3ff16da47e814729f72153f9b09b926`; shell source remained
`b02bbe855b6b45d635b521e3dc2f31ea2b04e215`.
`replay-sealed-20260827.json` repeats the same seven after adding the immutable
Git-expectation check and runner hashes. Its own exact snapshot is authoritative.

| Exact unchanged recipe | Current / expected | Remaining finding |
| --- | --- | --- |
| kernel/type/type | fail / status0 | `command/command/function` vs `builtin/file/function` |
| kernel/executable-file/executable-file | fail / status126 vs0 | no-shebang direct execution refused |
| kernel/env-shebang/env-shebang | fail / status126 vs0 | `/usr/bin/env bash` interpreter refused |
| kernel/source/source | fail / status0 | missing source; later printf masks failure |
| kernel/dot/dot | fail / status0 | missing dot; later printf masks failure |
| kernel/eval/eval | fail / status127 vs0 | missing eval |
| kernel/parameter/parameter | fail / status2 vs0 | combined expansion rejected at offset70 |

Current **0/7**, GNU5.3 **7/7** against frozen, historical3.2 **7/7** against
frozen; current versus either native profile **0/7**. No skipped/unsupported
rows removed. All seven current stdout/stderr/status/tree observations equal
their original frozen failing observations: **zero newly fixed recipes, zero
newly discovered failures**, seven independently reconfirmed remaining gaps.
Type is an intentional truthful registry distinction, not permission to pretend
registered printf/cat are native builtin/file implementations. The two execution
failures are consistent with the invocation cohort's retained interpreter limits.
Source/dot/eval is required next, but no implementation was started here.

GNU5.3 is a consistent design profile, **not a user-mandated dialect**.
Pinned GNU Bash5.3.0 binary SHA-256:
`8cecb482de24198c23a736b931cb7e8cee1f94eb0b51abd54bd99f1d73d9673c`.
Historical GNU Bash3.2.57 binary SHA-256:
`35536aea9733aa345b61134a98d00232380898e55b2ea2a07c497011f7dfc7a3`.
There are no additional 3.2-versus5.3 mismatches in these exact seven; historical
mismatches in other invocation cohorts are neither rerun nor erased.

## Snapshot and scope limits

The first capture hashes all156 source files before/after, and130 actually loaded
source modules through an import hook (132 total file imports). All match; zero
mid-run source/import drift. Exact source snapshots and imported paths/hashes,
tool versions/hashes, package/lock/tooling hashes, starting/ending dirty status,
and frozen-to-current differences are retained in JSON.

This is not a clean committed-HEAD product validation. Imported non-shell code
differs from bd2cacb: core filesystem/streams, structured jq, S3 authority/filesystem,
and archive format code; archive source was dirty. Documentation changes are
also listed. These dependencies were stable during capture, not silently treated
as the old frozen implementation. Root imports intentionally retain actual
aggregate wiring and registry behavior rather than substituting shell-only mocks.

The original9 historical diagnostics and5 custom-first-read lifecycle cases stay
separate: **not rerun, not closed**. The baseline/full224 harness, broad shell
suite, whole-product typecheck/build, and benchmark performance were not run.
No overall kernel parity, full Bash, superiority, or72-hour completion claim.
Foreign files and staging are untouched; only this owned directory is committed.
