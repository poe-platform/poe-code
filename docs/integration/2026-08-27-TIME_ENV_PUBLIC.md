# Time/environment public integration — August 27, 2026

Root approved integration after independent source reviews c9b9626 and61c66bc
of f6406cd/c782363. Canonical test-only migration f534134 preserves the earlier
two rejected-format observations while testing the accepted expansion. Source
acceptance is qualified, not universal date compatibility or a full release gate.

## Public API and defaults

The package root and `virtual-bash/commands/time-env` export
`createTimeEnvCommands(options?: TimeEnvCommandsOptions): readonly CommandDefinition[]`
and `timeEnvCommands(options?: TimeEnvCommandsOptions): VirtualShellPlugin`, plus
`TimeEnvCommandsOptions`, `TimeEnvLimits`, and `SleepScheduler` types.
Factory order is date, sleep, printenv. `AgentCommandsOptions.timeEnv` omits the
leaf `replace` option: the aggregate's top-level replacement policy stays
authoritative. The literal65-name registry gains exactly those three names;
curl and SafeJS remain optional. No dependency is added.

Clock defaults to Date.now, timezone to UTC; invocation TZ and date -u keep their
existing precedence. The sleep scheduler uses monotonic performance.now and
cancellable timers, independently of the wall clock. Default limits are4096
arguments,65536 argument bytes,1048576 output bytes,10000 environment entries,
and4096 format width. The timer chunk maximum defaults to2147483647ms.

## Correction to the historical ISO-year rationale

The unrestricted GNU magnitude claim in the original author
`tests/commands/time-env/fraction-expansion/SEMANTICS.md` is superseded here.
That archived rationale and native inputs remain intact. The accepted `%g`
rule matches the independently verified **rendered calendar0000–9999** domain,
including year0000 January1/2 (`%G=-001`, `%g=01`). It is not an unrestricted
identity for negative Gregorian years.

Independent GNU9.7/Darwin controls preserve these counterexamples:

| Calendar date | GNU `%G\|%g\|%V\|%u` | `abs(ISOyear %100)` component |
|---|---|---|
| -0200-12-31 | `-199\|01\|01\|3` |99|
| -0100-12-31 | `-099\|01\|01\|1` |99|

See the unchanged derivation and proof-804/proof-1204 observations in
`tests/commands/time-env-stress/fraction-independent/semantics/SOURCE_PROOF.md`.
GNU's branch uses Gregorian tm_year and an ISO-year adjustment, not simply the
magnitude of the final ISO year modulo100. No parser/formatter restriction is
added by this integration. Epoch/clock conversion accepts a wider bounded
instant range; existing `TimeZone.fields` validates rendered calendar fields
before any format directive. Do not claim all out-of-domain epoch input is
rejected by parsing, or expand this evidence into a promise of negative-century
formatting. Calendar-input docs already specify0000–9999.

## Evidence boundaries

The independent review records3114 specified N directives matching GNU9.7 on
Darwin, not a universal GNU/Linux profile. Bare `%-N` preserves virtual input
precision instead of probing native clock resolution; padding lower digits of
millisecond clocks with zeros does not manufacture measured precision. Five ICU
zone-label differences remain. The semantics harness's11 expectation failures
and terminal environment assertion failure are preserved/qualified in the
independent evidence, not counted as a wholly green native harness.

Historical65-name snapshots and old rejection outcomes remain historical. New
count fixtures describe intentional registration, not a runtime bug fix.
Packed public integration requires its own frozen evidence and a different
reviewer; source approval alone is not that approval. The qualified release's
WebDAV12/13 checkpoint remains separate pending its owner's correction.

## Frozen mechanical integration checkpoint

Root wiring41298e6 and count-only migrationsba58068/2a8be2e are verified at
candidate6ffe4f4f17637e44b55cc0455394513e8d6b94de:306 scoped source tests,
18 packed public checks twice, two adjacent public consumers, production build/
typecheck and strict public declarations pass, with six negative type controls
and three missing-runtime/source-access denials. This is integration-author
evidence awaiting a different reviewer, not source self-approval or a full gate.
See `tests/plugins/time-env-public/README.md` for exact scope, hashes, preserved
failed harness attempts and the unchanged qualified-release command.

A separate read-only release preflight found20 unclassified .mts paths, already
present at pre-integrationf534134 (176 tracked/156 inventoried). The unchanged
fail-closed inventory assertion blocks the qualified command before service
execution. Exact paths/hashes are recorded in the public integration evidence;
classification and current consumer coverage remain a release-owner follow-up,
not an excuse to disable the inventory guard or count historical inputs as passes.
