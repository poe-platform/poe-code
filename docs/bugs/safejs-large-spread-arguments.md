# Agent Script Large Spread Operations Leak Host Argument Limits

## Provenance

- [Bun #11734](https://github.com/oven-sh/bun/issues/11734)

## Problem

The interpreter uses native JavaScript spread while collecting call arguments
and while implementing `Array#push` and `Array#unshift`. Large sandbox arrays can
therefore exceed the host engine's function-argument ceiling and throw a host
`RangeError`, even when the sandbox budget allows the array.

Relevant paths:

- `packages/safejs/src/interp/interpreter.ts`
- `packages/safejs/src/interp/methods/array.ts`

## Reproduction

```js
const target = [];
target.push(...values);
return target.length;
```

With an injected `values` array of roughly 150,000 elements and an unlimited
array budget, expected behavior is a successful length result or a typed sandbox
budget error. Current native spread sites can instead throw a host-dependent
`RangeError`.

## Required Behavior

- Replace native variadic spread in interpreter-owned collection paths with
  iterative copying.
- Check sandbox array/allocation budgets during copying.
- Preserve holes, ordering, and mutation return values.
- Apply the same rule to call-argument collection, `push`, and `unshift`.

## TDD

Add failing tests with large injected arrays rather than giant source fixtures.
Cover a normal spread call, `push`, `unshift`, and budget exhaustion.
