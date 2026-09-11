# Proxy prototype operations

All 14 initial Object/Reflect tests fail on 004e5fde2 (6177): prototype reads and
writes act on the carrier, ignore traps, accept invalid results and miss
revocation. Implement getPrototypeOf/setPrototypeOf through the shared trap
lifecycle and existing extensibility operations, recursively handling targets.
Keep ordinary operations synchronous and preserve Object primitive semantics.
Object throws on refused writes; Reflect returns false. Proxy traversal consumes
the existing step budget.

Reference: [ECMA-262 Proxy internal methods, sections 10.5.1–10.5.2](https://tc39.es/ecma262/2026/multipage/ordinary-and-exotic-objects-behaviours.html#sec-proxy-object-internal-methods-and-internal-slots-getprototypeof).

The initial post-implementation selection passes all 43 tests (13010). The expanded
selection passes all 64 tests across four files (82176), including matching
invariants, refused-write short-circuit, nested-budget and ordinary synchronous
mutation. The same command completed TypeScript and scoped lint successfully.
This is another internal-method implementation step; no public Proxy constructor,
full-package gate, snapshot completeness, push or release is claimed.
