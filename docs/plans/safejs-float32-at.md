---
title: Float32Array at
---

# Float32Array at

Candidate next gap after reverse: at is absent from the typed method list.
Reproduce native comparisons before implementation. Cover positive/negative
indices, undefined/fractional/infinite/NaN indices, coercion order and errors,
resize/detach callbacks, ignored shadow length, snapshots and direct calls.

The published [ECMAScript 2026 at algorithm](https://tc39.es/ecma262/2026/multipage/indexed-collections.html#sec-%typedarray%.prototype.at)
validates the receiver and captures length before index coercion. It returns
undefined outside the initial range, and otherwise performs an indexed read;
it does not add a second throwing validation after coercion. Revalidate these
requirements when changing this method. This change is separate from reverse.

Six native comparisons now fail because at is missing, covering ordinary and
relative indices, numeric conversion, callback growth/shrink and shadow length.
RED evidence: `/tmp/poe-safejs-float32-at-red.log` (1.45 seconds). The tests were
added after reverse qualification and before implementation.

Implemented initial typed-receiver validation, guest index conversion and relative
indexing against the captured length, followed by an indexed read without an
extra throwing validation. Added error/resize boundaries, direct getter coercion,
callback detachment, two snapshot round-trips and retention success/failure tests.

Validation: all 372 tests across the 27 Float32Array/ArrayBuffer test files pass
(13.21 seconds), including the 14 at-specific tests. The harness pair checks
initial-length indexing across growth and an undefined read after shrink, with
an await boundary. It requires no agent spawn and makes no claim about model
behavior.

TypeScript and scoped ESLint pass. The actual harness passed after 70 uncached
build tasks (60.207 seconds); its screenshot was visually inspected. The built
SDK also passed a negative-index smoke check on Node 18.18.0.
