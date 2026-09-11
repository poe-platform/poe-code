---
title: RegExp iterator prototype validation
text: a😀b
---

# RegExp String Iterator prototype

Follow-up to the delivered Map/Set prototype work, scoped to RegExp iterators.
The 14-case native-comparison baseline against efb871f96 produced 12 failures
and two passing receiver-error comparisons in 1.98 seconds. Those two also pass
when next is missing and do not prove correct branding. The failing cases cover
stable next/iterator function identity, common parent, descriptors, overrides and
deletion for both String.prototype.matchAll and RegExp.prototype[Symbol.matchAll].

Preserve existing private matcher/input/exhaustion state and observable custom
exec behavior. Install the real prototype after common IteratorPrototype exists;
check all three creation paths in globals/regex.ts and methods/string.ts. Stop
synthesizing deleted methods for prototype-linked guest iterators while preserving
legacy low-level callers. Audit runtime/public snapshots for cursor, symbols,
accessors, custom prototypes and cycles; retain data-copy capability boundaries.
Use failing tests for any newly found integration gap. Do not assume symbol
budget accounting is missing: generic measurement already counts symbols.

Relevant prior evidence and specification references are in
safejs-collection-regexp-iterator-prototypes.md. Run focused tests, maintained lint/types/build checks, a real paired
harness with screenshot inspection, built SDK/public replay and package tests
before its own commit and push.

The runtime now installs a shared RegExp String Iterator prototype after the
common IteratorPrototype, and attaches it in all three creation paths. Registered
prototype methods replace per-read synthesis for guest iterators, with legacy
low-level fallback retained. The initial 14 prototype regressions passed.

Expanded coverage includes a custom species matcher. It exposed four rejected
runtime/public snapshot cases and missing accessor capture accounting (10 units
versus at least 101 required). A guest RegExp iterator heap node now preserves
matcher/input/modes and complete property/prototype state with validation and
restoration. Accessor captures are counted without executing getters; an exact
symbol-budget control prevents duplicate generic accounting. Data-copy boundaries
remain separate from runtime snapshot support.

Focused checks passed: 111 tests across seven files in 2.97 seconds and 50 tests
across four additional matchAll/presence files in 2.65 seconds. The new file has
35 prototype, custom matcher, replay, cursor, budget and malformed-state tests.

Scoped ESLint, package production TypeScript, maintained root lint:types and
the changed test file's TypeScript diagnostics passed. The normal workspace
build completed, including all four built-import checks and root bundle stages.
The paired harness passed and its generated screenshot was inspected; it uses
zero spawns and makes no model-behavior claim. Node 18 built SDK execution and
public dump/replay preserved the Unicode cursor, accessor self-reference, stable
next identity and exhaustion. Package-wide tests passed: 19,269 tests across
602 passing files in 326.70 seconds, with 41 skipped tests and one skipped file.
The only explicit exclusion was the separately documented unresolved
promise-import-properties.test.ts host-Promise policy probe; it is not a pass.
