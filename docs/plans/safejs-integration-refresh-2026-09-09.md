# SafeJS integration refresh after Promise Proxy fixes

## Evidence boundary

Started at source HEAD `d833e4fb8` on Node v22.23.2. This is the current working
tree, including uncommitted weak-collection experiments and host-Promise import
tests, not an isolated committed-tree candidate. Existing unrelated staging is
preserved. Pushes and releases remain paused.

Fingerprint of sorted paths and file contents under packages/safe-js/src and
packages/safe-js/test before the gate:
`a2fb7560b09e895fb7c4b3f9fb5a6fa8fa11fc4f8b2d07d502da2f034967f5ef`.
This fingerprint identifies those source/test inputs, not the entire toolchain
or dependency closure. Do not change these inputs while the gate runs.

Commands:

```sh
npm run build:workspaces -- --workspace=@poe-code/safe-js
npm run test:unit --workspace=@poe-code/safe-js -- --reporter=default
```

The declared closure passed 23 builds and all four fresh-process import checks.
Unit session 18637 terminated with exit 1: 23,769 passed, two failed, and 37
skipped tests across 906 files (904 passed, one failed, one skipped). Duration:
702.58 seconds. The source/test fingerprint was identical after termination.

Both failures are in promise-import-properties.test.ts: the imported Promise
lacks the explicit label descriptor and the explicit user-symbol value 42.
The other five failures from the earlier integration gate are no longer present.
This is still a failing package gate, not a root-workspace test or lint pass.

## Additional read-only probes against the fresh build

- Proxy-valued own constructor and species getters match native results: 1 and
  [true, 2], respectively. The latter verifies actual custom subclass selection.
  These probes do not validate every SDK context-free accessor path.
- Public deepCopyFromSandbox copies a returned object Proxy and array Proxy as
  empty objects; a nested Proxy becomes an empty nested object. This independently
  confirms loss at the public data-copy boundary, not merely the appearance of
  an internal carrier when printed. Do not unwrap targets and bypass traps as a
  substitute for a defined host-boundary contract.
- WeakRef, FinalizationRegistry, SharedArrayBuffer, and Atomics are present in
  native Node v22.23.2 but absent from SafeJS. Proxy, eval, Function, WeakMap,
  WeakSet, and Iterator bindings exist in both. The weak collections are still
  experimental working-tree changes. Binding presence is not conformance proof.
- Float16Array, DisposableStack, and AsyncDisposableStack bindings exist in
  SafeJS but not in this Node version; their absence from this native control
  says nothing about SafeJS correctness.

The host-Promise import policy is still unresolved. See
safejs-host-promise-import-policy.md for the private-symbol isolation concern.
Full JavaScript compatibility remains unproven and unfinished.
