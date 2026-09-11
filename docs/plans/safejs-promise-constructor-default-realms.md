# Promise constructor default realms

Baseline `864d7b02b`: two native differential cases failed for foreign
newTarget.prototype values of 7 and null. The custom-object prototype control
passed, and all three promises fulfilled correctly.

Promise construction now selects the newTarget realm's Promise intrinsic when
the prototype property is not an object. Selection occurs after validating the
executor and before creating the promise capability or invoking the executor.

The 11 targeted tests cover primitive/custom defaults, ordinary/bound-class/
Proxy target replay, replaced global bindings, revocation during prototype
lookup, invalid newTargets, and executor validation order. All pass.
The broader Promise and pending-Promise snapshot route passed 304 tests across
30 files. An earlier six-file constructor/accounting run passed 114 tests;
these scopes overlap and must not be added together.

Scoped lint, TypeScript, the maintained 23-workspace build and four fresh import
checks passed. No full package gate or new full snapshot gate was run for this
focused follow-up. No push, release, or issue closure.

Three built-SDK probes also passed, checking fulfillment and prototype identity
with ordinary, bound-class and Proxy targets.
