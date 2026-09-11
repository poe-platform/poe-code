# Native array index capture

Full SafeJS verification of the separate tracked-intrinsic candidate failed one
test: the existing 600,000-value spread into push timed out at 5000ms. Its other
19,669 tests passed, with 41 skips and only the two documented unresolved-gap
exclusions. CLI run 34171079444 independently failed that test and one camera
case; 36,462 other tests passed. No timeout or input size may be increased/reduced
to hide this problem.

Keep improvements atomic: saved and temporarily removed only the uncommitted
tracked-intrinsic runtime diff. Its new test and plan remain untracked, and the
candidate is available for reapplication after this independent array delivery.
Never remove the user's staged Safe Bash changes.

The isolated spread test passed at 3.53 seconds. Three built executions took
3416, 3324 and 3767ms. Complete output checks retained the 600,000 values and
validated length, first and last values. Profile:
`/tmp/safejs-camera-array.ZILQyG/spread-baseline-valid.cpuprofile`: 5776ms aggregate
self time in measurement visit, 2068ms GC and 653ms array-index key parsing.
The initial `spread-baseline.cpuprofile` probe used unsupported parse syntax and
failed before execution; it is not a valid baseline.

Two focused RED tests demonstrate 1000 index reparses and 1000 numeric captures
for a 1000-number native array. The first push-spy attempt recursed inside the
test framework; replacing it with a restored native wrapper produced the genuine
1000-versus-zero assertion failure. Do not treat that instrumentation recursion
as a runtime bug.

For native arrays, own index keys precede length, which is created before named
properties and cannot be deleted. Follow that ordering instead of reparsing every
index. Preserve the proxy fallback and all managed descriptor keys. Numeric
elements contribute no data units beyond their already charged slots, so omit
their temporary retained-value copies. Other types remain captured before any
retained callbacks. References: ECMAScript OrdinaryOwnPropertyKeys and ArrayCreate,
https://tc39.es/ecma262/multipage/ordinary-and-exotic-objects-behaviours.html#sec-ordinaryownpropertykeys
and #sec-arraycreate.

498 focused tests passed across the complete interpreter file and four array
accounting files, including the unchanged 600,000-element case. Candidate build,
timings, remaining checks and delivery are pending. No visual CLI changes.

The selected 23-workspace build and four fresh built-import checks passed. Three
built spread timings were 3596, 3326 and 2971ms (about 6% lower mean, with overlap);
this is not enough evidence to declare the timeout resolved. Camera timings were
2376, 2437, 2174 and 2305ms: no demonstrated camera gain from this change alone.
An additional 65-test selection passed, including all camera cases and data,
symbol, retained-root and record-budget controls. There are 559 distinct focused
passes across the two selections; four tests overlap. No reduced fixture or new
exclusion was used. Lint/types and delivery are pending.

Changed-file lint and TypeScript checks passed. A built Node 18.18 maximum-index
sparse-array probe also returned the exact expected charge. This focused array
improvement is ready for its own commit/push; the separate tracked-table candidate
will then be reapplied and the broader package gate rerun. User staging retains
patch ID d770ec782b2a4ae7e2580e63ded765933890a1c5.
