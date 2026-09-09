# Constructible Proxy carriers

At 8ea51cc77, nine of thirteen native constructor comparisons failed (20457).
Callable carriers lacked constructible identity and constructor dispatch.

Preserve constructibility from the target. Dispatch constructors through the
interpreter and standalone builtin paths using the active budget. Resolve the
construct trap, forward absent/null traps with the original newTarget, and pass
target/fresh arguments/newTarget to a trap with handler as this. Reject primitive
trap results. Keep newTarget and argument values retained through guest calls.

The first integration exposed two further failures (55792): ordinary function
construction read newTarget.prototype directly from function metadata. Route this
read through guest property access when available, preserving Proxy getter
effects and the constructed object's prototype.

Standalone builtin invocation now forwards an explicit newTarget through its
callback and fallback paths. Raw carrier construction rejects missing runtime
dispatch. Revoked carriers retain constructible identity but reject invocation.

Verification:

- Focused construction/call/class/state selection passed 128 tests across four
  files (83942); TypeScript and implementation lint passed.
- Internal Proxy plus ordinary function/bound-checkpoint selection passed 740
  tests across 45 files (37971), before the final standalone/retention additions.
- Expanded construction suite passed 19 tests (13929): alternate newTarget,
  nesting, bound construction, Proxy traps, errors, prototype getters, subclassing,
  standalone forwarding, retained arguments and revocation.
  Final test-file lint and diff checks passed as well.

Public Proxy/revocable, callable intrinsic audits and Proxy checkpoint graphs
remain pending. No full-package, full-conformance, remote delivery or release claim.
