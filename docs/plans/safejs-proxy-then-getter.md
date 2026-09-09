# Proxy-valued then getters

Five of six native comparisons failed before the repair. Calling a Proxy-valued
then accessor lost the guest call context, so active Proxy getters failed with
"Proxy operations require guest property access" instead of invoking their
apply trap. The revoked Proxy control already passed.

Pass the caller context through the existing budgeted Promise closure invocation.
In the unbudgeted path, dispatch Proxy getters through the guest call operation
with a fallback budget, leaving the ordinary getter fast path unchanged.

The six native comparisons cover forwarding to the target, apply trap receiver
and empty arguments, thrown trap errors, revocation, inherited getters on callback
return, and nested Proxy getters on async return. A checkpoint case retains the
Proxy getter across await and compares restored behavior to native JavaScript.

Focused getter and checkpoint tests passed: 40 tests across 2 files. The broader
Promise selection passed 667 tests across 47 files. Package TypeScript and scoped
ESLint passed; the final focused getter/checkpoint run also passed all 40 tests.
The host-Promise property-import tests remain unresolved and excluded from the
focused selection; this is not a full-package gate.

README updated. No CLI presentation changes. Pushes and releases remain held.
