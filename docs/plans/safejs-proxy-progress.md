# Internal Proxy progress

Source checkpoint: f71a86152. A fresh `npx vitest run
packages/safe-js/src/interp/guest-proxy` run passed 388 tests across 24 files
(session 50088). This filename selection tests internal carriers injected by test
bindings. It excludes the unimplemented public Proxy global tests and is not a
full-package, snapshot, or JavaScript-conformance gate.

## Locally committed

- Private target/handler state, revocation checks and trap lifecycle.
- Get/set, has/delete, own-descriptor/define, ownKeys, prototype and extensibility
  operations, including their tested target invariants.
- Member expressions, assignments, membership, deletion and with bindings.
- Object key/name/symbol/descriptor enumeration and own-property predicates.
- Proxy-aware isPrototypeOf traversal, including bounded virtual cycles; see
  [verification](safejs-proxy-is-prototype.md).
- Proxy-aware legacy getter/setter lookup; see
  [verification](safejs-proxy-accessor-lookup.md).
- Proxy-aware legacy __proto__ getter/setter; see
  [verification](safejs-proxy-legacy-proto.md).
- Proxy-aware Array.isArray with iterative budget checks; see
  [verification](safejs-proxy-array-identity.md).
- Custom/array object tags for non-callable Proxy receivers; see
  [verification and remaining scope](safejs-proxy-object-tag.md).
- Inherited Proxy tag reads for ordinary receivers; see
  [verification](safejs-proxy-inherited-tag.md).
- Ordinary-constructor instanceof through Proxy chains; see
  [verification and remaining scope](safejs-proxy-instanceof.md).
- For-in key collection and per-iteration descriptor checks through Proxies; see
  [verification and checkpoint limits](safejs-proxy-for-in.md).
- Array-method async membership/deletion dispatch and internal-view isolation;
  see [verification and remaining array scope](safejs-proxy-array-methods.md).
- Wrapped-array species selection, including nested Proxies and subclasses;
  see [verification](safejs-proxy-array-species.md).
- Object.assign sources and targets, descriptor-map enumeration, object
  spread/rest and rest exclusions.
- Ordinary enumerability changes during values/entries, descriptor-map and
  spread/rest traversal.

After the source checkpoint above, internal freeze/seal gained Proxy dispatch;
see [set-integrity verification](safejs-proxy-set-integrity.md). Integrity queries
also gained dispatch; see [query verification](safejs-proxy-test-integrity.md).

Individual implementation plans record failing native comparisons, scoped
regressions, TypeScript and lint checks. Recent records include
[spread/rest](safejs-proxy-copy.md), [ownership](safejs-proxy-ownership.md), and
[descriptor maps](safejs-proxy-define-properties.md).

## Remaining integration and verification

- Public Proxy construction and Proxy.revocable; callable/constructible carriers,
  apply/construct traps and callable identity.
- Proxy graph serialization/restoration, cycles, revocation state, validation,
  and host/structured-clone boundaries.
- Proxy species result definitions, flattening/concat identity, remaining built-in/callable-Proxy instanceof cases and object
  tags need consumer audits.
- Other array-identity consumers and ordinary prototype-cycle checks need
  Proxy-aware validation.
- A fresh integrated package gate after implementation; the earlier passing
  dynamic/eval candidate predates this Proxy work.

This list is a working inventory, not proof that no other consumers or language
gaps remain. Weak collections, host-Promise imports and other JavaScript gaps
remain separate work. No push, release, or full-conformance claim.
