# Independent classification before amended execution

The completed unchanged candidate review is `actual-frozen-02`: source81/84,
moved81/84, no skipped bodies. Failures are exactly P39, P58, S26 in each layout.
Both original API type matchers fail TS2305 vs actual TS2724; their specific
authorized diagnostic v2 and positive inversions pass. Original records remain.

1. **P39 fixture input error.** Frozen reference says `existing local cursor
   restoration`, not inherited function positional arguments. Both accepted464
   and candidate D01 produce `?\nb\n`, status0; the actual getopts observer sees
   outer["-ab"], function[], restored outer["-ab"]. Runtime1428 explicitly
   replaces positional parameters with function invocation args. P39-v2 adds
   only `work "$@"`; original stdout/stderr/status expectations are unchanged.
   Original no-args P39 remains failed; it is not an arithmetic cursor defect.
2. **P58 unsupported prerequisite, not nounset acceptance.** Its frozen
   reference is `existing engine unset-name zero, not shell parameter expansion`
   and familyL02 status. Both baseline and candidate D02 execute only `set`,
   return2 and the exact unsupported-option diagnostic; LET is never admitted.
   Original `set -u; let absent` stays unsupported/failed. New separately named
   U01 tests only default `let absent` status1 and empty output. No `-u` semantics
   are removed from or claimed for the old case; no nounset implementation.
3. **S26 executor overassertion.** Frozen procedure requires tracked cleanup
   drainage, not unconditional fulfillment. Original executable expects return
   and fails first on baseline-compatible colon. Independent D03 records colon
   on464 and colon/LET on candidate: exact Error `Invocation is closed`, one
   cleanup, root pending until release, cleanup-done before child/root settlement,
   root0/empty output. `cleanup.ts:39–43` seals descendants; `:45–57` drains
   callbacks. V2 asserts this exact boundary/counter/event sequence and no
   unhandled rejection, rather than accepting arbitrary nonzero or arbitrary
   errors. Raw child rejection is not promoted to child success.

The 167 unchanged adjacent regressions independently pass on the same265-input
candidate. Seven admission negatives reject. Six of seven original code controls
are killed; M3 **survives** and stays a recorded failed review control.
`prepareArithmetic` returns ordinary syntax errors in `.error` instead of
throwing (`arithmetic.ts:22–26`), so the first M3 only did redundant preparation.
M3-v2 actually rejects that recorded later-argument syntax error before earlier
evaluation; P21 remains byte-identical and must detect lost earlier writes.
No source corrections, native reruns, changed Budget or runtime policy.
