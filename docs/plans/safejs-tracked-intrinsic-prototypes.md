# Track owned intrinsic prototype tables

## Evidence

The final shared-scope regression again timed out in the first unchanged camera
case (5,022 ms). The CI release had already failed all three cases at 5,000 ms.
Do not raise limits, reduce fixtures, or count a retry as a performance fix.

The earlier CPU profile attributed substantial time to intrinsic retained-root
capture. A fresh built-runtime diagnostic created builtin bindings, captured
budget roots once, then counted Reflect.ownKeys visits on a second unchanged
capture. Among the repeated descriptor scans:

- Date.prototype: 48 keys
- Array.prototype: 41
- String.prototype: 38
- DataView.prototype: 27
- RegExp.prototype: 19
- Iterator.prototype: 15
- Reflect: 14
- Map.prototype: 13; Set.prototype: 12
- ArrayBuffer.prototype: 10
- DisposableStack and AsyncDisposableStack prototypes: nine each
- JSON: five; other error/generator/iterator prototypes also rescanned

Math and numeric typed-array prototypes already use createIntrinsicObject and
did not appear. That factory copies the initial backing table, tracks native
define/delete mutations, and enables the existing revision-aware capture path.
The proposed change is to use that existing mechanism for runtime-owned plain
intrinsic tables, not add another descriptor cache or bypass budget accounting.

## Validation

Add a failing scan-count test for unchanged intrinsic tables; verify that native
and guest writes, symbols, accessors, deletions, prototype changes and subsequent
nested mutations still affect retained data correctly. Avoid tracking caller-
owned raw tables whose aliases can bypass mutation hooks. Do not wrap branded
boxed objects or arrays as ordinary records: those require separate analysis.

Compare complete camera traces and budgets with native behavior; benchmark wall
and process CPU time only after the concurrent full suite completes. Keep each
completed accounting/performance improvement in its own commit and push. This
plan is evidence and proposed work; no prototype implementation has been made.

Implementation iteration: stopped only the known-failing final suite (PID 16846,
session 67682, verified exit 130) before changing any source. Its earlier camera
timeout remains a failure, not a completed full regression. Added 34 failing
descriptor-scan tests, then changed owned plain intrinsic table construction to
use createIntrinsicObject. All 34 now pass, as do the 12 existing capture and
retention tests. Branded boxed and Array prototypes were not converted.

Fresh pre-change camera benchmark after stopping other tests: wall times
1854/1909/1839/1917 ms; process CPU 1695/1597/1511/1506 ms. All complete native
trace assertions passed at original budgets. Build and lint are now running;
compare the candidate only once they finish. No performance claim or commit yet.

The first build exposed widened JSON method types; method registration now
preserves the known closure type. The corrected maintained build passed 23
workspaces and four fresh imports, and all changed/new TypeScript lint passed.

Candidate camera batch one: wall 1808/1762/1670/1713 ms, CPU
1525/1442/1318/1322 ms. Batch two: wall 1795/1526/1610/1611 ms, CPU
1515/1385/1307/1312 ms. Every original native trace and JSON fixture assertion
passed. Compared with the same-session baseline, this is a repeatable roughly
10–13% process-CPU reduction, not proof that the CI timeout is resolved.

Focused final check passed 61 tests in five files, including all three original
camera cases. Node 18 built-runtime checks also pass: writes on Date, JSON, Map
and Promise survive evaluation and two independent JSON snapshot restores.
`git diff --check` passes, and the unrelated staged Safe-Bash patch remains
unchanged. Full frozen regression is active in session 56275, log
`/var/folders/rw/s4cy76hn6v55qrp0dhcbtplc0000gn/T/safejs-tracked-intrinsics.txoXOEv2Gu`.

Final regression completed successfully: 20,207 passed, 37 skipped, 680 passing
files and one skipped file in 416.74 seconds. Camera cases passed at
4053/3761/2942 ms. Agent-harness also passed 163 tests in 13 files. Source stayed
frozen for the full run. This establishes local delivery checks, not a successful
CI release; monitor the separate pushes through publication.
