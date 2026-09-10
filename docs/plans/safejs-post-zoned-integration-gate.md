# Post-ZonedDateTime integration gate

The maintained command `npm test --workspace=@poe-code/safe-js` started in
session 63746 (7d33be). This gate includes public ZonedDateTime integration,
locale formatting, and Duration private ZonedDateTime relativeTo admission.
The process terminated with exit code 1 (ba9a26). Final results:

- 26,915 passed, 15 failed, 41 skipped; 26,971 tests total.
- 1,129 files passed, five failed, two skipped; 1,136 files total.
- Duration: 1,730.39 seconds; all 100 filesystem type contracts passed.
- The post-run fingerprint (e6cfb7) matches the early-run fingerprint below.

This is a failing gate, not completed integration or JavaScript conformance.
No Temporal-named test failed in this run; that does not prove full Temporal
behavior, upstream coverage or Node 18 portability.

## Failure disposition

The terminal report lists two native Promise own-property import failures,
ten 5-second timeouts, and three dependent assertions seeing undefined instead
of an expected completed setup result. No timeout has been repaired yet.

- cli-entrypoint.test.ts: first direct source entrypoint help import timed out.
- run.completed-replay.test.ts: 128-draw replay timed out again.
- input-error-projection.test.ts: four proof cases, one completed replay, and
  raw public-input qualification timed out. Three subsequent completed-replay
  cases failed because completedProof.status was unavailable.
- promise-import-properties.test.ts: missing own string descriptor and user
  symbol value; the isolation-policy question remains unresolved.
- regex-cursor.independent.test.ts: the empty-pattern multiline match and
  multiline ^a. replacement cases timed out.

The previous PPR2 co timeout did not recur; this is not proof of a repair.
The unchanged focused rerun of all five failing files finished (897397):
1,065 passed and two failed across 1,067 tests; only the Promise property-import
expectations failed. This does not replace the full-gate failures or establish
a timeout repair. Subsequent CLI import-path work is recorded separately in
[the help startup repair](safejs-cli-help-lazy-runtime.md).

## Independent locale corpus

Read-only source-runtime run 24195 completed (30067c): all 16 original fixtures
in test/intl402/Temporal/ZonedDateTime/prototype/toLocaleString passed in both
script modes, 32 passes, zero failures, zero exclusions. Revision:
`419d3e0a2273ba01a3bfcbec423f2801425b8e93`. Original sta.js/assert.js and declared
includes were loaded unchanged; metadata controlled strict modes and explicit
async/module/raw/negative exclusions (none applied). Each run had to return
ok:true and the appended completion sentinel. This checks this directory on
Node 22.23.2, not all Temporal semantics or Node 18 fixed-offset portability.
The source and tests were not edited while either verification run executed.

## Package source fingerprint

Early-run fingerprint (313f8b), collected during pretest before unit execution:

- Node: v22.23.2.
- 1,528 files: every regular file recursively under packages/safe-js/src,
  packages/safe-js/test and packages/safe-js/scripts, plus the workspace
  package.json, tsconfig.json and root package-lock.json.
- Sort paths lexicographically; feed each path, NUL, file bytes, NUL into SHA-256.
- SHA-256: `2fdd79d4a7c49d345ad3a977df2e34e51b266904d2df7d904e7dbef50532472b`.

Implementation/test sources stayed unchanged during this run; documentation-only
updates do not enter this fingerprint. The terminal recheck matched. A match
does not turn a failing gate into a pass or cover dependencies outside its scope.
Output is captured through the live process tool, not a separately saved log.

The previous full gate failed with two native Promise property-import expectations
and two test timeouts. The Promise policy remains unresolved: arbitrary host
symbol imports can expose private async-hook state. Do not broaden that boundary
merely to satisfy the tests. Recheck every new failure against this worktree.

## Completed upstream difference baseline

Session 63958 terminated successfully as a runner (2b0707), with test failures:

- until: 99 fixtures, 196 passed, two failed, no exclusions (37f386).
- since: 101 fixtures, 200 passed, two failed, no exclusions (2b0707).

Both modes ran at revision 419d3e0a2273ba01a3bfcbec423f2801425b8e93. In each
directory the two failures were calendar-temporal-object.js encountering the
absent PlainMonthDay constructor. A fresh source read of both fixtures (8f457f)
confirms that they call checkToTemporalCalendarFastPath to exercise owned
calendar-bearing Temporal values. Implement and qualify the missing date types,
then rerun these fixtures without editing their helper or counting them as skips.

This baseline loaded code before the equal-epoch zone fix; it cannot qualify
the current source wholesale. No upstream process remains live for this run.

This is local verification only. No push, release or issue closure is authorized
by starting or completing the gate. The release hold remains in effect.
