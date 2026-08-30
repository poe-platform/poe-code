# date / sleep / printenv author handoff

August27,2026. **Author checkpoint; independent verifier required.**
Ownership: only `src/commands/time-env/**` and `tests/commands/time-env/**`.
No runtime, FS, contracts, root exports/configuration, default registry or
historical full-gate evidence changes. No full-suite rerun or private writes.

## Integration proposal

Source `index.ts:8` exposes `createTimeEnvCommands(options)` and `index.ts:13`
exposes `timeEnvCommands(options)`. Exported types are
`TimeEnvCommandsOptions`, `TimeEnvLimits`, `SleepScheduler`. Commands are
`date`, `sleep`, `printenv`; collision preflight and replacement follow the
existing family plugin style. Scope/grammar/precision/limits are specified in
`src/commands/time-env/README.md`.

Root can add a leaf package export for the built index, root value/type exports,
and an aggregate `timeEnv?: Omit<TimeEnvCommandsOptions, "replace">` option.
Those changes are **not made here**. Initial actual Shell/default-registry probes
returned127 for all three names; both frozen compiled consumers still observe
60 defaults and none of these names. The plugin itself is usable explicitly.
Do not infer a current moving-root count after other families integrate.

Example verified workflow (injected clock1709210096123 milliseconds):

```sh
date -u +%FT%T.%3NZ > stamp
env -i A=hello printenv A | tr a-z A-Z
sleep .001
cat stamp
```

Exact stdout: `HELLO\n2024-02-29T12:34:56.123Z\n`; the stamp VFS bytes also
match. Additional actual Shell tests cover own `__proto__`/`constructor` data,
env replacement and parent preservation, command substitution, date loops into
sort/cut/wc, NUL-delimited publication, quota failures and cancellation.

## Frozen results, not mutable-worktree claims

| Capture | Source | Tests | Types/build/built imports |
| --- | --- | --- | --- |
| Original completed family | `df780f6ddb6292283114461ff4f9ebacfb269205` |219/219 |all scoped checks pass |
| Endpoint correction | `d904ca986fa945df8aef6e11b4165e2c2a63f814` |**223/223** |all scoped checks pass |

Both have **zero skips, cancellations or TODOs**. The223 total consists of150
always-runnable top-level tests,72 native subtests and their one parent wrapper.
The72 native subtests include45 exact date vectors,11 environment vectors,
14 finite/invalid sleep cases, one help-status test and one measured-mtime test.
Invalid diagnostics are checked for status/presence rather than platform-specific
wording. Help identifies this virtual implementation, not GNU's version/text.
The two256-vector arithmetic stress loops are two tests, not512 extra passes.

Each frozen run reconstructs216 committed regular files, copies318 regular
development dependency files, copies the exact three native binaries and four
primary C sources, and excludes later dirty work. Product/package runtime
dependencies remain empty. No source fallback or dirty dist reuse. Commands,
inputs, before/after hashes and cleanup are under the two `evidence/frozen-*`
directories. The second complete `src/` hash-set SHA256 is:
`5eecda220b88787b50968c958c5e6861b09cb7862320d63755c12a1fd34a5b09`.

Per frozen run: scoped source/test tsc exits0; complete frozen-source build
exits0; direct **compiled leaf**, Shell and FS imports execute successfully;
strict built-declaration consumer exits0; negative consumer exits2 with exactly
two TS2322 and one TS2741 diagnostics (bad clock result, missing scheduler clear,
wrong byte-limit type). These are compiled leaf checks, **not published packed
package acceptance**. Root integration and packed-export verification remain.

One moving-worktree typecheck during Sagan's runtime edits reported eight foreign
`[invocationScope]` IO diagnostics. No runtime edit was made. Both committed
snapshots' scoped typing/build are clean; neither statement certifies mutable
HEAD or constitutes a global whole-product typecheck.

## Preserved failures and genuine correction

`evidence/history/` retains preliminary author runs, including40/41 (floating
duration rounding),193/196 (sleep delimiter plus mismatched host mtime input),
and197/200 (newly exercised negative-zero/help option semantics). Later green
cohorts have added tests, not a misleading same-denominator claim.

The native mtime probe requested1700000000123ms through Node utimes; Apple
actually stored1700000000122.999ms /1700000000122999000ns. Native date correctly
printed`1700000000 122999000`. The corrected differential supplies the **measured
file metadata** to VFS, rather than comparing unequal host/virtual timestamps or
changing product formatting to imitate the setter. Exact125ms and negative1250ms
controls are retained separately in the native profile.

After the219-test freeze, two new native endpoint probes exposed an actual
product bug: valid IANA wall dates in years0000/9999 were rejected because offset
sampling visited adjacent out-of-display-range years. `endpoint-before.json`
preserves both status1 virtual versus status0 GNU results. `d904ca9` changes only
calendar sampling and adds both vectors; caller input/output range checks remain.
The original219 result is preserved and does not pretend it included these cases.

## Native profiles and retained gaps

GNU **coreutils9.7 on Darwin arm64**, macOS26.4.1; Node22.22.2,
ICU78.2/tzdb2025c; C locale with explicitly supplied virtual/native TZ.
The existing primary-source archive hash is verified:
`e8bb26ad0293f9b5a1fc43fb42ba970e312c66ce92c1b0b16713d7500db251bf`.
The four C sources match archive bytes. No recompile/download/signature
verification is claimed. Both profiles record exact binary SHA256 values:

| GNU9.7 executable | SHA256 |
| --- | --- |
| date | `14c1c04f8a1e859e9421993856ba1d29f49dc750d91be5dd299841f970f31f44` |
| sleep | `6b90f4cbba603c981bbf7324026ea99fe30efb167ccae0e1d579b54cab86a95f` |
| printenv | `8c2d4675579df37dd2cd6eac8a9d27e61a5b92e4c18d830110a85c04cffab4d9` |

`dialect-profile.json` separately records Apple `/bin/date`, `/bin/sleep`,
`/usr/bin/printenv` hashes and exact byte/status observations. Apple date uses
read-only `-r EPOCH` operands, never clock-setting syntax. BSD `-r` is not GNU's
reference-file option. No Linux control was available/run; do not generalize a
Darwin GNU/libc result to every GNU platform. In particular, the pinned sleep
build rejects `-- 0`; the implementation explicitly documents this profile.

The following **strict differences remain**, with native and virtual bytes/status
retained, and **zero acceptance credit**:

| Input/profile | GNU9.7 Darwin | Virtual |
| --- | --- | --- |
| TZ=Asia/Kolkata, `-d@0 +%Z\ %z` |`IST +0530`,status0 |`GMT+5:30 +0530`,status0 (ICU label) |
| New York ambiguous2024-11-03 01:30 |epoch1730611800,status0 |status1; explicit offset required |
| `-d@0.123456789 +%12N` |`123456789000`,status0 |status1; supported precision1..9 |
| `-d '2024-01-01 +1 month' +%F` |`2024-02-01`,status0 |status1; relative months not implemented |

Hex/infinite sleep values, arbitrary GNU natural-language dates, POSIX TZ rule
strings, localized calendar formatting and decorated percent literals are also
outside the documented subset. No full GNU-date or all-platform parity claim.
No measured nanosecond precision is invented: wall clock supplies milliseconds;
explicit input fractions and available VFS metadata are distinguished.

## Cleanup, reproduction and verifier focus

Both snapshots and their dependencies/native tools/fixture trees are removed.
Every outer child is bounded to120 seconds/8MiB with PID/birth-aware cleanup;
native subprocesses have3-second/1MiB bounds. The long-timer cancellation probe
uses an exact owned child that exits promptly after abort; no broad process kill
or uncooperative-host preemption claim. `cleanup.json` records no survivors.
Preliminary owned `/tmp/time-env-*.tap` files were moved into history and removed.

Reproduce with a fresh label:
`node tests/commands/time-env/verify.mjs d904ca9 NEW-LABEL`.
This uses committed source and refuses evidence overwrite. Native tools remain
explicit external prerequisites; without them the canonical native parent is a
skip, not a pass, while the deterministic150 tests remain runnable. The frozen
runner requires those binaries/archive rather than silently skipping them.

Different-verifier priorities: public package wiring after root integration;
options and edge-date holdouts without changing documented scope; negative
epochs, leap boundaries, offsets/DST and precision; own-key/env snapshots and
no ambient leakage; scheduler early wake/chunk/abort races; actual pipeline
budgets, cleanup and mtime error preservation. Do not count the four retained
profile/scope differences as passes or treat trusted-host hooks as a sandbox.

Commits: `df780f6` coherent implementations/tests/docs; `d904ca9` endpoint
source+regressions; this handoff/raw evidence is a separate test-only commit.
No broader performance, superiority, backend or full-product closure follows.
