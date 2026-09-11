---
title: Float32Array property definition conversion
---

# Float32Array property definition conversion

Independent follow-up to indexed assignment: defineDataProperty in object-array
still uses primitive-only float32Number. Validate Object.defineProperty,
Object.defineProperties and numeric class fields before implementing.

Unlike assignment, definition must validate the index and descriptor before
coercing its value. Preserve ordinary property and class-field paths and resource
budgets; retain targets through guest conversion. Do not conflate host import
accessor rejection with guest numeric coercion.

Validated before implementation: five native comparisons fail and one invalid
index control passes (2.47 seconds). Failures cover defineProperty,
defineProperties, thrown conversion, shrink during conversion and numeric class
fields. Published 2026 section 10.4.5.4 checks the current index, configurable,
enumerable, accessor and writable restrictions before calling TypedArraySetElement.
https://262.ecma-international.org/17.0/#sec-typedarray-defineownproperty

Implemented validation without an element write using the descriptor's non-value
attributes, followed by retained guest ToNumber and TypedArraySetElement behavior.
Propagated awaiting/context through defineProperty, defineProperties, class-field
initialization and the object accessor-definition caller. Ordinary definitions
retain their existing synchronous implementation.

Verification: 19 property-definition tests pass. All 1,357 selected tests across
63 files pass (30.84 seconds), including Float32/ArrayBuffer, classes, accessors,
descriptors, subclasses and class/descriptor snapshots. Package TypeScript and
exact-file ESLint pass. Real harness passed after 70 uncached build tasks (58.7
seconds); its PNG was inspected. Zero spawns validates runtime/schema, not model
behavior. Built SDK Node 18.18.0 confirms defineProperty conversion and numeric
class-field ordering. No matching open issue found. ArrayBuffer.detached remains
a separately validated next gap, not included here.
