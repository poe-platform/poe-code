---
title: Number-valued typed-array family
---

# Validated absence and implementation

Int8Array, Uint8ClampedArray, Int16Array, Uint16Array, Int32Array, Uint32Array
and Float64Array were absent from the runtime constructor registry and lint
allowlist. Initial differential, host-copy and persistence tests produced
77 failures and seven passing allocation controls (1.95s).

Add these native Number-valued constructors to the existing shared registry.
Do not duplicate methods or introduce per-kind execution branches. The registry
already determines native conversion, element width, intrinsic installation,
typed-array branding, host copies, snapshot kind validation and restoration.
Keep the legacy Float32 snapshot representation unchanged.

Reference: the [ECMAScript typed-array constructor table and shared constructor
structure](https://tc39.es/ecma262/multipage/indexed-collections.html#table-the-typedarray-constructors)
specify distinct element types/widths with shared constructor and prototype
behavior. Number and BigInt content types must remain distinct.

Validation covers numeric wrapping, clamping ties, Float64 precision/NaNs/signed
zero, descriptors, species, subclassing, sorting and change-by-copy methods,
iterators, resizable/detached buffers, mixed buffer aliases across copy/primary
snapshot/replay, actual-width budgets, invalid snapshot dimensions, public
dump/restore, and host transport. Native comparisons run in the host realm so
structuredClone and constructor identities refer to the same realm.

Update legacy global inventories explicitly and move still-unsupported-kind
rejection controls from Float64Array to BigInt64Array. Do not remove the rejection
coverage. Run the maintained SafeJS package suite, narrow lint and TypeScript,
the actual harness pair with screenshot inspection, and older-host probes.

The separately tracked uncommitted host-Promise import-policy probe remains
excluded from this package run, as before; it is not a passing test. This change
does not resolve that policy question or the independent CI camera timeout.

Remaining typed-storage gaps include Float16Array on older hosts, BigInt64Array,
BigUint64Array, DataView, and Uint8Array's concrete hexadecimal/base64 methods.
Some shared diagnostics still name Float32Array and need a separate cleanup.
Push this cohesive family addition as its own commit and monitor publication.

Maintained package unit run completed: 18,646 passed, 41 skipped, 575 passing
files and one skipped file (277.93s). The separate Promise-policy probe was
explicitly excluded as noted above. All 92 new family tests passed, as did the
unchanged camera fixtures, legacy snapshots, adversarial and replay coverage.

TypeScript and ESLint passed. The actual harness passed after 70 uncached
workspace build tasks (60.167s) plus root build stages; its screenshot was
inspected. Node 18.18.0 built-SDK checks passed conversion, sorting and public
dump/restore for all seven new constructors. The harness makes no model calls.

Built-SDK camera measurements: 1625/1759/1367ms, unchanged full traces and step
counts 11794/11206/9957. Peak data was 7294/6683/6072, an increase of 133 units
in each case compared with the preceding build while adding seven constructors.
No budget limits or fixture assertions were relaxed. These local observations
do not establish that the slower shared CI timeout has been resolved.
