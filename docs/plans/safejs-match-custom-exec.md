---
title: String match custom exec dispatch
---

Native comparison initially produced twelve failures and two passing controls:
String.match bypassed custom RegExp exec functions and getters. Two further
failures established overridden global mode and Unicode empty-match advancement.

Implement reusable RegExpExec dispatch, shared with RegExp.test: get exec, invoke
callable values with the regex receiver and input, reject primitive results,
and otherwise fall back to built-in execution. Match preserves non-global result
identity and repeats lookup for global matching, including self-deleting hooks.
Read match text through guest properties and string coercion; advance empty
matches and enforce step, data, and result-array limits.

The custom-exec route follows the current
[match algorithm](https://tc39.es/ecma262/#sec-regexp-prototype-%symbol.match%)
for observable flags. Native Node 22 is used for comparable behavioral cases.
Its older flags-read algorithm should not replace the current specification.

Validate with focused regressions, maintained safe-js unit tests, changed-file
lint, package types, selected workspace build, and this harness pair with
screenshot inspection. No capabilities or agent spawns are needed.

Remaining gaps: generic intrinsic prototype symbol methods, observable flags
in the no-custom-exec fast path, custom exec in other string operations, and
matchAll constructor/species construction. Unsupported Unicode regex syntax
is not implemented by advancing a custom empty match over a surrogate pair.

The maintained suite caught three data-accounting regressions when sharing
dispatch with RegExp.test. Transfer input retention to the helper after coercion
rather than counting it in both frames. Existing low/high-budget controls pass
without changing their limits.

Next reproduced gap: /a/ with exec returning {index:7} makes native
'a'.search(regex) return 7; SafeJS returns 0. With an exec that sets lastIndex=9
and returns null, native search returns -1 and restores the previous cursor;
SafeJS still returns the engine's match index instead.
