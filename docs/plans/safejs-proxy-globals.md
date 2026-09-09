# Public Proxy and Proxy.revocable globals

All 32 existing public-facing cases failed at 4c7c63920 because the globals were
absent (10871). Wire the implemented runtime operations into builtin globals.

Proxy requires new, validates target/handler through the existing factory, and
has no own prototype property. Install length/name/revocable in native key order.
Revocable creates a callable, non-constructible revoker; it ignores this and
arguments, is idempotent, and clears its retained Proxy reference after revoking.
Register static functions as intrinsics for global identity/mutation handling.

Verification:

- First registration run passed 39 of 40 cases and exposed length/name property
  order (59597), corrected before further validation.
- Public and internal Proxy selection passed 736 tests across 45 files (6592).
  This includes the existing, still-uncommitted globals/proxy.test.ts audit file;
  the new committed proxy-global.test.ts supplies metadata and lifecycle coverage.
- Expanded global tests, global bindings and ordinary intrinsic checkpoint suites
  passed 44 tests across five files (90012), including revoker data-accounting
  cleanup. These checkpoint tests do not serialize Proxy instances or revokers.
- TypeScript, scoped lint and diff checks passed; both validation chains completed.

Proxy instance/revoker checkpoint graph serialization remains unsupported, as do
unaudited host boundaries and some intrinsic consumers. Do not use Proxy state in
checkpoints until graph support is implemented and verified. Public runtime
availability is not complete JavaScript conformance or a successful package gate.
No push or release. Preserve the separate weak-collection wiring in globals.ts
without including it in this commit.
