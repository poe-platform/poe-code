# Proxy deletion

All 13 new tests failed on db19e7a03 (25484). Reflect.deleteProperty touched
the carrier, skipped traps, ignored revocation and incorrectly accepted protected
property deletion reports. Native comparisons validate the expected invariant
outcomes before guest assertions.

Implement the internal deletion operation using captured trap state, recursive
fallback, Boolean trap conversion, and post-trap target descriptor/extensibility
checks. False trap results short-circuit target inspection. A trap may actually
delete a configurable property from a non-extensible target; check the remaining
target state, not its state before the trap. Charge each Proxy traversal to the
step budget.

Reference: [ECMA-262 10.5.10](https://tc39.es/ecma262/2026/multipage/ordinary-and-exotic-objects-behaviours.html#sec-proxy-object-internal-methods-and-internal-slots-delete-p).

The post-change selection passed all 133 tests across five files (20216), covering
Proxy deletion/descriptor reads, Reflect, value deletion and primitive deletion.
The same command completed TypeScript and scoped lint successfully.

This implements Reflect dispatch and the reusable internal operation. Interpreter
delete expressions and array-method deletion callbacks still require Proxy
integration and strict/sloppy refusal tests; this change does not claim those
paths work. Public Proxy support, snapshots and full-package validation remain
unfinished. No push or release under the user's publication hold.
