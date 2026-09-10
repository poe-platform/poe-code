# Post-ZonedDateTime integration gate

The maintained command `npm test --workspace=@poe-code/safe-js` started in
session 63746 (7d33be). This gate includes public ZonedDateTime integration,
locale formatting, and Duration private ZonedDateTime relativeTo admission.
The process is live; there are no final test counts yet.

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
