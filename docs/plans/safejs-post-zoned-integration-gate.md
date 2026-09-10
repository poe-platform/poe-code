# Post-ZonedDateTime integration gate

The maintained command `npm test --workspace=@poe-code/safe-js` started in
session 63746 (7d33be). This gate includes public ZonedDateTime integration,
locale formatting, and Duration private ZonedDateTime relativeTo admission.
The process is live; there are no final test counts yet.

Pretest completed all 100 filesystem type contracts (b1dadf). Unit execution
is live and has emitted failure markers (d84c78, f05914); wait for the named
terminal report before diagnosing their cause. Do not call this a green run.

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

Keep implementation/test sources unchanged during this run; documentation-only
updates do not enter this fingerprint. Recompute it after termination. A match
does not turn a failing gate into a pass or cover dependencies outside its scope.
Output is captured through the live process tool, not a separately saved log.

The previous full gate failed with two native Promise property-import expectations
and two test timeouts. The Promise policy remains unresolved: arbitrary host
symbol imports can expose private async-hook state. Do not broaden that boundary
merely to satisfy the tests. Recheck every new failure against this worktree.

Separate upstream difference baseline session 63958 is still running since after
until completed with 196 passes and two missing-PlainMonthDay failures across 99
fixtures (37f386). That baseline loaded code before the equal-epoch zone fix;
it cannot qualify the current source wholesale.

This is local verification only. No push, release or issue closure is authorized
by starting or completing the gate. The release hold remains in effect.
