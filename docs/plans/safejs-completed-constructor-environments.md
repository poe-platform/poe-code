---
title: Completed constructor environment snapshots
---

# Completed constructor environment snapshots

Investigate after executor delivery and the separately validated aggregate
callable-reference fix. Do not change the runtime during its active full test.

A read-only built-code probe reached this source after the capability-executor
implementation:

```js
let constructions = 0;
class P extends Promise {
  constructor(executor) {
    constructions++;
    super((resolve, reject) => executor(
      value => resolve(value), reason => reject(reason)
    ));
  }
}
const c = Promise.withResolvers();
const result = P.all([c.promise]);
return async () => {
  const before = constructions;
  c.resolve(7);
  return [await result, before, constructions];
};
```

Normal execution and invocation completed. Fresh low-level snapshot capture
then failed with `Active class construction environments cannot yet be
serialized`. The constructor call itself had returned; nested guest callbacks
retain its construction environment. This is a different admission boundary
from the now-represented native capability executor. Confirm native output parity
and turn the case into a regression before implementing anything.

Investigate constructor environment state, initialized `this`, `new.target`,
home object, super-call restrictions and private-field initialization. Preserve
completed state without rerunning constructors or field effects. Do not merely
remove the admission guard or admit genuinely active construction frames.

Read-only inspection: classes.ts currently keeps initialized, thisValue and
thisScope in native constructor locals. The retained construction environment
contains native superCall and initialize functions; closure-origin.ts preserves
that environment by identity. Snapshot admission tests only for construction's
presence, not whether the constructor invocation has returned. Reconstructing
this requires explicit state, not simply dropping construction from snapshots.
In particular, superCall dynamically reads the superclass and invokes it before
checking whether this was already initialized, so even a rejected repeated super
call can have observable effects. Preserve those semantics and investigate
escaped arrows after object-returning derived constructors as well as the
ordinary initialized case.

## Validated regressions and implementation progress

Four new tests compare native execution with SafeJS controls before attempting
snapshot restoration. All native/control pairs match, and all fresh snapshots
fail at the construction-environment guard. Coverage includes base `this` and
new.target, superclass effects before repeated-super rejection, delayed super
after an object return with private-field initialization, and a Promise subclass
whose constructor wraps resolvers.

Constructor locals now live in ConstructionState, indexed by the retained
environment. createConstructionEnvironment rebuilds initialize/superCall behavior
from explicit state and class origins. Active calls are counted through finally
blocks, including delayed super calls. All 104 existing class and Promise
subclass tests pass.

Snapshot encoding/restoration now passes all four native-parity regressions.
Three malformed-record regressions first demonstrated acceptance of inconsistent
scope initialization, scope ownership, and prototype ownership; validation now
rejects all three. Internal construction environments use a separate restoration
cache and are not admitted as ordinary guest data.

A retained-memory regression removed ordinary references to the constructor,
then added a 400-character property to its function object. Accounting originally
reported no change. Interpreted arrows now retain the explicit construction
state's constructor, new target, prototype, receiver, and scope values; the
regression passes. Normal function and generator closures reset their function
environment and do not capture constructor state.

The latest focused run passed 102 tests across three files. The supplied Promise
subclass path did not select a file in that run, so this is not fresh verification
of that suite. Broader snapshot checks, type/lint checks and CLI validation remain
pending. Do not publish this as completed constructor snapshot support yet.

Subsequent validation: all 1,323 tests across the snapshot suite plus construction
state tests passed. The correct Promise-subclass test path passed all 11 tests.
All nine changed TypeScript files had zero diagnostics. Additional native-parity
tests passed for dynamic superclass replacement before delayed super, an escaped
arrow after a throwing constructor, and a throwing field initializer that leaves
this initialized and rejects repeated super without re-running fields. The
constructor snapshot test file now passes 11 tests. Scoped ESLint is still running;
package-wide tests and built CLI validation have not yet run for this change.

Scoped ESLint completed successfully. The package-wide unit command is now
running with only the two existing unresolved-gap files excluded (host Promise
property import and weak collections); neither exclusion represents a pass.
Prepared the same-basename CLI harness using the SafeJS skill. It checks delayed
private-field initialization, repeated-super rejection and a Promise subclass
across await boundaries without agents or external capabilities. It has not yet
been executed against a fresh build; checkpoint save/resume and screenshot
inspection are still required.

The native Node 22 control caught an incorrect harness expectation before any
SafeJS assertion: P.all performs three P constructions before the final await,
and four afterward, not one and two. Corrected the harness to those observed
counts and reran its complete native body successfully: delayedPrivateField
[7,1,true], repeated=true, promiseValue=9, constructions=4. This is native-control
evidence only, not built SafeJS CLI evidence.

Package verification completed: 19,606 passed, 41 skipped; 631 files passed and
one skipped, in 388.78 seconds. Only the two documented unresolved-gap files were
excluded. Runtime files were unchanged throughout this run. The maintained build
is the next gate before actual CLI checkpoint save/resume.

The maintained build passed all 70 declared workspace builds, root suffix stages,
and four SafeJS built-import tests. Three additional public-dump tests reject
internal constructor references in direct, nested and shared guest bindings; all
14 constructor snapshot tests pass. The real CLI harness passed checkpoint save
and resume at /tmp/safejs-constructor-replay.YUJaXm/checkpoint.json, with both PNGs
visually inspected. Both runs used zero agent spawns; they are runtime/CLI checks,
not model-behavior evidence. The final added test file is undergoing refreshed
lint/type checks before the atomic commit and main push.

Final added-file ESLint and TypeScript checks passed. The protected safe-bash
staged patch remains d770ec782b2a4ae7e2580e63ded765933890a1c5. All constructor
runtime, snapshot, tests and harness files form one atomic improvement; unrelated
unresolved-gap and performance experiments are not part of this commit.
