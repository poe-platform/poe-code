---
title: Template array integrity
---

# Template array integrity

## Validated gaps

Seven native comparisons demonstrate that cooked and raw template arrays are
mutable and expose writable/configurable element descriptors. Freezing both
arrays makes those comparisons pass.

The initial low-level serialize/restore regression also failed: restored arrays
lost frozen state and non-enumerable `raw`. It now passes using a descriptor-
preserving `guest-array` record; ordinary arrays retain their existing format.

Separately, repeated calls at a single template source site return different
arrays; native JavaScript returns the same template object. Identity requires
realm/source-site ownership and snapshot handling, not a process-global cache.

## Next implementation requirements

- Preserve array descriptors, non-enumerable data and extensibility without
  invoking getters during serialization.
- Preserve cooked/raw aliasing and validate descriptor flags, array length and
  element bounds before restoration mutates any value.
- Account for both low-level snapshots and the public dump/replay path: both
  use `snapshot/arrays.ts`, through `serialize.ts` and `dump-format.ts`.
- Include non-enumerable referenced values in graph discovery; currently the
  generic array traversal uses `Object.values` and misses `raw`.
- Maintain compatibility for existing plain-array snapshots and fixtures.
- Add corruption, aliasing and resource-accounting regressions before delivery.

## Implementation and current evidence

Descriptor arrays reuse the guest graph and property codec, preserving data,
guest accessors, symbol keys, aliases, cycles, custom prototypes and extensibility.
Graph discovery now sees their non-enumerable values through descriptor capture.
Native host accessors remain on the existing host-exclusion path.

Validation rejects missing/invalid length descriptors, out-of-bounds indices,
duplicate keys and lengths above allocation limits. Descriptor preflight uses
a real array so native array length invariants apply. Restore sets the prototype
before freezing; a separately failing frozen-prototype regression now passes.

Nine template tests pass, including low-level restoration and public dump/replay.
Eleven array snapshot tests pass, including allocation limits and frozen custom
prototypes. The first full package run exposed two obsolete rejection tests and
one real host-accessor compatibility regression; all 77 focused compatibility
tests pass after correction. The final full package run passed 15,351 tests
with 41 existing skips (430 passing files and one skipped file). Final types,
focused lint and the maintained selected-workspace build passed, including four
built-import checks. The CLI harness passed with zero spawns; its screenshot
was inspected and showed no warnings or errors.
Existing user-staged Safe Bash changes are untouched.

## Visual QA

Run `npm run screenshot-poe-code -- harness run
docs/plans/safejs-template-array-integrity.md` and inspect the screenshot. Expect
a passed harness, no warnings and zero spawns. The pair asserts frozen cooked
and raw arrays and a rejected raw-element mutation. It grants no capabilities.
The unit tests separately establish low-level restoration and public replay;
this CLI smoke check is not a substitute for those tests.
