# csvgrep user edge QA

Use explicit UTF-8, C locale, UTC and noninteractive bindings with the in-memory
filesystem. No native oracle, network, database or disk fixture is used here.

1. Run `node --import tsx --test packages/safe-bash/tests/commands/csvgrep-user-edge.test.ts`.
2. Compare complete stdout, stderr and status for repeated `-f`: open every
   occurrence, read only the final handle, close every handle once.
3. Combine string, regex and file arguments in different orders. Confirm truthy
   regex wins without reading the file, and an empty regex falls back to file.
4. Put `--help` and `--version` before and after `-f`. Confirm early exits retain
   preceding eager opens but prevent later opens.
5. Filter missing cells with `^$`, duplicated selectors, AND/OR and inversion.
6. Fail an eager `-f` under `-n`; confirm exact parser output and no stdin read.
7. Cancel a pending injected file acquisition. Return its admitted handle after
   cancellation, hold its close and confirm execution waits before rejecting
   with the original cancellation reason.
8. Run ESLint for the owned test; have the integration owner register its exact
   path in the maintained inventory and run maintained workspace gates.

These checks validate 13 concrete in-memory invocations and one cooperative
cancellation workflow. They do not measure full csvkit parity, all regex syntax,
other encodings, deployed filesystem drivers or match-file host implementations.
No product bug was reproduced by these cases; no product source was changed.
