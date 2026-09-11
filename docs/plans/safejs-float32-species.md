---
title: Float32Array species construction
---

# Float32Array species construction

Native/SafeJS read-only comparisons against the built main implementation
confirmed these differences before any species implementation changes:

- `new Samples([1,2,3]).slice(1) instanceof Samples` is true natively and false
  in SafeJS for `class Samples extends Float32Array {}`. Subarray has the same
  mismatch.
- A custom `value.constructor[Symbol.species]` getter is called by native slice
  but not SafeJS, even when it returns the ordinary Float32Array constructor.
- Setting `value.constructor = 7` makes native slice throw TypeError; SafeJS
  currently returns normally.

Add native-oracle failing tests before implementation. Cover inherited species,
null/undefined fallback, invalid constructors, invalid results, oversized results,
constructor/getter ordering after bounds coercion, source mutations, overlapping
storage, retention through guest constructor calls, and snapshot identity.

Subarray species receives a buffer plus byte offset and length, whereas slice
species receives a length. SafeJS currently keeps backing buffers internal and
does not implement Float32Array's buffer constructor overload. Correct subarray
species support therefore needs explicit guest buffer support, not merely changing
the result prototype or passing a copied array to the guest constructor.

Keep the current bound-coercion improvement atomic and independently qualified.
Species behavior remains an open requirement after that change.

The initial eight-case species suite now confirms six failures and two passing
absent-species fallback controls against the current source. Log:
`/tmp/poe-safejs-float32-species-red.log`. No species implementation changes yet.
Bound coercion is verified on remote main as
ee01937afbf94bfd8d3f0f042c3f31f316f0a2b2.

Reference: [ECMAScript indexed collections](https://tc39.es/ecma262/multipage/indexed-collections.html),
TypedArray slice/subarray and TypedArraySpeciesCreate sections. Native Node
comparisons remain the executable oracle for supported current behavior.

Revalidated after the ArrayBuffer, join and slice-resize improvements:
`2003e0da5c85d7bcf284793f3d55513bddd7483a` is verified on remote main.
The same eight-case suite still has six failures and two passing fallback
controls. Current red log: `/tmp/poe-safejs-float32-species-current-red.log`.
Backing buffers, buffer constructor overloads, resize tracking and snapshot
layout preservation are now available, so the former subarray prerequisite is
resolved. Next implement actual species construction, not prototype relabeling.

Keep monitoring slice scoped run 34092831078 and CLI run 34092831279 while working.
Join scoped run 34092538018 and CLI run 34092537952 were still active at the last
poll; no publication receipt has been verified for those commits yet.

Initial species implementation is local, not pushed:

- Expanded allocation/storage probes produced ten failures and two passing
  controls before implementation. Added inherited TypedArray Symbol.species
  getter; slice/subarray now read constructor/species after bounds conversion,
  invoke custom guest constructors with their actual argument lists, and validate
  returned typed storage and slice minimum length.
- Custom slice destinations preserve their byte offset and extra elements.
  Native overlapping slice copies proceed forward, unlike Uint8Array.set's
  overlap-safe copying; a failing native comparison required a forward byte loop
  for overlapping rightward destinations. Ordinary copies retain the fast path.
- Direct-call regressions exposed that realm identity maps are cleared after a
  run. Methods now retain the intrinsic constructor from prototype creation
  instead of resolving it from a cleared realm during a later direct call.
- Species, range-coercion and resize-slice tests: 31 passed. Broader Float32
  checks are running. Remaining qualification includes callback mutation,
  tracking subarray constructor arguments, invalid/out-of-bounds results, budgets,
  snapshots, full SafeJS tests, types/lint and real harness.
- Reference reviewed: ECMAScript TypedArraySpeciesCreate and
  TypedArrayCreateFromConstructor, in the indexed-collections link above. Native
  Node comparisons remain the executable oracle for current supported behavior.
- Join publication is confirmed: scoped run 34092538018 published
  @poe-platform/safe-js@0.1.316 at 2026-09-07T06:53:35.3187337Z.

Edge qualification:

- Added resizable subarray argument recording, constructor-time source mutation,
  species-getter shrink, out-of-bounds custom result and short-subarray result
  cases, plus two primary snapshot round trips for each subclass method.
- Two comparisons failed: Node passes three arguments to tracking subarray
  constructors, including explicit undefined length; and it accepts an
  out-of-bounds custom subarray result. Adjusted these paths to the executable
  Node oracle, without weakening slice's length/bounds checks. The newer draft's
  TypedArrayCreateFromConstructor bounds rules differ in this edge case.
- Added retained-storage checks inside species constructors and after success or
  throw. All 21 species tests pass; prior broader Float32 cohort passed 213 tests
  before these nine extra cases. TypeScript/lint passed before the latest edge
  changes and need final reruns.
- Full maintained SafeJS unit route is now running with only the unresolved
  Promise-import policy file excluded. Species tests are included again. Log:
  `/tmp/poe-safejs-species-package.log`. Keep its source stable while it runs.

Slice scoped release is confirmed: run 34092831078 published
@poe-platform/safe-js@0.1.317 at 2026-09-07T06:57:55.8145402Z. CLI run
34092831279 remains separately monitored; it was still in progress at the last
poll. The new species harness pair is prepared but has not run yet.

Final full-suite result: 17,890 passed, 41 skipped, 534 passing files and one
skipped file; 284.19 seconds. Species tests were included. Only the separately
tracked unresolved Promise-import policy file was excluded. The source stayed
unchanged throughout this run. No open GitHub issue matched the species search.
Final types/lint and actual harness checks follow before commit and push.

Final TypeScript and scoped ESLint passed. The real harness passed after 70
uncached build tasks (60.233 seconds). Inspected
`screenshots/harness-run-docs-plans-safejs-float32-species.md.png`: Harness passed,
expected copied/shared/trace result fields, no errors and zero agent spawns.
This validates the actual runtime pair, not model behavior.
