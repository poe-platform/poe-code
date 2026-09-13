# Foreign Array intrinsic species delivery

Base source `19df5532d28b8c9e3e48dbecdb09894f530df2f5`, Node 22.23.2 /
ICU 78.2 / V8 12.4.254.21-node.56, Darwin arm64. The target remains ECMA-262
edition 16 / ECMA-402 edition 12 and separately pinned newer APIs. ECMA-262
§10.4.2.3 requires ignoring a foreign realm's intrinsic Array constructor before
reading species. The current realm default must allocate the result.

Seven fast regressions fail before repair, one same-realm control passes.
The repair from the original local candidate was independently reproduced and
applied in the fetched remote-main delivery checkout. It identifies the actual
intrinsic and its realm; a proxy or ordinary constructor remains observable.
Controls exercise slice, map, filter, concat, flat, flatMap and splice, including
throwing foreign species, proxy wrapping, repeated snapshots and overwritten
same-realm global bindings. Independent native realms agree with the explicit
expected results. No host objects or callbacks are injected into those realms.

Final focused checks: 106/106 pass; broader array checks: 1,141/1,141 pass,
zero failures/skips; targeted ESLint passes. Both strict and sloppy modes of the
pinned Array fixture pass. upstream.jsonl records exact runtime/source/harness
hashes, command, 3,000 ms deadline and outcomes. Test262 revision remains
419d3e0a2273ba01a3bfcbec423f2801425b8e93. Budgets, assertions, timeouts, supported
runtimes and host authority are unchanged. No visual CLI behavior changed.

Commands from the delivery checkout:

```sh
npx vitest run packages/safe-js/test/integration/exotic-species-realm.test.ts
npx vitest run packages/safe-js/test/integration/exotic-species-realm.test.ts packages/safe-js/src/interp/methods/array-species.test.ts packages/safe-js/src/interp/methods/array-species-creation-realm.test.ts packages/safe-js/src/interp/guest-proxy-array-species.test.ts
npx vitest run packages/safe-js/src/interp/methods/array packages/safe-js/src/interp/guest-proxy-array packages/safe-js/src/interp/globals/array packages/safe-js/test/integration/exotic-species-realm.test.ts
npx eslint packages/safe-js/src/interp/methods/array.ts packages/safe-js/test/integration/exotic-species-realm.test.ts
npm run test:conformance --workspace=@poe-code/safe-js -- --corpus /tmp/safejs-exotic-test262 --report /tmp/exotic-array-repaired-upstream.jsonl --include built-ins/Array/prototype/slice/create-proto-from-ctor-realm-array.js
```

Use a fresh report pathname. Broader tests overlapped the pinned replay; both
passed. Full task acceptance remains open: the numeric subarray deadline,
full-category/runtime qualification and other ledger blockers are not cleared
by this bounded semantic repair. Local/remote commit and publication observations
are recorded separately after verification. Original unrelated staged/local
changes remain preserved.
