# Map get-or-insert compatibility

## Validated gap

The September 9 runtime inventory found getOrInsert and getOrInsertComputed
on native Node 26 Map.prototype but not SafeJS. This is newer compatibility
work against https://tc39.es/proposal-upsert/, which was labeled Stage 2.7
when checked, not a claim that these methods are finalized core requirements.
WeakMap integration is separate and remains unfinished.

The initial regression run (9cb4bc) failed 13 cases; two TypeError controls
passed incidentally while the methods were absent. Implementation followed the
failing tests, not just a source-presence assumption.

## Implementation

Both methods use the existing owned Map method dispatcher and install standard
prototype descriptors and arity without requiring native host implementations.
They read private Map entries rather than guest-overridden get/has/set methods.
Computed insertion validates callability even for existing keys, canonicalizes
negative zero before callback invocation, retains callback state, and dispatches
guest callbacks with undefined this and one key argument. The returned guest
Promise is stored without waiting for its settlement.

After the callback, the live map is checked again. Existing entries are updated
in place; deleted entries are appended. Entry limits are checked before the
insertion, and additions notify active collection traversal bookkeeping.
Callback effects are preserved when the callback throws or subsequent insertion
hits a budget limit. Existing-value lookup does not invoke a callback.

## Evidence

- Initial working-tree selection: 89 tests across four files (a3bf09).
- Independent candidate at /tmp/safejs-replay-init.fNTLBZ: 238 tests across
  seven files (a567db), including two additional revoked-callback/live-size
  regressions, collection traversal, restore and serialization.
- Candidate excludes the uncommitted Temporal and weak-reference integration.
  It is based on d1eb8dc29 plus the separately verified ESM initialization fix.
- Maintained selected build: 23 tasks and five fresh ESM imports (16e663).
- Eight actual guest/native Node 26 comparisons matched (5870e4).
- Built CLI passed on minimum Node 18.18.2 without native Map upsert (12fc17).
- CLI screenshot c71294 was generated and inspected:
  `screenshots/node-tmp-safejs-replay-init.fNTLBZ-packages-safe-js-dist-cli.js-tmp-safejs-temporal-backend.7WMTG5-map-upsert.ajs.png`.
- Candidate implementation and new test match the working-tree files byte for
  byte; protected user staging is unchanged (ed829a).
- Broader candidate snapshot plus intrinsic-history checks passed 1,800 cases
  across 134 files with one skip (688d1c). This overlaps the smaller selection;
  do not sum these counts as unique coverage.
- Candidate scoped ESLint completed successfully (ae8b72).

This is bounded feature evidence, not a full-package or JavaScript-conformance
result. Public completed replay covers inserted values and intrinsic method
references; it is distinct from proving every interrupted callback checkpoint.
No release or push is authorized while the publication hold remains in force.
