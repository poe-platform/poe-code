# Bash CI shards

## September 2, 2026 scope

Detached worktree `/tmp/poe-bash-ci-shards-20260902`, base `fff9f7875`.
Own only Bash runner files/tests and this plan. Primary, root scripts/workflows,
Git delivery, production code, held files and captured receipts remain untouched.

Root owns a fresh build/packed-smoke job and same-SHA build-artifact distribution.
Each of four separate Bash CI runners still invokes native
`npm run test:unit --workspace=virtual-bash`, including unchanged test:runner hooks.
The release job depends on every verification job and runs fresh prepack. Root
owns cache configuration and actual cold/warm full-build/release timing evidence.

## Opt-in protocol

- `SAFE_BASH_TEST_SHARD`: absent or exactly `1/4`, `2/4`, `3/4`, `4/4`.
- `SAFE_BASH_TEST_CONCURRENCY`: absent (one), `1`, or `2`. Alone it selects the
  entire discovered cohort; with a shard it applies only to that shard.
- Only test.mjs's executable entrypoint reads these flags. Imported runTests calls
  retain their original default; child env copies omit these two scheduling flags.
- Unset flags preserve the existing uncached serial command, explicit CLI override
  forwarding, reporter and native hook behavior. No production/source/compiler cache.
- Opt-in mode permits name/skip selectors and reporters, but rejects positional
  file additions, native sharding/concurrency/isolation overrides, force-exit and
  reporter destinations that would overwrite output between phases.

Membership always comes from unchanged loadBoundaries/discoverTests. Historical
files.csv workerMs weights only schedule members; obsolete profile entries do not
execute and unweighted new files receive a conservative 5000 ms estimate. Sort
longest-first with pathname ties, assign the lightest shard with index ties, then
run stable pathname order. All four shards union discovery exactly once.

Within each shard, reviewed pure entries run in Node's isolated file processes
with concurrency at most two, followed only after process exit by all other files
at concurrency one. A reviewed group smaller than two stays in the single serial
phase, avoiding an extra runner process without possible parallel work.
Unknown/changed entries and changed test helpers default to
serial. Native/source-bound/shared-path fixtures are not eligible. Review hashes
are routing fingerprints, not execution/compilation caches or replacement source
authentication. Existing product and historical guards remain in their real tests.

The five reviewed entries are contracts command/value/io, memory-only shell value
state, and fixed-input date formatting with its MemoryFS helper. No broad directory
allowlist. Contract IO uses local byte pipes, explicit AbortControllers and an
event-loop turn; its existing two-second test bounds remain unchanged. It has no
native processes, real filesystem, network, shared paths or source guard. The
other entries use local immutable carriers/registries, value arenas, or MemoryFS
with fixed date/timezone inputs. Fingerprints cover all five test files and the
date helper. Production imports are not cached or replaced by these fingerprints.

The initial four-entry review produced four singleton groups, hence no actual
parallel work. A failing static qualification caught that limitation. Adding the
narrowly reviewed IO suite, without changing balancing, produces this current plan:

| Shard | Discovered files | Phases | Historical estimate (ms) |
| --- | ---: | --- | ---: |
| 1/4 | 127 | 127 serial | 126559 |
| 2/4 | 138 | 138 serial | 126558 |
| 3/4 | 139 | 139 serial | 126555 |
| 4/4 | 139 | contracts/io + contracts/value at concurrency 2; then 137 serial | 126557 |

These are dated observations, not membership constants. All 543 discovered files
occur exactly once. The estimates use old worker durations, not current wall
time or promised CI savings. Unknown files still enter the plan automatically.

## Qualification

TDD covers flags, deterministic balance, duplicates/missing weights/new files,
dynamic current-discovery union, unchanged exclusions, conservative routing,
empty shards, selectors, child env, spawn errors and failure/termination stopping
later phases. Tests extend existing integration-inputs.test.mjs registration;
native test:unit/test:runner scripts are unchanged.

Evidence directory: `/tmp/poe-bash-ci-shards-20260902-results`.

- Initial scheduler red: `red.tap`; initial 11 focused controls passed.
- Singleton phase red: `singleton-red.tap`; corrected test expectation retains
  canonical sorted discovery order. Intermediate failing logs are retained.
- Full native runner under `SAFE_BASH_TEST_SHARD=1/4` and
  `SAFE_BASH_TEST_CONCURRENCY=2`: 241/241, no skips or cancellations;
  `native-test-runner-final.log`. This includes existing default serial argv,
  explicit CLI override, exit/signal/error forwarding, native script contract,
  build-runner and reporter checks, not just newly added shard controls.
  The literal `npm run test:runner --workspace=virtual-bash` invocation also
  passed 241/241 with both CI flags and the final five-suite metadata;
  `npm-test-runner-ci-env-final.log` preserves the command expansion and result.
- Real fixture processes rendezvous before either is released, proving two live
  distinct workers. All prior worker PIDs must have retired before each serial
  admission and after completion. Controlled failures in parallel and serial
  phases propagate; a failed parallel phase prevents the serial phase.
  Fixtures are supplied by an in-memory module loader over existing entry paths;
  no test writes files. These JS scheduling controls replace tsx only in their
  injected spawn adapter. Original-suite qualification uses real tsx unchanged.
- Five in-memory mutations are rejected: missing discovered member, accepting
  changed review bytes, parallel risky phase, swallowed failure, and serialized
  safe workers (the real rendezvous cannot complete). See `mutations.json` and
  the five `mutation-*.tap` logs. No production bytes are edited for mutations.
- Original five suites: 153/153 identical file-qualified passing observations
  in serial and concurrent runs; source/helper hashes unchanged. Name selection
  and skip selection also match. The name-filter receipt contains one selected
  case plus four empty-file success records, not five selected assertions.
  Skip-filter receipts contain 143 passing cases. See
  `final-equivalence-and-membership.json` and `final-*-serial/parallel.json`.
- `scoped-types-five-final.log`: zero checkJs diagnostics in both owned runner
  modules; zero strict TypeScript diagnostics for the five reviewed TS roots and
  their transitive dependencies using package compiler options. This is scoped
  qualification, not a claim of running the full consumer typecheck gate.
- The actual current four-shard plan has the nonempty two-worker phase above;
  exact union and synthetic new-file/duplicate/missing-weight controls pass.

## Integration and final CI qualification

Apply only the six-file patch; merge integration-inputs.test.mjs hunks with other
engineers' registration changes rather than replacing their file. The handoff
manifest records the full detached base, original/current SHA-256 values, bytes
and final newlines. Primary and all existing historical receipts remain untouched.

From the fresh same-SHA build checkout on each separate runner, use:

```sh
SAFE_BASH_TEST_SHARD=1/4 SAFE_BASH_TEST_CONCURRENCY=2 npm run test:unit --workspace=virtual-bash
```

Repeat with 2/4, 3/4 and 4/4 on the other CI runners, not as simultaneous local
benchmarks. No root test/runner hooks are disabled. For the environment-specific
runner prerequisite alone, use the same flags with `npm run test:runner
--workspace=virtual-bash`. Compare discovery membership receipts across all four
jobs. A shard must fail on any child failure; no retries or forced-success exits.

Full four-shard execution, Linux CI behavior, and full build/release cold/warm
measurements remain final GitHub qualification owned by root. Focused local checks
co-loaded with root activity and establish correctness, not isolated speedups.
No local full Bash rerun, root lint, source/compiler cache, timeout weakening,
workflow edit, commit or push is part of this sidecar.
