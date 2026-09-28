# Spreadsheet portable SDK bundle QA

Run browser initialization and bundled dependency closure as native QA. Both invoke the native esbuild service and must not depend on a five-second unit setup deadline.

1. Build `safe-bash-command-ssconvert` through its maintained workspace build closure.
2. Read the browser fixture emitted by that maintained build at `packages/safe-bash-command-ssconvert/dist/testing/worker-runtime-fixture.js`. It imports the public SDK and assigns `snapshotRuntimeFunctions({})` to `globalThis.snapshot`; do not rebuild the graph inside a unit test.
3. Execute that bundle in a fresh VM context containing `TextEncoder`, `TextDecoder`, `atob`, `AbortController`, and `AbortSignal`. Do not supply require, process, Buffer, or Node module globals.
4. Verify snapshot is empty and frozen. A Node initialization error or unresolved Node module fails QA.
5. Bundle the public spreadsheet entry with `packages: external`, `platform: node`, `format: esm`, `write: false`, and `metafile: true`. Inspect every external import in every output; strip subpaths to package names, exclude Node built-ins, and verify every package appears in the root dependencies or optionalDependencies. Admit a root package self-import only when its exact subpath is declared in exports. Reject any unavailable private runtime dependency.
6. Keep evidence under `out`, inspect it, and delete only that temporary evidence afterward.
7. Install the actual root/scoped tarballs outside the checkout. Bundle their declared SDK, Shell, filesystem and contract subpaths for the browser without source aliases. Inspect the import graph for private-workspace or Node dependencies. Serve the generated bundles only on loopback, then use a real browser and a dedicated Web Worker for each route. Convert CSV to XLSX and edit it back to CSV; require the exact edited value and unchanged input. Exercise raw argument ownership, explicit output-budget rejection, falsey cancellation and awaited cleanup. Record browser identity, artifact hashes and results; terminate Workers, close the browser session and remove generated bundles after qualification. VM initialization alone does not satisfy this step.
