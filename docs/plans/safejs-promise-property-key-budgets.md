# Promise property-name allocation limits

The isolated public probe `src/run.promise-property-key-budgets.test.ts`
reproduces two failures (c46898), report
`/tmp/safejs-promise-property-key-budget-probe.json`: a Promise key of length
129 is accepted under stringLength 128 both during initial import and completed
replay. Both length-128 controls pass. Ordinary-object imports correctly reject
129 and accept 128. The source returns a constant, so property access is not
required to expose this admission inconsistency.

Native Promise property copying defines names without calling allocateString,
unlike ordinary host record copying. Replay descriptor reconstruction also
needs investigation for property-name validation. Preserve all at-limit cases
and descriptor flags; do not truncate names or increase limits. Reproduce on
main before integration. Keep the probe isolated while main's full package
qualification runs against the host-data/alias feature.

Expanded TDD has four failures and six controls passing (e0013b): ordinary
record keys also bypass the replay limit, while direct host-bridge Promise
conversion independently bypasses it before replay preparation. The shared
descriptor decoder validates property values but not string keys. The isolated
repair now validates those keys through its existing string decoder and uses
allocateString for native/re-copied host Promise string names. A five-file
key-budget/replay/rollback/alias selection is running, report
`/tmp/safejs-property-key-budget-candidate-green.json`. Main full package
session 40305 remains unchanged; all 100 filesystem contracts passed before
its unit tests started.

All 46 tests in the five-file candidate selection pass (90df5e). This result
covers initial/public and direct host-bridge keys, ordinary and Promise replay
keys, existing replay data, property rollback, and aliasing. It does not yet
cover direct compilation-owned deepCopyToSandbox admission or all exotic
descriptor representations; review those before calling key-limit coverage
complete. Main's full gate remains live and has emitted failure markers; do
not infer their cause before terminal attribution.

The compilation-owned direct-copy control independently failed at key length
129 with eleven other controls passing (4b93ec). Its native Promise descriptor
copy now validates each name through the compilation owner's budget before
definition. Main remains unchanged. The separate collection descriptor format
already decodes its keys through `restorePropertyDescriptors`; no change to
that path is justified by the code audit alone. A refreshed seven-file
selection is running with report `/tmp/safejs-property-key-budget-all-paths.json`,
followed by scoped lint and TypeScript for the three runtime files and test.

The seven-file selection passed all 68 tests (ec7431), including the new
direct-copy boundary. Candidate lint/TypeScript is session 25183; its result
is not yet available. Main full package qualification is still session 40305.

The additional eight-file decoder compatibility selection passed all 120
tests (5d4b27), report `/tmp/safejs-property-key-decoder-compatibility.json`.
It covers Date/RegExp properties, collection descriptors, mapped arguments,
Temporal date/duration snapshots, typed-array iterator replay and the twelve
key-budget controls. Candidate lint/TypeScript 25183 remains live. The current
main runtime has not changed during full gate 40305.

Candidate scoped lint and TypeScript passed (65fb4b). Reviewed runtime diff
against main is only three property-name budget checks and shared replay-key
validation; no unrelated candidate feature remains in the diff. An isolated
diagnostic imports main source by absolute path to reproduce the twelve-case
baseline without editing the tree under full gate 40305. Its report target is
`/tmp/safejs-property-keys-current-main-baseline.json`; the diagnostic itself
must not be copied into main as a permanent absolute-path test.

The current-main diagnostic reproduced all five failures with seven passing
controls (87b2ec), report `/tmp/safejs-property-keys-current-main-baseline.json`.
This provides independent main TDD evidence without disturbing the full gate.
The relative-import twelve-case regression and reviewed three-file runtime
patch are ready to integrate when session 40305 is terminal; focused main
checks and maintained build remain required after that integration.

Final path review added direct imported-Promise rebinding controls at lengths
128 and 129. The current-main absolute-import comparison now has six failures
and eight passing controls; the same fourteen relative-import cases all pass
the isolated candidate (91792, terminal 4e94c6). The new failure independently
validates the existing check in the re-copy branch rather than assuming it is
covered by native-Promise import. Report:
`/tmp/safejs-property-key-rebinding-comparison.json`. The runtime patch did not
change; the permanent regression now contains fourteen cases. Main remains
fixed under session 40305.

Scoped eslint for the expanded fourteen-case regression passed (81518,
terminal a67b87). The unchanged three-file runtime patch retains its earlier
lint/TypeScript qualification; main integration checks are still outstanding.

Main full gate 40305 ended (d69463): 28,846 passed, thirteen failed, 47 skipped;
failures are twelve locale cases and the user-symbol Promise import case.
The runtime was unchanged throughout; later commits changed documentation only.
The reviewed three-file patch and fourteen-case relative regression are now
integrated into main. Focused main tests run as 36460, report
`/tmp/safejs-property-key-main-integration.json`; scoped lint followed by the
maintained workspace build closure runs as 13854. No camera or symbol candidate
was copied, and unrelated staged files remain outside this change.

Main's six-file integration selection passed all 48 tests (b3cfeb), and the
eight-file decoder compatibility selection passed all 122 tests (44dbe3),
report `/tmp/safejs-property-key-main-decoder.json`. Scoped eslint passed before
the maintained build began; build session 13854 is still running. These are
focused qualification results, not a new full-package gate or remote delivery.

The maintained build completed successfully (13854, terminal 33a0d2): all
23 selected dependency builds and five fresh-process import checks passed.
The property-key repair is locally qualified for its atomic commit. No push
or release is authorized while the release hold remains in force.
