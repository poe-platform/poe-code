# Isolated global object environment

## Validated gap

Built runtime probes return UNBOUND_IDENTIFIER for globalThis. Independent
native VM contexts confirm these behaviors:

- globalThis.Math === Math is true.
- Setting globalThis.sample = 7 makes the unqualified sample read return 7.
- A getter defined on globalThis is invoked by an unqualified identifier read.
- A lexical let sample binding does not become an own global-object property.

No host global was modified by the probes. The current safe-js template lists
globalThis among unavailable globals; adding support will require accurately
updating that template and syncing skills, without exposing Node host globals.

## Required design

- Create an isolated guest global object, never expose the host globalThis.
- Share builtin binding slots and global-object property storage so identifier
  writes, property writes, deletion and descriptor operations remain coherent.
- Preserve lexical shadowing, TDZ, module/function-local declarations and the
  existing injected-host-binding contract. Do not silently make injected
  const bindings writable as a side effect.
- Route getter/setter execution through guest call, cancellation and budget
  machinery. Scope.lookup and Scope.assign are currently synchronous; guest
  property evaluation uses resumable asynchronous interpreter operations.
  A copied builtin table or native accessors calling asynchronous guest code
  will not implement the required semantics.
- Cover identifier reads, calls, assignments, compound updates and destructuring
  writes through the object environment, not only direct globalThis access.
- Preserve the global object's identity, descriptors and binding relationship
  through closures, suspended continuations and repeated snapshot round trips.
- Retain guest-added data for budget accounting without repeatedly charging the
  entire pristine builtin graph.
- Test run isolation, persistent realms and host capability non-exposure.

This is a separately validated next feature, not part of the undefined parser
candidate. No implementation has been made. Read the applicable skill
instructions before editing any skill template; README changes still require
the user's permission.

## Identifier-write integration points

Current runtime writes occur in ordinary/compound assignments, identifier
updates, declaration restoration, function hoisting and patterns.bindIdentifier.
The latter calls synchronous Scope.assign directly; its PatternContext already
has resumable property-write hooks but no identifier-reference hook.

Preserve assignment-reference semantics across RHS evaluation and suspension,
but validate the exact object-environment write behavior before implementation.
The initial expectation that an existing global deleted by the RHS would be
recreated was disproved by a native strict-mode VM control: both simple and
compound assignment throw ReferenceError and leave the property absent.
Another native control confirms RHS effects precede the error when writing an
unbound name, and destructuring assignment invokes a global setter once.
Keep declaration initialization distinct from writes through references.

A VM control that creates an initially missing global in the RHS completes
successfully; do not assume its behavior matches a plain property reference or
the behavior of other host environments without further checks. No code change
has been made based on the earlier, disproved expectation.

## Baseline and reference checks (September 8)

The initial focused test run completed with 17 failures out of 17 tests, before
any runtime changes. The expanded suite adds native isolated-VM controls for
29 cases, covering updates, logical assignments, declaration shadowing,
deletion, accessor calls, descriptors and rebinding globalThis itself.

The object environment algorithms require HasProperty for binding discovery,
Get for reads, and a second existence check followed by Set for strict writes:
[Object Environment Records](https://tc39.es/ecma262/multipage/executable-code-and-execution-contexts.html#sec-object-environment-records).
Lexical environment records must remain distinct.

One native control initially failed: Node's contextified VM global object does
not compare equal to the accessor receiver, even for explicit property access.
A separate ordinary Node module process confirmed the getter and setter both
receive globalThis (`[7,[true,true,8]]`). The VM control now checks access to a
receiver property; the guest receiver-identity regression remains a separate
test. Do not implement the VM wrapper's identity quirk in the guest realm.

Snapshot integration must update ScopeFrame, guest-heap capture, scope-frame
hydration and strict guest-heap validation together. Do not introduce an
unserialized scope-only global object that loses its environment relationship
when a suspended closure or generator is restored. Existing legacy frames
without the new field must remain restorable.

The expanded complete interpreter file currently reports 31 failures and 30
passes (61 cases): all 29 native controls pass, and the existing unbound-name
RHS-order behavior also passes in safe-js. The other 31 guest cases remain red.
The native-only diagnostic selection is not a passing implementation gate.
An additional snapshot regression requires three JSON round trips of a closure
that increments the global binding, reads a global getter, and checks that its
captured global object still shares identity and property storage.

## Implementation candidate

Builtin installation now creates a separate intrinsic guest global object with
non-enumerable builtin descriptors and a writable/configurable globalThis self
reference. The builtin installation record is branded through a WeakMap so
caller-injected bindings retain their existing const contract. Root scopes use
the object's property table; lexical scopes continue using binding cells.

Object-backed lookup carries its receiver to interpreter property reads.
Assignment and pattern writes use the existing guest property-write callback,
including setters. Scope-frame snapshots encode the object-environment reference
and hydrate it after heap identities exist. Intrinsic mutation tracking owns
global-object budget roots, including writes made only through properties.
The existing direct-scope retention test now inspects the actual budget roots
and verifies the restored lookup, instead of requiring duplicate scope-owned
retention for the same property. The aggregate budget test remains unchanged.

Checks so far: TypeScript no-emit passed; 70 focused feature/snapshot cases
passed; 564 lint-rule and global-binding cases passed. A wider snapshot suite
and source lint are running. Full package validation and build remain required
before delivery. No commit or push of this candidate yet.

The skill-creator guidance was used for a narrow template correction, followed
by the required sync (six installed copies updated). Its Python validator could
not run because the available Python3 environment lacks PyYAML; the maintained
sync parsed the template frontmatter successfully. No README was edited.

The first wider snapshot run reported 1400 passes and 11 failures: public dump
discovery lost builtin roots because Scope.snapshot still enumerated only cell
bindings. Scope.snapshot now enumerates object-environment data descriptors
before lexical cells; it never invokes getters. All 15 affected public-dump,
heap-validation and new global-object snapshot cases then passed. Source lint
passed before this final small Scope.snapshot change and must be rerun for it.
The maintained safe-js workspace build closure is now running; do not run full
tests concurrently with dist rewrites. The prior main commit published
@poe-platform/safe-js@0.1.432; this new global-object candidate is still local.

The 23-workspace build closure and all four fresh-process built-import checks
passed. Full package regression session 70247 is running with only the two
previously documented untracked policy/weak-collection exclusions. Source is
frozen during that run. The final scope lint also passed.

A built-runtime probe during the frozen run found a remaining integration bug:
`globalThis.this=7;return this` and the corresponding arrow-function read both
return 7, whereas strict native controls return undefined. Ordinary function
this remains correct. Scope.lookup("this") currently enters the new object
environment; the internal this binding must bypass global properties. Add the
failing regressions and fix this after the active full run completes, then
repeat the relevant gates. No speculative fix has been made during the run.

A second built-runtime integrity probe serialized `return ()=>globalThis`,
changed the root frame's objectEnvironment reference to the existing Math
intrinsic, and restore accepted it. The candidate currently checks only the
reference kind, not the global-object identity. Add an adversarial regression
and constrain new object environments to the trusted globalThis intrinsic.
Legacy frames without objectEnvironment remain valid. This probe did not modify
the worktree or runtime and the full regression run remains frozen.

The live full run has also reported 14 compatibility assertion failures across
run.promise-compatibility.test.ts and run.promise-order.test.ts. A standalone
built probe confirms the immediate rejection is invalidState at
$.bindings.structuredClone instead of the expected unsupported execution
semantics error. registerIntrinsicObject currently tracks each function-valued
global property as a method, materializing function property tables even for
builtin functions that previously had none. The generic legacy snapshot guard
then rejects that newly introduced function state. Inspect and correct global
registration's method-tracking side effect; preserve the existing validation
assertions and do not waive or exclude these failures.

Full run 70247 completed: 20011 passed, 18 failed, 38 existing skips (451.86s).
The failures were 15 execution-semantics rejection assertions, one raw snapshot
identity assertion, and two explicit historical-global graph comparisons.
No timeout occurred and no new exclusions were added.

The new this/corrupt-reference regressions first produced three failures, then
passed after lexical-only this lookup and strict globalThis intrinsic identity
validation. Global registration now tracks only its own object state, not
function-valued bindings as object methods. All 198 cases across the feature,
snapshot, promise compatibility/order/construction and running-state files pass.

The historical graph helper now accepts an explicitly enumerated list of new
intrinsic bindings, checks each new root's reference and canonical identity,
and still compares every prior binding and alias. Only the two callers specify
globalThis. An initial empty-object expectation was disproved (the intrinsic
has 55 descriptors) and replaced by this identity check; no historical fixture
bytes or hashes were changed. The independent feature snapshot tests cover the
global object's descriptor/binding/identity behavior across repeated restores.

Prior main delivery is fully published: poe-code@14.0.90 latest and
@poe-platform/safe-js@0.1.432. The corrected candidate has not been committed.

The two historical suites now pass 44 tests with one existing skip. TypeScript
no-emit passed. Source lint found one no-this-alias violation in lookupThis;
the method now performs its own cell check and recurses to the parent, just as
ordinary lookup does. The refreshed 23-workspace build and four fresh-process
import checks passed. A full package rerun is starting with source frozen and
the same two documented exclusions; the final scope lint is still running.

Final scope lint passed. Built-runtime checks on Node 18.18.0 passed for global
property/identifier coherence, accessor reads, and arrow this isolation. Full
rerun session 15420 remains active; its full output is retained at
`/var/folders/rw/s4cy76hn6v55qrp0dhcbtplc0000gn/T/safejs-global-regression.n0oLvDnW8a`.

The full corrected rerun completed successfully: 20036 passed, 38 existing
skips, 672 passing files and one skipped file, 419.78s. No new exclusions,
fixture rewrites, or timeout/budget changes were used. Maintained agent-harness
workspace checks are running as a downstream consumer check before delivery.

The maintained agent-harness checks passed: 163 tests across 13 files (15.46s).
Remote main advanced with playground engine integration commits; their paths
do not overlap this candidate or the user's staged safe-bash edits. Inspect
the lockfile delta before rebasing; preserve the user's staged patch exactly.
