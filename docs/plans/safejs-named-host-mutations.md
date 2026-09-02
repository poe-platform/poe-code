# Opt-in named host mutations

Issue: #549

## Public contract

- Extend `HostObjectNamedDefinition` with optional synchronous `set(name, value)` and `delete(name): boolean` providers. Existing declarations remain read-only.
- Fixed properties retain their declared setters. Fixed methods/accessors and all indexed slots/length are protected from named mutation; reserved prototype/constructor names remain forbidden.
- Assignment returns its guest RHS. Deletion of an absent named key returns true without a provider call; deletion of an existing key returns the provider's boolean result.
- Preserve ordinary owner-aware value conversion, saved live object identity, native updates and revocation.
- Validate current keys and prospective creation count/UTF-16/data/work limits before mutation. Validate the resulting key list after successful provider calls. Providers own atomic storage quotas and side effects; SafeJS cannot roll back native writes or govern arbitrary native memory.
- Reject invalid/proxy/declared async providers before invocation. Reject and observe promises returned by otherwise synchronous providers.

## Verification

1. Add failing public/core tests for creation/update/deletion, readonly defaults, collisions, quotas and synchronous provider requirements.
2. Implement metered named mutations and propagate deletion results through interpreter evaluation.
3. Cover adversarial names/definitions/values, normal conversion, cross-owner access, provider failures, cancellation, work/data limits and saved callbacks after close.
4. Verify public root/core TypeScript and runtime consumers under Node/Bun, including fresh npm installations.
5. Run full SafeJS and normal commit/push checks, publish through GitHub, verify provenance, close #549 and resume monitoring.

Browser Storage coercion, document.cookie parsing, persistence, origin/session policy and events remain consumer-owned.

## Local results

- Initial six mutation regressions failed against the read-only implementation. A separate property-name string-budget regression demonstrated a native write before failure; it now rejects before the provider.
- All 41 mutation cases and 119 combined named/indexed cases pass, including ownership, callback revocation, external/native cancellation, conversion, provider errors, promises and quotas.
- Full SafeJS suite: 10,045 passed, 41 skipped; skips are not reported as passes.
- Normal workspace/root build passes. Installed standalone tarballs pass the complete public consumer fixtures under Node and Bun, plus root/core TypeScript compilation.
- Normal commit/push checks and GitHub publication remain release gates. Verify fresh registry consumers and provenance before closing #549.
