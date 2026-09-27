# Spreadsheet portable SDK bundle QA

Run browser initialization and bundled dependency closure as native QA. Both invoke the native esbuild service and must not depend on a five-second unit setup deadline.

1. Build `safe-bash-command-ssconvert` through its maintained workspace build closure.
2. Read the browser fixture emitted by that maintained build at `packages/safe-bash-command-ssconvert/dist/testing/worker-runtime-fixture.js`. It imports the public SDK and assigns `snapshotRuntimeFunctions({})` to `globalThis.snapshot`; do not rebuild the graph inside a unit test.
3. Execute that bundle in a fresh VM context containing only `TextEncoder`, `TextDecoder`, and `atob`. Do not supply require, process, Buffer, or Node module globals.
4. Verify snapshot is empty and frozen. A Node initialization error or unresolved Node module fails QA.
5. Bundle the public spreadsheet entry with `packages: external`, `platform: node`, `format: esm`, `write: false`, and `metafile: true`. Inspect every external import in every output; strip subpaths to package names, exclude Node built-ins, and verify every package appears in the root dependencies or optionalDependencies. Reject any unavailable private runtime dependency.
6. Keep evidence under `out`, inspect it, and delete only that temporary evidence afterward.
