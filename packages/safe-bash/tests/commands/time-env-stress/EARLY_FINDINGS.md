# Independent time-env findings — August27,2026

Production is read-only. Exact source `d904ca986fa945df8aef6e11b4165e2c2a63f814`;
unchanged author223/223 and author types/build pass. These findings precede any
source fix or oracle rewrite. Compiled leaf execution uses the isolated build,
not moving shell cleanup work or a source fallback.

## Six advertised date-format mismatches

Run the explicit leaf date command with `-d@1704164645.123456789`, virtual UTC,
and one format operand below. The oracle is actual GNU coreutils9.7 on Darwin,
C locale, separately hashed executable. All native and product exits are0,
stderr empty; expected output includes final LF. Spaces are significant.

| Format | GNU expected before LF | Product actual before LF |
| --- | --- | --- |
| `%12F` | `002024-01-02` | `  2024-01-02` |
| `%#c` | `Tue Jan  2 03:04:05 2024` | `TUE JAN  2 03:04:05 2024` |
| `%-z` | `+0` | `+0000` |
| `%_z` | `   +0` | `+0000` |
| `%_12z` | ten spaces then `+0` | seven spaces then `+0000` |
| `%^P` | `am` | `AM` |

These exercise advertised width/padding/case flags, not excluded GNU input
grammar or ICU zone labels. The first capture preserves full hex bytes, native
arguments/environment and assertion failures. Format families need author fixes
and independent replay; these are not necessarily six independent root causes.

## Two sleep summation counterexamples

An injected monotonic asynchronous scheduler observes the first requested delay:

- `sleep 0.0009999999 0.0000000001`: exact total0.001 seconds, expected1ms;
  product schedules2ms.
- `sleep 0.0004999999 0.0005000001`: same exact total/expected and actual2ms.

The source rounds each operand upward to nanoseconds before summing, crossing a
millisecond boundary that the exact sum does not cross. This is over-waiting and
an advertised decimal-sum precision issue, **not an early-wake safety defect**.
Native wall-clock scheduling jitter is not used as a1ms oracle; the mathematical
sum and injected timer request are deterministic. No real long sleep is run.

## Reviewer setup/profile differences, not those product bugs

The first independent registry check ran before asynchronous plugin setup had
completed and saw0 rather than60. The next capture awaits a harmless `:` exec
before reading the same actual registry. No expected name/count changes.
Two reviewer TypeScript errors came from synchronous sinks where ByteSink.write
requires Promise<void>; making those sinks async fixes only the harness type.
The first full inputs/results and nonzero compiler output remain preserved.

The second capture then exposed a separate stale author narrative: actual frozen
`d904ca9` registers65 names, not60. The author's own retained built-consumer stdout
also says65. Source inspection confirms expand/unexpand/fold/rev/split are already
composed at that exact revision. The final check uses an explicit literal65-name
set, still requiring date/sleep/printenv to be absent; it does not derive the
expected names from the implementation or treat this as a runtime fix. The earlier
0-vs60 and65-vs60 failures remain in their separate unchanged captures.

Apple `/usr/bin/printenv EMPTY UNICODE` outputs only the first value, unlike the
selected GNU multi-operand profile. Both native/product outputs remain measured
as a separate Apple profile disagreement, not another GNU-target product bug.
Declared DST folds, hex sleep and broader grammar are not blanket parity claims.

The initial actual Shell sleep abort probe clears its timer in the signal
handler before exec/dispose settles and leaves no abort listeners. It does not
reproduce the pending-worker outer-race defect; repeated/sibling controls follow.
The root's regex cleanup/first-read work is outside this source review.
