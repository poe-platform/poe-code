# GeoJSON user edge validation

Authenticated installed csvjson.py SHA-256
cbfe8f90a73d234ddb332b25bf288922cd960b250ea1847b474a05a3554273c5
matches the released 2.2.0 source recorded in the frozen CPython 3.14.2 profile.
Reference subprocesses were used only for capture, never by product code or
canonical tests. Captures use the original minimal C/UTC/non-TTY environment.

The initial 15 inferred bbox cases produced twelve failing regressions. Some
failed in shared table inference before reaching GeoJSON. Those original
observations are preserved separately and remain unqualified where blocked.
Recapturing with -I isolated ten bbox failures before implementation. The
21-case no-inference cohort now passes exact stdout/stderr/status assertions.
Bounds preserve lazy initialization, null latitude reset, string code-point
ordering, mixed scalar comparison TypeErrors, boolean identity, arbitrary integer
precision, and third/fourth dimension behavior. First container latitudes remain
accepted as in the source; list-to-list comparisons remain explicit blockers.

A different agent captured nine original stream/property observations and added
in-memory stress coverage for falsey IDs/properties, excluded columns, partial
stream failures, caller cancellation and consumer cancellation. Existing input
ownership, backpressure and cooperative cleanup tests remain active. Safe-bash
also replays all 21 new bbox observations while asserting unchanged VFS contents.

Verified maintained uncached checks: csvkit workspace tests (2085 passed,
one skipped, six TODOs), workspace lint and production/test TypeScript checks,
selected safe-bash workspace build closure, focused csvjson/csvkit safe-bash
tests (44 passed), default normal-runner discovery assertion and scoped stress ESLint.
Skips/TODOs and inferred blockers are not counted as compatibility passes.

Actual built Shell output was rendered with the maintained terminal-png renderer
and visually inspected for indented null bounds, string bounds and the native
later-null comparison diagnostic/status. Owned temporary capture, logs and image
were purged after use. No README edits, staging, commits, pushes or releases.
Finite cohorts do not establish exhaustive edge-case or full csvkit parity.
