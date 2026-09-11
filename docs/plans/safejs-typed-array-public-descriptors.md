---
title: Typed array public descriptor replay
---

# Typed array descriptor replay

Validated during Array.from tests: executing a Uint8Array with a custom iterator
property succeeds, but dump(result) throws that guest properties/prototype links
cannot be serialized. Low-level typed-array snapshots already support full
property descriptor state; the public dump route still uses string data entries
and rejects the managed object before reaching that serializer.

Use the existing captureTypedArrayState format in public graph discovery and
serialization, with the existing low-level decoder and validation. Keep backing
buffer identity, metadata cycles, accessor closures, symbol keys, descriptor flags
and extensibility. Do not broaden native accessor or arbitrary proxy admission.

The initial custom-iterator replay regression failed before implementation and
passed afterwards. Additional Float32/Uint8/Float16/BigInt64 replay cases cover
symbol accessors, non-enumerable metadata, cycles and shared backing storage.

This is separate from Array.from ordering. The paired harness validates custom
typed-array metadata through the real runner; unit tests verify public dump/replay.

Pre-delivery checks: 40 focused snapshot/property/dump tests passed across five
files. Focused ESLint, package TypeScript, maintained root lint:types and the new
tests' own type diagnostics passed. Normal npm run build completed all 70 declared
workspace builds and root suffix stages. The real paired harness passed (zero
spawns), and its screenshot was inspected. Node 18 built SDK and public replay
passed. The maintained SafeJS package suite is running with source held fixed;
only the unresolved Promise-import and missing string-iterator probes are
excluded, neither counted as a pass.

Final package validation passed: 19,084 tests passed, 41 optional tests skipped,
597 files passed and one skipped (321.21 seconds). The two explicit exclusions
above remain unfinished probes, not passes. Production sources and the tests in
this delivery were held fixed throughout the run.
