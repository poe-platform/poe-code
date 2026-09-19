# Independent in2csv fixed user stress QA

## Reference and scope

Use the released csvkit 2.2.0 fixed input reference in
`docs/csvkit/in2csv-fixed-reference.json`, bound to source SHA-256
`147318a8dbaec07c0bbb9291c14b78de5fa32ed3d4a5c2396e52a83c0a30df6b`
and profile `darwin-cpython-3.14.2-csvkit-2.2.0`.
Retain `PYTHONIOENCODING=utf-8` for replay: this affects the default encoding
name in exact diagnostics. Canonical tests inject codecs/compression and use
only the in-memory filesystem. No native comparator is run by these tests.

## Procedure

1. Run `node --import tsx --test packages/safe-bash/tests/commands/in2csv-fixed-user-edge.test.ts`.
2. Verify every frozen case through the public Shell and registered original
   executable name, with exact stdout, stderr and status comparisons.
3. Check schema/data bytes and exact root directory inventory after every case.
4. Cover borrowed CR/NUL input, named NUL removal, ignored inference/header/
   line-number/delimiter settings, BOM output, skip-lines, multiline schema
   diagnostics, empty input/schema fields, oversized integer diagnostics,
   invalid encoding even in skipped lines, gzip schema input and Latin-1 input.
5. Close the owned stdout consumer during its header write. Verify the original
   closure reason escapes, no diagnostic prints, borrowed data is not acquired,
   the caller signal remains live, and registered cleanup completes.
6. Mutate the borrowed producer's 8192-byte buffer on its following pull.
   Verify all 4096 original fixed rows survive and iterator return occurs once,
   including after explicit registered cleanup replay.
7. Root integration owner registers the new literal test path in
   `packages/safe-bash/scripts/integration-inputs.test.mjs` and runs the maintained
   integration/build/type/lint checks appropriate to the complete change.

## Observed result

On September 18, 2026 the direct focused run passed 16/16 tests. No product
defect was validated by this cohort. The first harness run had three failures:
one omitted the frozen encoding environment, and two compared a Buffer prototype
with a Uint8Array despite identical bytes. The harness now preserves the profile
and compares owned Uint8Array fixture bytes. Those harness failures are not
reported as product regressions.

This is scoped public-command and cooperative stream evidence. It does not
establish all csvkit command parity, all possible integer/slicing cases, other
compression formats, unavailable codecs, database or deployed-backend behavior,
interactive behavior, or a full repository release gate. Unsupported and
unmeasured capabilities remain blockers rather than passes.
