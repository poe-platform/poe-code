# Typed-array species argument-count delivery

On fetched remote source plus qualification commit
`d45c2826c3e1a8951d68ff6f9891cf07706c349d`, the unchanged pinned numeric
subarray fixture fails both modes with three species arguments instead of two.
`upstream-red.jsonl` records the exact source hash, harness hashes and outcomes.
Node 22.23.2 / ICU 78.2 / V8 12.4.254.21-node.56, Darwin arm64.
ECMA-262 edition 16 §23.2.3.30 step 15 requires two arguments when length tracks
and end is undefined. The edition/extension target is unchanged.

The focused regression fails six cases and passes six before repair. The
production change omits the third argument only for tracking subarrays; fixed
length and explicit-end views still pass three. Existing candidate tests and
repair were reproduced independently in the separate delivery checkout, without
committing unrelated working changes from the original checkout.

The first broader run passes 50 tests and fails one existing Node-oracle test:
Node22 supplies a third undefined argument contrary to the pinned edition.
That exact program is retained with explicit expected trace `[[2,true,4]]` and
post-resize length `3`; no assertion or resize check was discarded. Final focused
run passes 51/51. Broader typed-array/buffer controls pass 1,042/1,042, zero skips.
Targeted ESLint passes. tests.json preserves all four counts, including failures.

Commands from the delivery checkout:

```sh
npx vitest run packages/safe-js/test/integration/exotic-subarray-species.test.ts
npx vitest run packages/safe-js/test/integration/exotic-subarray-species.test.ts packages/safe-js/src/interp/float32-species.test.ts packages/safe-js/src/interp/globals/buffer-sdk-species-proxy.test.ts
npx vitest run packages/safe-js/src/interp/float32 packages/safe-js/src/interp/typed-array packages/safe-js/src/interp/globals/numeric packages/safe-js/src/interp/globals/buffer packages/safe-js/test/integration/exotic-subarray-species.test.ts
npx eslint packages/safe-js/src/interp/globals/numeric-typed-array.ts packages/safe-js/src/interp/float32-species.test.ts packages/safe-js/test/integration/exotic-subarray-species.test.ts
npm run test:conformance --workspace=@poe-code/safe-js -- --corpus /tmp/safejs-exotic-test262 --report /tmp/exotic-subarray-repaired-upstream.jsonl --include built-ins/TypedArray/prototype/subarray/speciesctor-get-species-custom-ctor-invocation.js --include built-ins/TypedArray/prototype/subarray/BigInt/speciesctor-get-species-custom-ctor-invocation.js
```

Use fresh report paths. Test262 revision remains
419d3e0a2273ba01a3bfcbec423f2801425b8e93. Repaired upstream results: two BigInt
passes, two numeric worker-wall-timeouts, zero unsupported/metadata/execution
errors. Numeric execution progresses past the former argument-count assertion;
its complete success is not established. Broad tests overlapped this upstream
run; that context does not excuse or relabel the failures. The deadline remains
3,000 ms. This fixes a validated semantic defect, but task acceptance remains
open for the numeric timeout and the ledger's other runtime/category gates.
No limits, accounting roots, supported runtimes or host authority were changed.
No visual CLI behavior changed. Full build/release receipts are recorded
separately after observing the required workflows and registry.
