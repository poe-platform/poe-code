# Callable Proxy carriers and apply dispatch

At e8e1fff26, nine of eleven native comparisons failed (30012): function targets
received ordinary non-callable carriers, so calls, callbacks and Reflect.apply
could not invoke them.

Create a branded callable carrier for callable targets. Keep target/handler only
in the private state map. Interpreter and standalone builtin invocation dispatch
Proxy calls through the budgeted internal operation, before invoking a carrier's
implementation function. Raw carrier calls reject missing runtime dispatch.

The call operation resolves apply, forwards absent/null traps to the target, or
invokes the trap with handler as this and target/receiver/fresh argument list.
Retain inputs and the argument list across lookup/invocation; bound recursive
forwarding and allocate the list against the active budget. Callable identity
persists when private target/handler edges are revoked.

Verification:

- Eleven initial native cases and package TypeScript passed (54752).
- Internal Proxy selection passed 671 tests across 42 files, and implementation
  lint passed (27884), before the final call-specific expansions.
- Expanded call plus ordinary function/receiver/apply suites passed 85 tests
  across four files (53568), including standalone invocation, revocation,
  recursive call limits, argument-list identity and retention/failure cleanup.
- Bound-call and callable-trap additions passed all 17 call cases (58400).

Constructor dispatch and constructible carrier identity are not implemented in
this commit. Callable object tags, public Proxy/revocable, checkpoint graphs and
host boundaries remain incomplete. No full-package or conformance claim; no
push or release.
