# Public Proxy instanceof audit

The README listed callable Proxy constructors and special built-in paths as
pending integration. Revalidation found no mismatch in the selected public cases.
No runtime change was justified or made.

Fourteen native-comparison regressions cover ordinary and nested constructor
Proxies, bound constructors on both sides of wrapping, custom Symbol.hasInstance
on non-callable objects, callable Proxy hasInstance hooks, arrows, revocation,
property-read ordering, and wrapped Array/Map/Error/Uint8Array instances. A
Proxy-wrapped Uint8Array constructor also passes.

This is evidence for those cases, not every built-in or host constructor.
The tests preserve coverage and the README now describes the observed support.
Pushes and releases remain paused.
