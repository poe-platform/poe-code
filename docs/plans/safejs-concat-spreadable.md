---
title: Concat spreadability protocol
---

## Validated gap

Native differential tests exposed ten failures in concat spreadability: SafeJS
ignored Symbol.isConcatSpreadable, including opt-in array-like objects, opt-out
arrays, getter ordering, sparse inherited entries, and length coercion.

## Implementation and validation

Read the spreadability symbol once, default only undefined to array detection,
and use the maintained array-like view for length snapshots and sparse copying.
Preserve data limits and retained values. Validate native comparisons, maintained
SafeJS unit tests, scoped lint, TypeScript, selected build and the paired CLI
harness. Explicit array prototype support is a separately committed prerequisite.

## Remaining gaps

ArraySpeciesCreate and complete intrinsic prototype graphs remain unfinished;
supporting this protocol does not establish complete concat conformance.
