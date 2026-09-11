---
title: Float32Array includes
---

# Float32Array includes

The method was absent. Eight native comparisons failed before implementation
(two error-only controls happened to pass): 1.16 seconds, recorded in
`/tmp/poe-safejs-float32-includes-red.log`.

Follow the published [ECMAScript 2026 algorithm](https://tc39.es/ecma262/2026/multipage/indexed-collections.html#sec-%typedarray%.prototype.includes):
validate the typed receiver, capture length, return false immediately if empty,
convert fromIndex, and search that initial range using SameValueZero. Search
values are not coerced. Callback-induced shrink or detachment can expose
undefined indexed values; there is no second throwing receiver validation.

The implementation uses guest numeric conversion, the existing relative-index
helper, per-element step accounting, and retained receiver/arguments across
conversion and search. This is separate from other missing typed-array methods.

Tests cover NaN and signed zeros, index boundaries, ignored search coercion,
empty arrays, growth/shrink, initially invalid receivers, subclass inheritance,
direct getter calls, detachment, two snapshot round-trips, and storage retention
on success, conversion failure and step exhaustion.

The harness pair checks NaN matching and shrink during index conversion with an
await boundary. It makes no agent calls and does not test model behavior.

Qualification: 388 tests across 28 buffer/Float32 files passed (15.91 seconds).
An additional non-rounding search-value control brings the focused includes file
to 17 passing tests (1.51 seconds). TypeScript and scoped ESLint pass. No matching
open GitHub issue was found.

The real harness passed after 70 uncached build tasks (59.63 seconds); its
screenshot was visually inspected. The built SDK passed NaN and non-rounding
search checks on Node 18.18.0.
