# Spreadsheet portable SDK bundle QA

The public dependency boundary remains a unit check. Run full browser bundle initialization as native QA rather than a five-second unit setup deadline.

1. Build `safe-bash-command-ssconvert` through its maintained workspace build closure.
2. Read the browser fixture emitted by that maintained build at `packages/safe-bash-command-ssconvert/dist/testing/worker-runtime-fixture.js`. It imports the public SDK and assigns `snapshotRuntimeFunctions({})` to `globalThis.snapshot`; do not rebuild the graph inside a unit test.
3. Execute that bundle in a fresh VM context containing only `TextEncoder`, `TextDecoder`, and `atob`. Do not supply require, process, Buffer, or Node module globals.
4. Verify snapshot is empty and frozen. A Node initialization error or unresolved Node module fails QA.
5. Keep evidence under `out`, inspect it, and delete only that temporary evidence afterward.
