# Legacy Object accessor methods

The built prototype comparison reports missing __defineGetter__, __defineSetter__,
__lookupGetter__, and __lookupSetter__. Validate actual calls before implementation.
Use the [legacy accessor algorithms](https://tc39.es/ecma262/multipage/fundamental-objects.html#sec-legacy-object.prototype-accessor-methods)
and native differential checks for receiver boxing, callable-before-key validation,
descriptor merging, own-data shadowing, prototype traversal, and symbol keys.

Use the existing guest descriptor adapters and definition path, never native
getters or host prototype traversal. Cover resource budgets and snapshot replay.
Keep __proto__ support a separate change because it alters prototype mutation
and existing boundary assertions. Keep unfinished weak collections out of this
atomic commit and push.

The first implementation passes 28 of 30 tests. One remaining test exposed an
independent symbol-accessor snapshot failure, now tracked separately. The other
is a native-oracle mismatch: V8 returns no accessor for an absent integer-indexed
own property even when its prototype defines that accessor. ECMA-262 20.1.3.9.3
steps 3.a–3.d instead require continuing through GetOwnProperty/GetPrototypeOf.
Keep the guest prototype walk and use an explicit native descriptor-walk oracle
for that same case; do not copy V8's ordinary-property-lookup shortcut.

## Delivery checks

The independent symbol-accessor snapshot fix is verified on remote main as
ac0a0036e691c3c54a5157058e8400c43b7e652e. With it, all 30 new legacy-method tests
pass. Eight focused Object/accessor files pass 372 tests; the snapshot directory
passes all 1,462 tests. Focused lint and the maintained 23-workspace build with
four fresh import checks pass. Built Node 18.18.0 and Node 24.14.0 each match
20 native comparisons over ordinary objects, arrays, maps, functions, null
prototypes, string keys, and both fresh and well-known symbol keys.

No matching open GitHub issue was found. This adds only the four legacy accessor
methods; it does not add __proto__, Function, Proxy, or portable weak symbols.
