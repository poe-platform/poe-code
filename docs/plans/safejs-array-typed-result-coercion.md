# Typed-array results from array factories and species

## Validated gap

Primitive typed-array results already matched native controls. Object-valued
elements did not: a constructor returning Uint8Array caused Array.from and
Array.of to throw without calling guest valueOf or storing the converted value.
Array.prototype.map showed the same issue through a custom species constructor.

After correcting the controls for operations that explicitly set result length,
20 regression cases failed in the guest: ten array operations with Uint8Array
and BigInt64Array result storage. Native synchronous controls verified conversion
order and the value written before any final read-only length error.

## Implementation

Use the existing typed-array-aware property definition path for typed results
at both array-factory write sites and the shared array-species write site.
It validates the index before invoking guest numeric conversion. Ordinary
array/object writes retain their existing representation and budget accounting.
No limits, descriptor rules or native coercion implementations are relaxed.

The covered operations are from, fromAsync, of, map, filter, slice, concat, flat,
flatMap and splice. Ten additional controls use zero-length result storage to
require TypeError before any element conversion.

## Native control qualification

Native Node 22.23.2 Array.fromAsync converts the element but does not report
the required failure when setting the typed result's read-only length. The
[current algorithm](https://tc39.es/ecma262/multipage/indexed-collections.html#sec-array.fromasync)
requires a throwing length assignment. Its native control therefore qualifies
conversion and stored value only; guest assertions still require TypeError.
The initial synchronous slice/concat/splice expectations omitted their final
length assignment; those expectations were corrected before collecting the
20 guest-failure baseline. No runtime behavior was inferred from those test errors.

## Verification and delivery

The first focused run passes 197 tests across six factory/species/array files,
including the existing Array.from data-budget controls and Proxy-result tests.
The second selection passes 381 tests across five files, including all 30 new
cases, callback mutation, nested reads, creation realms and Proxy species.
All 30 new cases also pass on Node 26.8.1. Package TypeScript no-emit checking
and scoped runtime/test ESLint pass, as does `git diff --check`.
This is not a new full-package gate. Release hold remains active; no push or
release is part of this change. No CLI visual output changes.
