---
title: Float32Array constructor inputs
---

# Float32Array constructor input completeness

Read-only isolated native/SafeJS comparisons reproduced three gaps while the
separate Float32Array.from factory was in full-suite validation:

- `new Float32Array({0:2,1:4,length:2})`: native storage `[2,4]`, SafeJS throws.
- An array `[2,4]` with a custom iterator yielding `7`: native storage `[7]`,
  SafeJS ignores the iterator and keeps `[2,4]`.
- A custom iterable yielding `2,4`: native storage `[2,4]`, SafeJS throws.

Add failing native-oracle tests before implementation. Cover iterable versus
array-like paths, source getters and their order, primitive length conversion,
object wrappers, numeric conversion hooks, abrupt iteration and allocation
limits. Preserve the native typed-array-copy path (including ignored iterator
overrides on a typed-array source), subclass/newTarget prototype semantics,
storage alias/copy contracts, byte accounting, snapshots and legacy constructor
restoration. Consult the constructor algorithm before assuming prototype lookup
or conversion order. Other typed arrays, buffer APIs and species behavior remain
separate incomplete work. No constructor-input implementation changes yet.

The initial nine-case native-oracle suite reproduces seven failures and keeps
two passing controls: primitive string length and typed-array copying that ignores
an overridden source iterator. Failing cases also cover boxed-number inputs,
length/index getter order and iterable collection before numeric coercion.
Log: `/tmp/poe-safejs-float32-constructor-inputs-red.log`.

The preceding from-factory improvement is verified on remote main at
dc236fb440b3e0bec5e77775a32a2dc2e6464b98. Monitor CLI run 34087001771 and scoped
package run 34087001545 while proceeding here. Parser CLI run 34086222555 was
also live at the last check; its scoped SafeJS 0.1.310 publication is confirmed.

## Implemented input paths, qualification in progress

Native-graph construction now routes non-typed-array objects through guest
iterator/property reads and numeric coercion. Iterable input is collected before
conversion; array-like length is read/coerced once before indexed reads. The
legacy constructor route and typed-array storage-copy path remain unchanged.
Collected values, current input and allocated storage stay retained until the
operation completes or throws. Original nine-case native probes now pass.

Expanded comparisons cover invalid iterator methods, inherited indices, mutable
length getters and subclass fields. The installed native runtime reads the
prototype even before rejecting invalid primitive lengths; SafeJS matches that
observable order, so no speculative primitive-order change was made based on the
newer draft algorithm. Reference reviewed:
https://tc39.es/ecma262/multipage/indexed-collections.html#sec-typedarray .

Two-round snapshots preserve constructor input accessors and subclass identity.
Retention probes verify 10KB collected objects survive through numeric conversion
and release on normal return/throw. These tests and the unchanged camera tests
passed; the only failure in that cohort was the older test requiring array-like
rejection. Its expectation now reflects the validated supported input. Log:
`/tmp/poe-safejs-float32-constructor-expanded.log` (49 passes, one old expectation).
Full SafeJS qualification is running at
`/tmp/poe-safejs-float32-constructor-package.log`, with only the separate two-case
host-Promise policy audit excluded. No constructor-input commit/push yet.

Parser CLI run 34086222555 finished green but explicitly skipped publication:
its main checkout was behind remote main (05:29:48 UTC log). Do not count it as
a CLI release. Current from-factory release runs remain 34087001771/34087001545.

## Qualified delivery

The full SafeJS suite passed 17,754 tests with 41 skips (521 passing files,
one skipped) in 244.35 seconds, with only the separate two-case host-Promise
policy audit excluded. Scoped lint and TypeScript passed. The selected build
passed 23 workspace tasks and four native-ESM checks. The actual constructor
harness passed after 70 uncached CLI build tasks (58.049 seconds); its screenshot
was opened and visually verified:
`screenshots/harness-run-docs-plans-safejs-float32-constructor-inputs.md.png`.

No matching open GitHub issue was found. This atomic constructor improvement is
ready for commit/push, with remote delivery/publication verified separately.
The preceding from-factory improvement published as @poe-platform/safe-js@0.1.311
in run 34087001545; CLI run 34087001771 remains monitored. Read-only probes also
confirmed the next set-method input gaps, recorded separately before fixing them.
