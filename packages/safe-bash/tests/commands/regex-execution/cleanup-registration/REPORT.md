# Regex cleanup registration source handoff

August 27, 2026. Registration-only Phase A; **not public cleanup/default
acceptance**. Approved contract `07acb1a4d30b7592cf247a0220250317be4e2038`.
Independent baseline `a6a1a44` marker was read before source edits. Author failing
controls were explicitly committed first at `293add9`: **8/25 pass, 17 fail**,
25 controlled transports retired exactly once, zero remaining listeners.

## Patch and ownership

Only grep.ts, search/rg.ts, regex-execution/client.ts and its local README change
product code/documentation. No runtime, shell, FS, contracts, root barrels,
manifest, dialect, policy, worker/matching/protocol or dependency edits.

Both commands use internal `withRegexSession`: synchronously register the
approved callback before executor.open, close empty admission permanently, reject
late acquisition, and share a memoized cleanup promise with local finally. The
registered callback closes only regex ownership, without awaiting opaque
stdin/FS/sink/generator work. Utility error-to-status behavior stays inside the
cleanup boundary, so a completed status cannot conceal cleanup failure. Caller
abort wins by identity; otherwise an established execution rejection wins.

RegexSession combines caller and private close signals. Closing synchronously
rejects subsequent requests, cancels its own active/queued work, awaits owned
retirement and releases its handle once. Sibling requests remain usable; no
per-invocation executor.dispose. All retirement promises settle even when one
fails. Request failure stays primary for that request, while its retirement
failure remains observable through cleanup. Repeated/concurrent close calls await
the same promise. The baseline already memoized close; this is preserved, not
falsely claimed as a new closed-boolean fix.

Public API remains optional `CommandContext.registerCleanup(cleanup): void`,
`InvocationCleanup = () => void | Promise<void>`. No new public exports. Existing
configuration/defaults remain ACTIVE and UNACCEPTED: request1000ms/startup3000ms,
maxWorkers2, queue64/128MiB, idle100ms. Construction/registration/preabort creates
no Worker. All six new pathological probes UNUSED; allocation0, old12 archived.

## Evidence

| Cohort | Actual result |
| --- | --- |
| Frozen original25 author controls, before → after | 8/25 → 25/25 |
| Final author cohort, including four supplemental controls | **29/29** |
| Final controlled transports | 23, exactly one retirement each, zero active/listeners |
| Final scoped source/types | pass |
| Immutable-contract closure + owned overlay build/types | pass/pass |
| Original safe executor/command/glob/messageerror tests + original25 | **99/100**, one retained failure |
| Compiled public ordinary controls | **35/35**, 12 native Workers, zero safety termination |
| Physically moved npm public ordinary controls | **35/35**, 12 native Workers, zero safety termination |
| Packed declaration consumer and package resolution | pass/pass |
| Packed historical grep/rg early-EOF lifecycle assertions | **3/7**, four required cleanup assertions FAIL |
| Packed lifecycle final exact retirement | 2 native Workers exit once, zero safety termination |

The sole 99/100 failure is the unchanged historical `idle messageerror retires
promptly, holds capacity and close awaits cleanup` test at
`tests/commands/regex-execution/followup/messageerror.test.ts:123`: it closes a
session with a queued request, then expects that closed session to acquire a
second Worker and finish the queued request. New approved cleanup instead cancels
that invocation-owned queued request; actual workers1 versus historical expected2.
The original assertion and full failing TAP remain untouched. This is a disclosed
close-semantic incompatibility, not a passing complete regression gate; root/test
owner must review migration separately. The new queued/sibling ownership control
asserts cancellation without terminating the active sibling.

Four post-fix supplemental controls cover pending-request retirement failure,
waiting for all failing retirements, and grep/rg late pattern-input continuations
after cleanup. These are not retroactively included in the frozen25 denominator.
The original25 assertions are unchanged except fixing two empty test ByteSink
methods to return promises. Initial import-path and scoped-type harness failures
are preserved in before-controls.json/before-types.json; corrected-before-controls
is the actual pre-fix test result. No expected failure was removed/rebaselined.

`isolated-validation.json` records every input hash for a git-show closure of
approved `07acb1a` with exactly four owned overlays. Thus changing/unhanded-off
live runtime is not certified. `source-identities.json` verifies the final owned
source matches that built overlay. Final29 direct tests use current owned source;
the isolated100 suite contains the original25 controls, not the added four.
All test/build/consumer child commands have 20-second parent bounds and strict
unhandled-rejection handling. No parent timeout or forced test cleanup occurred.

`final-package-evidence.json` verifies actual npm pack/extraction/physical move,
resolution inside moved node_modules/virtual-bash, and identical hashes for all
16 worker-graph JS/declaration/map assets. Runtime dependencies remain empty.
Archive SHA256:
`3f4a93a1e40c5db7b77ac04949edf4c8abe7b66a12d3ad7e0878f693d67cad83`.
Package runner success means ordinary/type/artifact checks passed, **not** that
the separately recorded lifecycle child status1 became a pass.

## Pending integration and preserved history

No frozen Sagan runtime handoff was supplied during this author phase. Public
exec/dispose tree drains and closed-context nested dispatch admission remain that
separate owner's prerequisite. No runtime workaround, opaque promise drain or
optional-only substitute is supplied. Source edits stop at this handoff for the
different verifier; no claim of integrated closure or full completion.

The original **five** premature-public-cleanup observations remain preserved in
independent production-continuation review (`839f2d4` correction, original
`bf8b554`), alongside author continuation evidence. The current packed early-EOF
subset still fails; it is not a replay of all five. The prior **110/111** native
fixture profile failure is also preserved, not rerun or relabeled fixed. The
named-backreference acceptance/native default-rg gap is unchanged. These scoped
checks make no superiority, performance, full-gate, deployed-provider, 72-hour
duration or default-production acceptance claim.
