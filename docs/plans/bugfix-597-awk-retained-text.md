# Issue #597: bounded retained awk text

## Validated baseline

Baseline: `4b98f235760e98adaff331d17847cb09ab2c0487`, September 4, 2026.
Investigation is memory-only; the audit's large RSS/heap figures are not adopted.

- With `maxBufferBytes: 8`, scalar assignment of nine bytes fails, while an array
  value, ENVIRON value, ARGV value and function scalar parameter each accept nine
  bytes. Concatenation already rejects the same oversized produced value.
- Four separate twelve-byte input records remain in four array cells with a
  per-buffer limit of sixteen: 48 retained value bytes, status zero.
- Three getline readers with a sixteen-byte per-buffer cap retain fourteen unread
  bytes each: 42 total. A separate sixty-four-byte fixture retains 62 bytes in
  each reader, 186 total. Main input can coexist with named readers.
- Closing one reader and consuming another's suffix release their logical bytes;
  EOF does not reopen a cursor, explicit close/reopen does. RS changes preserve
  unread bytes. Existing getline/awk controls passed 27 cases.
- Fresh function-local arrays leave the old entry counter elevated after their
  frames retire. Passed array parameters alias the same underlying array.
- A rejecting iterator return leaves the old reader buffer uncleared. Existing
  Promise.all cleanup can settle before another cooperative close completes, and
  a close rejection can mask a primary execution failure. These witnesses retain
  test references and do not establish a post-GC production leak.

Initial probe references are retained in the worker transcript: array/runtime
chunks `567006`, `85ac9b`, `836212`; malformed probe `476fc3` never executed and is
not product evidence. No committed evidence, heap snapshot or user-staged files
were modified by investigation.

## Selected policy

Use an independent fixed 32 MiB invocation budget for retained mutable text.
Keep `maxBufferBytes` per-value/per-reader; do not reinterpret it as aggregate or
add a public option just for tests. Count each scalar/record/field slot, each
array's keys and text values once despite array aliases, retained cursor/target
names, and owned reader-block capacity. See the authoritative accepted extension
in `src/contracts/awk-retention.md`.

Use incremental admission, not whole-state scans on each assignment. Reject
before owned retention/copy/publication, preserve old state on refused replacement,
release overwritten/deleted/retired state, and compact retained byte-string
storage where needed rather than relying on source-slice backing lifetime.
Reader blocks retain unread bytes and exact offsets; release only storage no
longer needed. Never discard suffixes or reopen streams as a memory shortcut.

Cleanup releases accounting even when a producer's return rejects. Await all
cooperative closes; preserve cancellation, then an existing execution failure,
then the first cleanup failure. Falsey reasons require explicit presence tests.
No arbitrary-host preemption, total RSS, object-overhead or temporary-expression
allocation guarantee is introduced.

## Ownership and gates

- Runtime owner: retained-text primitive, awk runtime/state/command wiring,
  focused retention tests, and exact literal integration-test registrations.
- Reader owner: byte-block reader and focused reader tests; coordinate the shared
  primitive API with the runtime owner. Do not concurrently edit the runtime.
- Root: contract/plan, independent review coordination, integration/public gates,
  exact-path commits, push verification, issue closure and release monitoring.

Use low-limit primitive/runtime tests for exact boundaries and lifecycle failure
paths, plus actual Shell/registry/factory coverage for the fixed public policy.
Tests must remain fast and memory-only. Preserve unrelated text-command/helper
staging and historical fixtures. Run scoped/adjacent tests first, then maintained
build, current public consumers and guarded lint on stable inputs. Do not overlap
root build with guarded lint: the prior issue proved directory-metadata drift
can invalidate that parallel run.

## Delivery

Implementation and validation are pending. Close #597 only after verified
remote-main delivery, then monitor releases while continuing the issue queue.

## Implementation evidence so far

- Initial six runtime/public regressions failed on the unchanged implementation,
  then passed with the first incremental state-accounting implementation.
- Three additional regressions are RED for retained input names, output names
  and joining all cooperative reader closes. Those integration routes remain
  under implementation; six green cases are not full acceptance.
- Reader TDD started at four failures and two passes against a copied baseline.
  The block reader now passes 16 focused tests using the real retention primitive,
  plus 27 existing awk/getline controls. The existing controls do not yet prove
  the new reader is wired into the runtime.
- Bounded reader comparisons matched the original behavior for 600 inputs and
  4,651 record/EOF observations. Independent review added 500 cases and 4,000
  reads, including separator changes, NUL and invalid UTF-8 bytes. These are
  bounded semantic checks, not RSS or throughput measurements.
- Independent accounting review found no defect in the implemented subset:
  nine live-state observations matched ledger bytes and entry counts; 40-byte
  refusal controls preserved the prior 31-byte state; four falsey allocation
  failures retained their identity and charge. Full cleanup/name integration
  was explicitly outside that partial sign-off.
- Upstream through `070c762bde2bda8dd46da28d23d14873fc1326f2` was integrated while
  workers were frozen. Existing runtime/command/reader bytes survived unchanged.
  User staging remains three files, 33 insertions and three deletions; its
  delimiter encoding edit was preserved at the declaration moved by upstream.
  Recovery stash `bf15d6ce1074bf872e7d9eb8fcd60821c090daa8` remains retained.

Current release gates must run against the completed integrated candidate, not
be inferred from the earlier #599 checks or these partial results.

### Terminal normal-exit review finding

The second review reproduced a cleanup dependency stall after reader integration:
`{ getline a < "/named"; exit }` with eight-byte sources left only the main
return started and 35 bytes charged when that return waited for named return
to start. A real event-loop turn established that the invocation remained
unsettled; manually releasing the main return allowed named cleanup and zero
remaining charges. Replacing `exit` with division by zero initiated both returns
and preserved the original error. This is a bounded cooperative-close ordering
witness, not an opaque-producer preemption claim.

The fix must release terminal main storage before `END` while keeping named
cursors usable through `END`, observe early close rejections, then join terminal
returns without serial waiting. The checked-in stall regression failed before
the repair, then passed alongside named-cursor continuity and released main-block
accounting through `END`. The final candidate starts terminal main close before
`END`, observes its rejection immediately, and retains it for joined cleanup.

### Frozen candidate checks

- 46/46 focused cases: 30 runtime/ledger cases and 16 reader cases.
- 165/165 combined cases, including maintained text-program and allocation
  admission controls. An earlier adjacent run had 155 passes and one failure:
  final cleanup unnecessarily cleared a now-unowned array whose preserved failed
  split state was asserted by an existing test. Final binding retirement now
  releases accounting without erasing that array; the assertion is unchanged.
- Both new tests are registered literally. Two discovery/type-accounting
  controls passed, reporting 570 active TypeScript tests; this is discovery
  evidence, not a full unit or TypeScript compiler pass.
- A failing-return fixture that accidentally reached natural EOF was corrected
  to early exit; that fixture issue is not recorded as a production defect.

Root validation of the frozen candidate:

- Normal `npm run build` passed, including workspace graph and root suffix
  stages (`/tmp/poe-597-build.log`). No-declared-build is not counted as a pass.
- Independent four-file rerun passed 165/165, no skipped/cancelled cases
  (`/tmp/poe-597-focused.log`).
- Maintained current consumers passed: historical build-first consumer, three
  source groups, 26 current public groups and three expected negative controls
  (`/tmp/poe-597-consumers.log`, `/tmp/poe-597-consumers-report/report.json`).
  This is compiler evidence, not runtime/service acceptance.
- Rebuilt `virtual-bash` and `poe-code/safe-bash` public imports both passed
  per-value refusal, fixed aggregate refusal through Shell, and a successful
  subsequent invocation (`/tmp/poe-597-public-smoke.log`).
- Exact two-test registration diff and `git diff --check` passed.

Final independent review passed five bounded cleanup probes: terminal return
dependency, `END` cursor/accounting observations (31 and 28 bytes), observed early
falsey rejection, execution/cancellation priority, and final retirement without
erasing externally held array cells. Source hashes stayed unchanged. Cancellation
can still detach an opaque backing iterator's pending return through existing
`readBytes`; joined Reader-close promises do not imply universal producer draining.

`npm run lint` passed: all 9,683 configured files checked with zero errors or
warnings, followed by root type and workflow lint (`/tmp/poe-597-lint.log`).
No full repository unit run, RSS benchmark or visual CLI change is claimed.
The source stays frozen for exact-path commit and verified main delivery.
