---
title: RegExp flags property reads
---

Validated gap: the flags getter read immutable engine flags rather than guest
properties, ignoring overrides, getter effects, and throws. This also bypassed
the global-flag preconditions of String.matchAll and String.replaceAll.

Read the eight flag properties in specification order, applying Boolean
conversion without primitive coercion. Keep compiled matching flags separate.
Retain the receiver across guest calls and preserve execution budgets.

The initial regression suite had eleven failures. Native Node 22.23.2 reads
sticky before unicodeSets, unlike the specification; the full-order assertion
therefore follows [ECMA-262](https://tc39.es/ecma262/#sec-get-regexp.prototype.flags)
directly. Other semantic assertions compare with native execution.

Validation: focused regressions, maintained safe-js unit suite, changed-file
lint, package typecheck, selected workspace build, and this real harness pair
with screenshot inspection. No capabilities or agent spawns are required.

Remaining separate gaps include actual intrinsic RegExp prototype accessors,
unsupported engine flags, species construction, and complete symbol algorithms.
Displaying an overridden flag does not implement that engine feature.

Next confirmed gap: setting an own ignoreCase=true on /a/g makes native
Array.from('A'.matchAll(regex), match => match[0]) return ['A']; SafeJS still
returns []. The matchAll clone reads immutable flags rather than the observable
flags property. Fix that separately after this getter change is delivered.
An own flags getter returning 'gi' is read twice by native matchAll (precheck,
then clone), before lastIndex coercion. SafeJS reads it only for the precheck.
If the getter returns 'g' first and 'i' second, native matching becomes
case-insensitive and non-global; this also differs in the current interpreter.
