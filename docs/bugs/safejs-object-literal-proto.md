# Agent Script Misinterprets Object-Literal `__proto__:` Syntax

## Provenance

- [Bun #2889](https://github.com/oven-sh/bun/issues/2889)

## Problem

SafeJS creates null-prototype sandbox objects, but it treats every
non-computed object-literal key as an ordinary own data property. ECMAScript
gives `__proto__:` special object-literal semantics; it must not create an own
`__proto__` property. Computed `["__proto__"]` remains an ordinary property.

## Reproduction

```js
return [
  { __proto__: null }.__proto__,
  Object.hasOwn({ __proto__: null }, "__proto__"),
  { ["__proto__"]: null }.__proto__,
  Object.hasOwn({ ["__proto__"]: null }, "__proto__")
];
```

Expected for the sandbox model: `[undefined, false, null, true]`.

Current: the first object receives an own `__proto__` data property.

## Required Behavior

- Distinguish non-computed `__proto__:` from computed and shorthand properties.
- Do not expose host prototype chains or weaken null-prototype sandbox objects.
- For `null` and primitive values, omit the own property according to the chosen
  sandbox-compatible subset semantics.
- Preserve computed `["__proto__"]` as a safe own data property.

## TDD

Add table-driven interpreter tests for null, primitive, computed, shorthand, and
spread interactions before changing object-literal evaluation.
