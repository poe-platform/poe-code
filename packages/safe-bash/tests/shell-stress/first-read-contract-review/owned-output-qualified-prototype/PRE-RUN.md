# Frozen author cohort Q1

Four logical controls only; Q01 has eight deterministic curl profiles and Q02 has twelve focused precedence parameters. Original/current/S1/native Q01 records are separate eight-record cohorts, not32 new cases or universal parity. Q03 and Q04 are one logical control each. Acceptance is frozen before execution; failed observations stay raw. No independent review bodies were read.

## Q01 Curl profiles

Common: loopback GET, deterministic body `required-body\n`, fixed Date and X-Qualified headers; stdout/stderr bytes/status and file/header effects captured. Actual request-start precedes a barrier; closed downstream closes input before releasing server response. No upstream-demand condition. Positive profiles drain. Product nested curl return, parent/stage signal and independent stderr/file effects are separately recorded. Native Bash captures pipeline status and PIPESTATUS in the same expansion; helper/children/server sockets settle.

| ID | Options/effect | Mode | Expected product profile |
| --- | --- | --- | --- |
| C01 | `-o body -D headers -w 'W:%{http_code}\n'` | drain/default | status0; exact files and W:200; positive writeout |
| C02 | same | closed/default | pipeline0; preserve captured baseline nested status; files/stderr complete |
| C03 | same | closed/pipefail | preserve captured baseline pipefail status; files/stderr complete |
| C04 | `-D headers -w 'W:%{http_code}\n'` | closed/default | pipeline0; preserve baseline nested status; headers/stderr complete |
| C05 | same | closed/pipefail | preserve baseline pipefail status; headers/stderr complete |
| C06 | `-o body -D headers` (no writeout) | closed/pipefail | status0; no stdout work needed; exact files/stderr |
| C07 | `-o body -D headers -w 'W:%{http_code}\n'` | genuine writeout error/default, no pipe | product23 with exact existing diagnostic, not silent success; required files complete |
| C08 | `-o body` where body is directory, `-D headers -w 'W:%{http_code}\n'` | drain/pipefail | product23; positive writeout after transfer failure; exact existing diagnostic |

Native C07 uses closed stdout descriptor (EBADF) rather than fabricated EIO; product uses a sink that throws the exact EIO object without consumerClosed abort. These are separately labeled genuine-output-error profiles, NOT errno parity. Native status may differ; native behavior never changes product requirements. Native only statuses/effects are observations unless explicitly shared (positive C01, no-writeout C06, genuine-file C08). Product write attempts may be zero after known closure but a positive C01 witness and exact requested-writeout status/error controls are mandatory. Baseline attempt-based stage cancellation may differ from S1 operation-local closure; record rather than declare universal equivalence.

## Q02 Precedence parameters

Run actual Shell/registry with existing invocation hook and explicit failure-preserving owned-code close pattern. Each cleanup runs once and settles; local throw identity and signal snapshots retained separately from public result. A controlled cleanup gate permits caller abort before public settlement. Native AbortController only; no synthetic reasonundefined signal.

1. execution Error then caller0, cleanup Error: public exact0, local original Error.
2. caller Error then local IO Error, cleanup Error: public caller Error, local IO Error.
3. execution Error then default `abort()`: public actual default reason, local Error.
4. normal close then caller0 before handler return: public0, operation signal remains live.
5. execution0 plus cleanup Error: public0, local0.
6. executionundefined plus cleanup Error: publicundefined, localundefined (failed boolean).
7. execution Error plus cleanup0: public original Error.
8. successful execution plus cleanup0: public0 rejection.
9. successful execution plus cleanupundefined: publicundefined rejection.
10. successful execution plus cleanup Error: public cleanup Error.
11. successful execution, successful close: status0, live local signal.
12. executionundefined then `abort(undefined)`, cleanup0: public actual native default reason (not literalundefined), localundefined.

The first execution-selected rejection is authoritative only when actually selected by existing runtime; controls gate local error before close. No opaque late handler is awaited to discover a hypothetical primary.

## Q03 Explicit children

Child close leaves parent/sibling open. Parent close synchronously rejects new children/acquisition, closes remaining child admission and awaits controlled cooperative releases. Overlapping close shares promise; cleanup exactly once; normal signals remain live. No opaque acquisition claim.

## Q04 Borrowed owner

Actual Shell plugin opts into operation output and reads borrowed stdin next-only. On deliberate operation consumer closure, it closes cooperatively without returning borrowed iterator; independent sibling output and stderr/file effects finish; parent stage remains live until ordinary owner finalization. Explicit fixture finalization returns the borrowed owner once. Ordinary cancellation may discard bytes; no cursor conservation requirement.

## Separate historical replays

Unchanged S1 author streaming/reused-buffer controls and old57+9, original5 and optin5, if replayed, remain separately denominated. They do not add Q cases, fix old outcomes or establish new all-original closure. No source fix just to match native output. Maximum two coherent TEMP source rounds if a genuine scoped bug is established.
