---
title: URI encoding and decoding globals
---

## Validated gap

Eight initial tests failed because encodeURI, encodeURIComponent, decodeURI and
decodeURIComponent were absent. URIError was added in the preceding atomic change.

## Implementation

Install the four pure conversions as sandbox functions. Apply sandbox string
coercion, charge input work and bound produced strings. Use the native conversion
algorithms, preserving reserved-character distinctions and malformed-input errors.
Expose function names, arity and ordinary function properties without constructor
behavior. Existing intrinsic registration preserves their checkpoint identities.

## Verification

- All 76 URI cases pass: reserved characters, supplementary Unicode, primitive
  and object coercion, symbols, malformed UTF-8, lone surrogates, function metadata,
  non-constructibility, budgets, and pending/completed checkpoints with mutations.
- Legacy checkpoint comparisons explicitly include the new globals without
  modifying their captured fixtures or weakening the graph comparison.
- Register standalone URI functions with the shared intrinsic-state tracker, so
  materializing unchanged metadata does not invalidate in-memory checkpoints.
  URI and Map/Set replay checks pass together (124 cases).
- Maintained package tests pass: 15,926 passed and 41 skipped. Scoped lint,
  TypeScript and the selected workspace build pass.
- The real harness passes with zero spawns; its CLI screenshot was inspected.

## Next validated gap

JSON.parse ignores its reviver argument. A probe parsing an x value of 1 with a
reviver that increments x returns 1 in SafeJS and 2 natively. Reviver traversal,
deletion, receiver binding and context semantics need a separate implementation;
they are not changed by this URI addition.
