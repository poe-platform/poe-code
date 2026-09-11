# HTTP header type-contract validation

## Validation route

Move the real compiler checks from the tiny-mcp-client Vitest test to `scripts/check-http-headers-type-contract.mjs`, exposed through `npm run typecheck:contracts --workspace=tiny-mcp-client`. Append that command to root `lint:types` after the existing root TypeScript and SafeJS contract commands. Root `lint` and `typecheck` include this gate; `npm test` alone no longer runs these four compiler profiles. No workflow or runtime changes are made, and no timeout is increased. This relocation does not claim compilation became faster.

## Preserved contract

The script reads current `src/internal.ts` and extracts the `HttpTransportOptions.headers` property type through the TypeScript AST. It requires both that type and the optional-property question token. The virtual consumer remains under `src`, preserving resolution context. All nine cases remain: five valid and four invalid, across NodeNext/Bundler and Node-only/DOM (36 decisions: 20 acceptances, 16 rejections).

Every profile creates a fresh host and program, freshly reads compiler inputs, and uses strict checking, `skipLibCheck: false`, `exactOptionalPropertyTypes: true`, and full pre-emit diagnostics. Unexpected diagnostics fail before case assertions. The existing document registry keys syntax reuse by compiler settings and implied format; content remains its version key. Each successful acquisition is tracked and released in the outer `finally`, including assertion failure. No compiler mocks or metadata-based caches are added. Profile-start and completion output identify the profile, case count, and elapsed time.

## Evidence

The full maintained run on `999df8d40f8d1d191422b3531cc976f58af08b16` reported both DOM profiles exceeding the unchanged 5s Vitest deadline (NodeNext 7,305ms, Bundler 7,534ms). The run was intentionally interrupted after these concrete failures and remains incomplete. Its log is `/tmp/poe-byte-admission-unit.log`.

The unchanged focused replay passed all four profiles: NodeNext Node-only 1,043ms, DOM 1,133ms; Bundler Node-only 632ms, DOM 880ms. The log and cleanup receipt are `/tmp/poe-http-headers-unchanged.log` and `/tmp/poe-http-headers-unchanged-result.json`. This passing replay does not erase the full-run failures.

Before deleting the original test, external in-memory source substitutions verified five negative controls against its real compiler/assertions: missing headers, required headers, permissive `any`, restrictive `never`, and unresolved `MissingHeaderType`. The same five controls fail the new script at the corresponding assertion: 10/10 expected refusals. Missing/required cases acquire zero documents; each other control acquires and releases 186 documents. Per-path/settings/format balances are zero even on these early failures. The external adapter delegates to the real TypeScript compiler and document registry; it normalizes cross-realm diagnostic arrays only for assertion comparison.

Control driver: `/tmp/poe-http-headers-controls.cjs`. Original source capture: `/tmp/poe-http-headers-original.ts`. Logs: `/tmp/poe-http-headers-original-controls.log` and `/tmp/poe-http-headers-new-controls.log`. Positive full-profile balance checks are recorded separately in `/tmp/poe-http-headers-positive-balance.log`.

Positive controls ran all four profiles against both implementations: each acquired and released 746 documents, with zero outstanding per-path/settings/format balances.

The explicit `npm run typecheck:contracts --workspace=tiny-mcp-client` gate passed (session 3889, exit 0), with profile times 1,281.1ms, 2,845.6ms, 1,053.3ms, and 1,415.2ms. Log: `/tmp/poe-http-headers-gate.log`.

The full maintained `npm run lint:types` chain passed (session 13998, exit 0), including root TypeScript, all four SafeJS filesystem profiles, and all four HTTP header profiles. Header profile times were 1,050.0ms, 1,334.4ms, 670.8ms, and 937.8ms. Log: `/tmp/poe-http-headers-root-types.log`. Both commands used Node 22.23.2 and the established esbuild override; source remained frozen during execution. Independent review approved preservation of the contract and cleanup. Broader lint/unit qualification and delivery remain separate requirements.
