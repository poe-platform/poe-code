# Contract test cohort

## Scope and acceptance

September 1, 2026: this follow-on delegation owns only
`packages/safe-bash/tests/contracts/**` and this document in
`/tmp/poe-test-speed-push-20260901`. Expression is settled and is not edited.
No production, frozen-checkout, Git, concurrency, or outside-scope changes.

Inspect all sixteen direct contract entries. Keep `value.test.ts` at its
explicitly required discovery path. Conservatively retain `io.stress.test.ts`
as a standalone process because its stalled-input/cleanup fixtures deliberately
never settle; no reset wrapper or speculative cleanup rewrite is allowed.

The remaining fourteen files are a candidate core-contract cohort: command
ownership/middleware, filesystem signatures/metadata, byte IO, path/errors,
invocation cleanup/provenance, and public export wiring. Rename only proven-safe
files to byte-identical `.cases.ts` modules with one static-import entry.
This changes per-file process isolation to per-family process isolation only.

## Validation plan

1. Inspect imports, hooks, mutable state, native launchers, boundaries and
   maintained/historical path consumers without rewriting historical evidence.
2. Establish exact per-file counts/names, serial baselines, and an intentional
   pre-change assertion failure with byte-exact restoration.
3. Verify normal descriptor/resource cleanup at every test boundary and after
   the family, with repeated and reversed imports and live negative controls.
4. Rename safe modules, compare counterbalanced serial old/new layouts using
   identical renamed paths/bytes, and require a measured gain.
5. Check failure attribution, full sixteen-file coverage, byte preservation and
   discovery membership; remove every temporary probe and document the result.

## Initial audit

All sixteen entries pass independently: 213 tests with 213 unique names.
The fourteen selected files contain 128 unique cases; the two retained entries
contain 41 IO-stress and 44 value cases. No global hooks or native-process
launchers occur in the selected entries. `command.test.ts` temporarily replaces
`Array.prototype.push` synchronously in try/catch/finally; this restoration must
be proven at case boundaries. Remaining module-level data is read-only in use.

Authenticated discovery selects all sixteen paths. A bounded scan of 588 active
test/script/configuration paths finds the explicit `tests/contracts/value.test.ts`
assertion in `scripts/integration-inputs.test.mjs` and no other contract entry
path references. No authenticated boundary names the contracts directory.
This is bounded current-consumer evidence, not exhaustive dynamic/historical
consumer clearance. Historical records remain unchanged.

## Decision and measured gain

Keep the fourteen-file core-contract cohort. Six counterbalanced observations
per layout have median wall times of **4.538s isolated** and
**0.620s combined**: **86.34% less wall time**, **7.32x faster**,
and 3.918s saved per 128-case cohort run. These are local cohort
measurements, not a whole-workspace, build or release speed claim.

The family contains **128 distinct named cases**, unchanged from its fourteen
source files. The complete contracts directory retains **213 distinct cases**,
with all 41 IO-stress cases and 44 value cases still running separately.
Authenticated discovery changes from sixteen test entries to three:
contracts.test.ts, io.stress.test.ts and value.test.ts.

This explicitly changes **per-file process isolation to per-family process
isolation** for fourteen files only: fourteen isolated child processes become
one. The two retained entries keep their existing process isolation. No test
concurrency flag, runner, discovery exclusion or global isolation policy changes;
--test-isolation=none is never used.

## Exact path changes

The following paths are relative to
`packages/safe-bash/tests/contracts/`. Each hash applies to both original and
renamed source bytes. Bodies, assertions, names, helpers, type controls,
fixtures, timeouts and source line numbers are byte-identical.

| Original path | Final path | Cases | SHA-256 of both |
| --- | --- | ---: | --- |
| `command.test.ts` | `command.cases.ts` | 54 | `be7956b1a0720e39bd3473e641b4ef2be37f1168da1aea47353a858fc9b79d63` |
| `command.stress.test.ts` | `command.stress.cases.ts` | 12 | `bfcba501ecccbc4f523d234aa4f7cc7d02b662f7e96d2497e718b097d6965b6e` |
| `errors.test.ts` | `errors.cases.ts` | 6 | `1d58135ef8b9bd61fc0d46931b7aad71314a9de1fb7701d634256a4f321c09cb` |
| `exports.test.ts` | `exports.cases.ts` | 1 | `b94a040cef2a8839e18d29dcb366447cb0740c670b52cc9741e8e6fc3954bd92` |
| `filesystem-allocation.test.ts` | `filesystem-allocation.cases.ts` | 3 | `95b5931bd1319be8efdc8eaddb40324cd1ff7a292144cfe28c1a8ab892d9b766` |
| `filesystem-comparison.test.ts` | `filesystem-comparison.cases.ts` | 2 | `33da6395e847a4992275bffba4193385f8a9a32aed4a05dfe5e7345498bd1790` |
| `filesystem-identity.test.ts` | `filesystem-identity.cases.ts` | 4 | `0654e47dc1447cce2f1c929d139cdd22ee641f3410a5bca3799f29f110607b31` |
| `filesystem.test.ts` | `filesystem.cases.ts` | 4 | `4f04a46834281a3d0b2e05de3824e653c923ee754015e80eacf222aeb7822c92` |
| `invocation-cleanup.test.ts` | `invocation-cleanup.cases.ts` | 4 | `6fd7328d89b47a3b1277f92b90b053ed0953bbb930daaa75106520aed3c60339` |
| `invoke.test.ts` | `invoke.cases.ts` | 7 | `6facf9e46d60454963ad1d474a9f75d3e1afc27949b6d372615ba8eeda9ab883` |
| `io.test.ts` | `io.cases.ts` | 14 | `0be30d243f4df7688f57fc2bdc5b7b914c3fae62203f8e5613595d4153e7f0ec` |
| `path-error.stress.test.ts` | `path-error.stress.cases.ts` | 6 | `2d80b2df8087b45d989ef59ef1c9a32585b5047a55ff2c718925bfd7959d69e5` |
| `path.test.ts` | `path.cases.ts` | 4 | `588b77f881872d1e766ae8fe8cde8c9b81c1e28f782639bd84ef6efaf122e45b` |
| `stdin-provenance.test.ts` | `stdin-provenance.cases.ts` | 7 | `d31c16212694b5a843777be0a9bd901266697c2293eb70969a10057f6554ece1` |

New entry: `packages/safe-bash/tests/contracts/contracts.test.ts` contains only
fourteen static imports in the table order. The only other permanent write is
`docs/plans/contract-test-cohort.md`. No permanent hooks, wrappers, framework,
state-reset helper, or added case is introduced.

The unchanged retained files are:

- io.stress.test.ts: 41 cases;
  `de0d76cc3a5a4cc5694ca4921cb35576877ac77f5f8bb5287e589e3ac1c43373`.
- value.test.ts: 44 cases;
  `6c5ffdcc2eb01b344a292beacdbb85d864d2a11cc1f949e587b6af47e6be5d9f`.

## Grouping and safety findings

The selected files exercise the core contract layer: owned argv, registration,
middleware, invocation options, cleanup/provenance, byte IO, path/error rules,
filesystem signatures/metadata and their public export wiring. They use fresh
per-case contexts, registries, signals, sinks and memory filesystems. Public
Shell smoke cases dispose their own instances. No native process, network,
real-filesystem fixture, global test hook or module-level Worker replacement is
introduced or used by the selected test bodies.

The shared module-level command definition and legacy stat records are
read-only in use. Each moved file remains a separate ESM module, so local tables,
helpers and bindings do not become one shared scope. Module-level types and
compile-time contract controls are retained exactly, without claiming that
runtime passing tests replace a typecheck.

command.test.ts has one important exception to the otherwise mock-free tests:
it temporarily assigns Array.prototype.push while synchronously testing a join
allocation refusal. That replacement is enclosed in try/catch/finally, with no
await, and its original value is restored before assertions. Complete descriptor
and identity checks before subsequent cases and after the family confirm the
normal finally restoration; no compensating reset is added.

value.test.ts remains standalone because the maintained integration discovery
test explicitly requires its literal path. io.stress.test.ts remains standalone
conservatively: one fixture intentionally returns promises from next and return
that never settle, to verify cancellation without waiting for opaque cleanup.
That is legitimate coverage, not a bug repaired here, but this cohort does not
claim it is safe to broaden that test's sharing or equate an empty host-resource
list with complete settlement of every opaque promise. All its cases remain in
the full denominator.

## Active and historical consumers

The current literal scan covers 588 active test entries, immediate package
scripts and package/boundary/tsconfig declarations. It finds only the explicit
value.test.ts requirement in scripts/integration-inputs.test.mjs. That path is
preserved. The maintained test:contracts script uses the contracts .test.ts glob,
which continues to select all cases through the new entry plus retained files.

Authenticated boundaries do not name this directory. The three authenticated
captured-types.json, staged-types.json and inventory.json metadata inputs read
through readTypecheckInventories contain no tests/contracts/ references. This
checks admitted metadata, not arbitrary historical payloads. No historical
records, selectors, sealed captures, ownership metadata or outside-scope
consumers are rewritten. The bounded checks are not exhaustive dynamic-import
or universal historical-consumer clearance.

## Baselines and nonqualifying observations

All sixteen files first pass independently, establishing 213 unique case names.
The first attempted fourteen-entry combined baseline is incomplete: the required
poe-code/safe-fs export target packages/safe-js/dist/safe-fs.js becomes unavailable
in the live worktree. Node reports 25 nodes: fifteen actual passing cases plus
ten entry-load failures. This is not a 128-case run and is not performance or
coverage acceptance. No dependency or production file is edited to bypass it.
The artifact becomes available again; all qualification baselines restart cleanly.

Three clean original-path serial baselines pass the same 128 names. A complete
original-path run passes all 213. Before any move, changing the join scratch
assertion from expected zero pushes to one causes exactly one failure, 127
passes and exit 1, attributed to command.test.ts:349:10. Its original bytes are
restored before consolidation.

A preliminary renamed old/new timing comparison discovers an ordering detail:
Node sorts explicit entry paths, so command.cases.ts precedes
command.stress.cases.ts, whereas the original .test.ts spelling sorted the stress
file first. All preliminary runs still pass 128 unique cases. The family entry's
two imports are reordered to match the renamed old layout. The twelve qualified
counterbalanced runs restart from the beginning; preliminary timings do not
enter the median. Thus old and new qualified runs have identical ordered names,
not just equal totals, while original pre-rename module order is not claimed
unchanged.

The retained positive baseline/control observations are:

| Sweep | Cases | Wall ms | Node duration ms |
| --- | ---: | ---: | ---: |
| contracts-old-clean-1 | 128 | 6588.523 | 6546.925 |
| contracts-old-clean-2 | 128 | 5804.650 | 5759.844 |
| contracts-old-clean-3 | 128 | 6238.231 | 6189.360 |
| contracts-full-original | 213 | 7906.615 | 7840.092 |
| contracts-before-repeat-1 | 256 | 1008.053 | 968.884 |
| contracts-before-reverse-1 | 128 | 760.097 | 718.656 |
| contracts-before-repeat-2 | 256 | 820.825 | 779.555 |
| contracts-before-reverse-2 | 128 | 800.211 | 757.377 |
| contracts-new-initial-1 | 128 | 899.669 | 840.046 |
| contracts-new-initial-2 | 128 | 745.123 | 704.597 |
| contracts-new-initial-3 | 128 | 820.526 | 775.779 |
| contracts-balanced-1-new | 128 | 789.287 | 731.535 |
| contracts-balanced-2-old | 128 | 5351.758 | 5305.272 |
| contracts-final-repeat-1 | 256 | 812.779 | 772.983 |
| contracts-final-reverse-1 | 128 | 643.737 | 603.349 |
| contracts-final-repeat-2 | 256 | 754.021 | 714.786 |
| contracts-final-reverse-2 | 128 | 668.886 | 628.614 |
| contracts-full-final-1 | 213 | 1508.454 | 1467.178 |
| contracts-full-final-2 | 213 | 1416.862 | 1372.652 |

All rows in that table have exit 0, every case passing, zero failures,
cancellations, skips, TODOs and stderr. The incomplete artifact run is described
separately. Baseline/control/full-suite wall times are incidental unless included
in the qualified table below.

## Qualified serial measurements

All final timing runs use Node v22.22.2 and package-local tsx 4.23.12 on Darwin
arm64, September 1, 2026, in the live authorized worktree. The parent measures
child startup through exit using performance.now(); TAP duration_ms is separate,
not a sum of per-test durations. There is no cache clearing or cohost-load
control. The original missing-artifact attempt and the module-order pilot are
excluded explicitly, not silently discarded as slow observations.

Old timing passes the fourteen renamed .cases.ts paths explicitly as isolated
Node entries. New timing passes only contracts.test.ts, which imports those
same paths and bytes. Both use the unchanged serial --test-concurrency=1
setting. Order is new, old, old, new, repeated three times, with no overlapping
timed child runs. All twelve qualified sweeps pass exactly the same ordered
128-name array, with exit 0 and no failures/cancellations/skips/TODOs/stderr.

| Qualified sweep | Wall ms | Node duration ms |
| --- | ---: | ---: |
| contracts-qualified-balanced-1-new | 744.173 | 706.471 |
| contracts-qualified-balanced-2-old | 4568.249 | 4527.068 |
| contracts-qualified-balanced-3-old | 4400.087 | 4364.902 |
| contracts-qualified-balanced-4-new | 655.081 | 618.320 |
| contracts-qualified-balanced-5-new | 620.998 | 582.027 |
| contracts-qualified-balanced-6-old | 4958.259 | 4915.365 |
| contracts-qualified-balanced-7-old | 4419.290 | 4380.462 |
| contracts-qualified-balanced-8-new | 525.610 | 490.354 |
| contracts-qualified-balanced-9-new | 517.127 | 483.437 |
| contracts-qualified-balanced-10-old | 4508.562 | 4458.193 |
| contracts-qualified-balanced-11-old | 5520.589 | 5479.033 |
| contracts-qualified-balanced-12-new | 618.833 | 580.648 |

## Repetition, state and negative controls

Temporary validation-only imports snapshot full own property descriptors of
Array, Object, TextEncoder, Uint8Array, CommandRegistry, MemoryFileSystem, Shell
and FsError prototypes, plus environment, cwd, builtin Worker identity and
referenced MessagePort/Timeout resource lists. beforeEach checks the boundary
after the prior test's ordinary cleanup; the after-family hook covers the final
case. Checks run immediately and again after one setImmediate turn. Every
checked name is matched against decoded TAP names using lossless encoded
metadata, rather than accepting only the count.

The probes do not repair state or reset mocks. They also confirm that a private
file written in one newly created memory filesystem is ENOENT in a second one.
All accepted state runs observe empty measured resource lists before and after,
with unchanged descriptors and environment.

- Before moves, two same-process repeat runs pass 256 cases each and two reversed
  module-order runs pass 128 cases each, in the original module ordering profile.
- After moves and final ordering alignment, two repeat runs again pass 256 cases
  each and two reverse runs pass 128 cases each. Exact repeated and reversed
  name arrays match the final profile, with all per-test/family checks passing.
- An intentional Array-prototype property leak and a separate referenced 500ms
  timer leak are each detected at the next test and after the family: three
  reported nodes, one pass, two expected failures, exit 1. Neither leaks into
  the parent process; the timer expires naturally.
- Each of fourteen renamed modules gets one temporary assert.fail before the
  first statement of a single top-level named test. No fixture is acquired
  before that injected failure. The complete family still runs, reports the
  original 128 names with 127 passes and exactly one failure, and passes all
  state-boundary checks. The failure stack names the actual .cases.ts file, not
  merely contracts.test.ts. The injection is restored immediately using unique
  contextual patches and full-buffer comparison.
- The join scratch assertion is separately changed from zero to one in the
  renamed command.cases.ts. It fails only that case at :349:10; all 128 boundary
  checks remain clean, demonstrating Array.prototype.push restoration on the
  exercised refusal path. No injected assertion or probe remains afterward.

| Renamed failure source and line | Original case name | Pass / fail |
| --- | --- | --- |
| `command.cases.ts:30` | owned command arguments snapshot values and distinguish equal text projections | 127 / 1 |
| `command.stress.cases.ts:14` | late next calls cannot dispatch commands after middleware has returned | 127 / 1 |
| `errors.cases.ts:7` | FsError exposes standard errno metadata and cause | 127 / 1 |
| `exports.cases.ts:13` | root exports expose committed shell, filesystem, command, and SafeJS APIs | 127 / 1 |
| `filesystem-allocation.cases.ts:14` | allocatedBytes is an optional readonly number on the existing FileStat | 127 / 1 |
| `filesystem-comparison.cases.ts:11` | comparison is additive with an exact async three-valued signature | 127 / 1 |
| `filesystem-identity.cases.ts:14` | FileStat identity scope is optional and opaque, preserving legacy structural compatibility | 127 / 1 |
| `filesystem.cases.ts:10` | rmdir is an additive optional signal-only filesystem method | 127 / 1 |
| `invocation-cleanup.cases.ts:12` | cleanup registration is an additive optional readonly callback with no public drain handle | 127 / 1 |
| `invoke.cases.ts:10` | shared invocation options carry exact owned arguments without changing legacy calls | 127 / 1 |
| `io.cases.ts:10` | byte sources preserve binary bytes and UTF-8 text | 127 / 1 |
| `path-error.stress.cases.ts:9` | relative paths are resolved in virtual root rather than leaking the host cwd | 127 / 1 |
| `path.cases.ts:9` | normalization uses virtual absolute POSIX paths, not the host cwd | 127 / 1 |
| `stdin-provenance.cases.ts:64` | supplied empty and exhausted streams retain nondefault provenance | 127 / 1 |

An empty referenced-resource list is not proof of all possible retained objects,
native resources or arbitrary-concurrency safety. Deliberately unresolved
IO-stress fixtures are specifically not admitted on the strength of this check.

## Final full coverage and cleanup

All six temporary files are removed with apply_patch:
cohort-state.probe.ts, cohort-forward.probe.ts, cohort-repeat.probe.ts,
cohort-reverse.probe.ts, cohort-descriptor-leak.probe.ts and
cohort-resource-leak.probe.ts. Final directory inspection finds no probe files.
All sixteen original file bodies match their intended final paths byte-for-byte.

After removal, authenticated discovery selects contracts.test.ts,
io.stress.test.ts and value.test.ts. Two complete final runs each pass
**213/213 unique cases**, with the exact original name multiset, no cancellations,
skips or TODOs, exit 0 and empty stderr. Fourteen source modules still contribute
128 cases; the retained files still contribute 41 and 44.

Name fingerprints are SHA-256 over JSON.stringify of TAP-name arrays; sorted
comparisons use JavaScript's default string ordering and retain every name:

- Original selected 128-name order:
  `fcebf0cd80e21dc1369c69c92a71713e3de79d0d6869054978eceb8cba8a7173`.
- Final selected and qualified isolated 128-name order:
  `52fe588d8209afd0b8da28e07f6d26b619c35389fe413158b3777e60688a710c`.
- Final repeat 256-name order:
  `91eb9649a96d4e1e1d9c6b047213554314c752e4d109fcb44bebc09fc3aecdb0`.
- Final reverse 128-name order:
  `9c60b706dd00c9de021d3aed688c621232ca2d5f8055af5f11755458c7059fd8`.
- Complete original and final sorted 213 unique names:
  `cfff4fde73382207d7d7c0a7189bf3364ccb0215cc573ed29a3d8d415f90f3f0`.

## Reproduction and handoff

From packages/safe-bash, run the final cohort with:

```sh
node --import tsx --test --test-concurrency=1 --test-reporter=tap \
  tests/contracts/contracts.test.ts
```

For the isolated comparison, replace that entry with the fourteen .cases.ts
paths in the inventory, passed as explicit arguments to the same command. Never
pass both those files and the family entry together. For complete contract
coverage, select literal contracts paths from discoverTests/loadBoundaries in
scripts/integration-inputs.mjs and pass the resulting three entries.

No production, helper, package config, concurrency, raw ESLint, Git, frozen
checkout or settled expression file is modified. No visual CLI behavior changes;
no screenshot or broad lint/build/typecheck gate is claimed. Root owns staging,
commit, hooks, integration/typechecking/build, push and release qualification.

## All preserved unique case names

The first fourteen sections are the final family order; the last two are the
retained standalone files. Together they contain all 213 original unique names.

### command.test.ts (54)

```text
owned command arguments snapshot values and distinguish equal text projections
owned command argument derivation shares immutable values without byte round trips
owned command arguments require exact argv identity and reject forged carriers
owned command argument allocations precede snapshot reads and commit exact carrier
owned command argument admission preserves denial before reads: false
owned command argument admission preserves denial before reads: 0
owned command argument admission preserves denial before reads: undefined
owned command argument failed projection releases its reservation
owned command arguments pass through middleware with independent byte copies
owned command reconstruction and joining preserve the original allocation authority
owned command arguments preserve falsey commit and release failures in order
owned command create rejects grow during reservation
owned command create rejects shrink during reservation
owned command select rejects grow during reservation
owned command select rejects shrink during reservation
owned command withValues rejects grow during reservation
owned command withValues rejects shrink during reservation
owned command withValues snapshots every operand before nested byte reservations
owned command selection does not reread indices during carrier commit
owned command create checks lifetime before caller length: Error: closed allocation
owned command create checks lifetime before caller length: false
owned command create checks lifetime before caller length: 0
owned command create checks lifetime before caller length: undefined
owned command select checks lifetime before caller length: Error: closed allocation
owned command select checks lifetime before caller length: false
owned command select checks lifetime before caller length: 0
owned command select checks lifetime before caller length: undefined
owned command withValues checks lifetime before caller length: Error: closed allocation
owned command withValues checks lifetime before caller length: false
owned command withValues checks lifetime before caller length: 0
owned command withValues checks lifetime before caller length: undefined
owned command failed reconstruction releases only new reservations: Error: second byte allocation denied
owned command failed reconstruction releases only new reservations: false
owned command failed reconstruction releases only new reservations: 0
owned command failed reconstruction releases only new reservations: undefined
owned command rollback attempts nested then metadata cleanup and preserves falsey failures
owned command rollback does not release a failed primitive reservation twice
owned command join admits parts scratch before populating it
owned command join releases temporary charges on both text success and byte denial
owned command captures caller replacement after metadata admission
owned command join keeps a borrowed single value and releases its scratch
owned command join rolls back new output when final scratch release fails
owned command join freezes scratch before commit can replace
owned command join freezes scratch before commit can truncate
registry supports explicit registration, lookup, replacement, and removal
registry snapshots definitions and does not expose its backing collection
registry rejects empty, NUL, whitespace, and path-based names
exit statuses follow the 0 through 255 shell range
middleware nests in registration order and shares command state
middleware can short-circuit without invoking a command
middleware rejects repeated next calls
middleware errors propagate and cancellation prevents dispatch
middleware dispatch state is independent for concurrent invocations
plugin contract supports async setup, middleware, and filesystem factories
```

### command.stress.test.ts (12)

```text
late next calls cannot dispatch commands after middleware has returned
concurrent repeated next attempts execute the terminal only once
middleware cancellation between layers prevents terminal execution
reentrant invocation has its own dispatch cursor
middleware stacks are snapshotted and invalid runtime handlers fail loudly
registries accept class-based command definitions without dropping prototype methods
registry rejects non-string names from JavaScript callers
prototype-like names remain ordinary map keys and failed registration preserves existing entries
middleware cannot finish while detached next work is still running
middleware failure drains started downstream work and preserves the original error
middleware may intentionally recover from an awaited downstream error
ignored downstream rejection is supervised rather than left unhandled
```

### errors.test.ts (6)

```text
FsError exposes standard errno metadata and cause
error guards reject inherited keys and arbitrary objects
native errno errors normalize without losing source metadata
normalization preserves FsError identity and explicitly overrides native paths
unknown failures use EIO and retain the original cause
errno values use Node system-error numbers and normalize the EOPNOTSUPP alias
```

### exports.test.ts (1)

```text
root exports expose committed shell, filesystem, command, and SafeJS APIs
```

### filesystem-allocation.test.ts (3)

```text
allocatedBytes is an optional readonly number on the existing FileStat
legacy stats and filesystem stat implementations need no allocation metadata
known zero and known allocation are distinct from absent unknown metadata
```

### filesystem-comparison.test.ts (2)

```text
comparison is additive with an exact async three-valued signature
comparison forwarding retains paths, peer and signal without serialization
```

### filesystem-identity.test.ts (4)

```text
FileStat identity scope is optional and opaque, preserving legacy structural compatibility
stat forwarding preserves object scope by reference without coercion
symbol descriptions are not identity while the native convention shares a token
partial identity metadata remains representable and is not a complete proof
```

### filesystem.test.ts (4)

```text
rmdir is an additive optional signal-only filesystem method
adding rmdir does not change the required rm contract
snapshot rmdir is an explicit optional readonly boolean disclosure
snapshot disclosure preserves boolean extensions and optional method compatibility
```

### invocation-cleanup.test.ts (4)

```text
cleanup registration is an additive optional readonly callback with no public drain handle
cleanup callback type accepts synchronous void and asynchronous Promise<void>
cleanup negative type controls exclude values, required arguments and nonvoid results
registration does not change nested invoke options or invocation result types
```

### invoke.test.ts (7)

```text
shared invocation options carry exact owned arguments without changing legacy calls
direct invocation snapshots legacy argv before asynchronous dispatch
shared invocation types structurally match the existing shell hook
replacement options are additive and preserve omitted, false and empty forms
legacy actual-shell invoke merge remains compatible: false
legacy actual-shell invoke merge remains compatible: undefined
registered commands use optional invoke directly without shell-specific casts
```

### io.test.ts (14)

```text
byte sources preserve binary bytes and UTF-8 text
byte sources snapshot Uint8Array and Buffer inputs at creation
collectors enforce explicit byte limits and close overflowing sources
collectors copy reused buffers and decode UTF-8 split across chunks
collectors reject pre-aborted operations
pipes stream while the producer runs and apply byte-based backpressure
pipe writes take ownership through byte copies, including Buffer inputs
pipe cancellation rejects blocked producers and readers
breaking consumption produces EPIPE for pending writers
returning an unread pipe releases blocked producers
closed and pre-aborted pipes reject further writes
pipe watermarks must be positive finite safe integers
pipeBytes awaits sink acceptance before requesting the next chunk
writeText encodes UTF-8 and propagates sink failures
```

### path-error.stress.test.ts (6)

```text
relative paths are resolved in virtual root rather than leaking the host cwd
traversal and prefix lookalikes never pass lexical containment
normalization is idempotent across a generated traversal corpus
invalid runtime errno codes cannot manufacture NaN errno metadata
explicit error-normalization overrides work for existing FsError instances
error normalization drops wrong-shaped metadata without losing the cause
```

### path.test.ts (4)

```text
normalization uses virtual absolute POSIX paths, not the host cwd
invalid cwd and NUL bytes report EINVAL
lexical containment checks path components rather than string prefixes
POSIX helpers remain available without platform-specific separators
```

### stdin-provenance.test.ts (7)

```text
transparent delegation preserves stdin provenance true without reading
xargs replaces argument stream with implicit child default from true
transparent delegation preserves stdin provenance false without reading
xargs replaces argument stream with implicit child default from false
transparent delegation preserves stdin provenance undefined without reading
xargs replaces argument stream with implicit child default from undefined
supplied empty and exhausted streams retain nondefault provenance
```

### io.stress.test.ts (41)

```text
abort remains observable after producer close while bytes are unread
aborting a fully drained pipe does not undo successful closure
abort preserves the first failure and releases blocked writes and close
a thrown producer can fail the pipe without dangling internal rejections
concurrent pipe writes preserve invocation order and snapshot mutable chunks
an oversized individual chunk still flows through a small watermark
return and throw cancel consumers even before the first read
collectBytes cancels a stalled next and does not await uncooperative cleanup
pipeBytes aborts a stalled sink and observes late write and cleanup failures
invalid runtime byte inputs are rejected instead of coerced
hundreds of empty, closed, and abandoned pipes settle without background errors
successful and canceled stream helpers release their AbortSignal listeners
an aborted pending input can reject later without an unhandled rejection
byte limits preserve the primary error when iterator cleanup also fails
readBytes cleanup characterization: next failure, undefined
readBytes cleanup characterization: next failure, null
readBytes cleanup characterization: next failure, false
readBytes cleanup characterization: next failure, zero
readBytes cleanup characterization: next failure, empty
readBytes cleanup characterization: next failure, NaN
readBytes cleanup characterization: next failure, Error
readBytes cleanup characterization: next failure, object
readBytes cleanup characterization: external throw, undefined
readBytes cleanup characterization: external throw, null
readBytes cleanup characterization: external throw, false
readBytes cleanup characterization: external throw, zero
readBytes cleanup characterization: external throw, empty
readBytes cleanup characterization: external throw, NaN
readBytes cleanup characterization: external throw, Error
readBytes cleanup characterization: external throw, object
readBytes cleanup characterization: external return, undefined
readBytes cleanup characterization: external return, null
readBytes cleanup characterization: external return, false
readBytes cleanup characterization: external return, zero
readBytes cleanup characterization: external return, empty
readBytes cleanup characterization: external return, NaN
readBytes cleanup characterization: external return, Error
readBytes cleanup characterization: external return, object
readBytes cleanup characterization: EOF skips underlying return
readBytes cleanup characterization: late abort, primary=false
readBytes cleanup characterization: late abort, primary=true
```

### value.test.ts (44)

```text
byte values copy input and never expose their authoritative buffer
raw invalid UTF8 and genuine replacement text have distinct encodings
text values preserve lone surrogates until UTF8 serialization
mixed concatenation coalesces adjacent genuine text before encoding
mixed bytes derive one projection after concatenation
byte projection retains a UTF8 byte-order mark
empty and one-value concatenations preserve immutable identities
allocation admission precedes byte copying and projection
successful allocation commits the exact immutable value
commit failure releases reservation and preserves thrown identity
public byte materialization reserves its distinct owned copy
forged carriers and closed allocation scopes are refused
mixed concatenation encodes every adjacent text boundary like one JS string
a byte segment separates genuine text surrogate halves
allocation cleanup retains both falsey primary and cleanup failure
intrinsic view bounds defeat shadowed length, offset and buffer properties
resizing during reservation cannot expand the admitted input extent
shrinking or detaching after admission releases once without committing
concat captures post-metadata-admission values: BCDE
admitted concat snapshot isolates later payload mutation: BCDE
concat captures post-metadata-admission values: B
admitted concat snapshot isolates later payload mutation: B
concat captures post-metadata-admission values: raw
admitted concat snapshot isolates later payload mutation: raw
closed concat rejects before input iterator observation
closed concat rejects before input getter observation
denied snapshot admission never acquires remaining elements or an iterator
snapshot admission rejects grow with one release and no commit
snapshot admission rejects shrink with one release and no commit
snapshot admission rejects invalid type with one release and no commit
snapshot acquisition is bounded by admitted extent even when an element grows the source
metadata and payload commits cannot change the captured value via the source
snapshot acquisition and cleanup failures retain ordered falsey primary identity
post-admission all-string replacement releases snapshot without byte-payload admission
payload denial releases the admitted snapshot and preserves falsey failure
snapshot-release failure also releases the uncommitted payload once
mixed snapshot uses its finite numeric extent rather than a caller iterator
ordered cleanup aggregation preserves primary undefined
ordered cleanup aggregation preserves primary null
ordered cleanup aggregation preserves primary false
ordered cleanup aggregation preserves primary 0
ordered cleanup aggregation preserves primary 
ordered cleanup aggregation preserves primary [object Object]
text-only concat checks lifetime but leaves text accounting to the caller
```
