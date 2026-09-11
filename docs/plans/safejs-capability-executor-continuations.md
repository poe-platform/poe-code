---
title: Promise capability executor validation
---

# Promise capability executor continuations

Next atomic improvement after aggregate delivery. Do not edit runtime files or
add collected red tests while the aggregate package verification is active.

Aggregate delivery completed as remote-main 59585fb4a; its release runs are
34166255498 (scoped) and 34166255636 (CLI), monitored independently.

Validated during aggregate development: a custom constructor such as
`function C(executor){executor(value=>{this.value=value},reason=>{
this.reason=reason})}` creates guest resolver closures that retain its activation
and arguments. Those arguments contain createPromiseCapability's native executor.
After aggregate callback state was represented, snapshot capture still rejected
that executor's `.call` host reference. Module-scoped resolver controls isolate
and pass the aggregate behavior, but do not fix this constructor-scope gap.

Current implementation retains resolve and reject in native local variables.
The executor checks whether either is non-undefined before accepting another
pair. Do not replace this with an unconditional called flag: repeated calls
with both arguments undefined leave the executor reusable. A constructor can
also expose its executor, fail capability validation, and leave the executor
reachable from caught-error guest state.

Implementation direction: explicit shared resolve/reject state and an executor
origin map, a normal guest-function factory using that state, and a snapshot
record that preserves both values and function properties. Allocate the restored
executor before decoding its resolver closures, because those closures can refer
back to the executor through constructor scope/arguments. Preserve callback
identity, later-call guards, getter/setter use, and data accounting.

Required evidence before publishing:

- Reproduce the custom-constructor closure capture failure with a real low-level
  snapshot/restore test and an unsnapshotted control.
- Escaped initialized executor still rejects reinitialization after restore.
- Escaped uninitialized executor from a failed constructor remains reusable;
  repeated undefined/undefined calls do not silently lock it.
- Executor own properties, prototype, and cyclic resolver captures survive.
- Invalid snapshot resolver fields and callable-reference handling are checked.
- Related generic Promise, subclass, aggregate, trusted replay, and CLI gates pass.

While reviewing callable-reference handling, also validate aggregate callbacks
used as property getters/setters. The generic snapshot callable allowlist needs
to recognize every newly represented callable kind; ordinary call tests alone
do not establish this.

## Implementation evidence

Three initial controls passed while fresh low-level snapshots rejected native
executor `.call` references. Explicit executor resolve/reject state, a guest
function factory, and deferred heap restoration now make all three pass. The
snapshot state permits non-callable arguments: failed constructors can expose an
executor already locked by such an argument, so callable-only validation would
reject valid guest state.

Eight executor tests now pass, covering constructor activation cycles,
initialized and uninitialized reuse rules, non-callable locked state, a self
reference, own properties/prototype/metadata, setter use, 400-character retained
data growth, and dangling snapshot references. The related seven-file Promise,
aggregate, subclass and trusted replay selection passed 137 tests. Broader
verification, CLI execution, commit and push remain pending.

Delivery checks in progress: changed-file types and scoped lint passed. The
maintained build passed 70 declared workspace builds, root suffix stages and all
four SafeJS built-import checks. The new real harness pair passed normally and
with checkpoint save/resume at /tmp/safejs-executor-replay.ytijzA/checkpoint.json;
all three PNG screenshots were opened and inspected. No agents were spawned,
so this is runner/replay validation, not model-behavior evidence. Native Node 18
also restored an uninitialized executor and preserved its later initialization
guard.

Full maintained SafeJS unit verification is active as terminal 24267. Only the
same two experimental host-Promise-property and weak-collection files are
excluded; no executor or aggregate tests are excluded. Keep runtime code fixed
until this run completes. Commit/push depend on the result.

## Delivery verification

Full package verification completed successfully: 19,587 tests passed, 41
skipped; 628 files passed and one skipped; 375.50 seconds. The two documented
experimental exclusions are unchanged and are not counted as passes. Types,
scoped lint, maintained build, native Node 18 restoration, and real CLI normal/
checkpoint/resume checks passed as recorded above. Remote delivery and release
publication are tracked separately from these local checks.

The next validated issue is aggregate handlers used as accessors or bind targets:
normal execution works, but the snapshot callable allowlist rejects them. A
separate custom-subclass probe still rejects retained class construction
environments; executor support does not claim to solve that distinct boundary.
