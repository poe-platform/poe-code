# Constructor reentrancy qualification, 2026-09-13

Task acceptance remains open. Seven new independent literal-trace controls pass
on both the existing working candidate and fetched remote-main source. They cover
argument-list getters revoking or replacing newTarget's prototype, constructor
validation before argument reads, abrupt argument reads before trap lookup,
multiply bound constructors, self-revoking hasInstance lookup and derived object
returns with revoked newTarget. Each control also executes in a separate native
VM realm without injected host authority. No production code changed.

The compatibility target remains ECMA-262 edition 16 (June 2025), ECMA-402 edition
12 and the evidence ledger's explicitly tracked newer APIs. Controlling algorithms
include ECMA-262 10.2.2, 10.4.1.2 and Reflect.construct (28.1.2). The attempted web
fetch of the published specification exceeded the tool response-size limit;
existing pinned specification receipts remain authoritative. Native controls do
not redefine the target.

Source provenance is in receipt.json. Original candidate HEAD is
33fde231ac697685bce3a353d0bbae4f002c859b, with runtime hash
88a0352b98cd5d377ebca117613126187348eef5ff90b9b21022b7d238e185df.
Original and fetched remote histories diverge 20/47 commits. A separate local
clone on main at f7026625e77f32471f7219feee8e2d1d5dc52b58 tests and delivers only
this test addition and evidence; unrelated staged and working changes in the
original checkout are untouched. Node 22.23.2 / ICU 78.2 / V8
12.4.254.21-node.56, Darwin arm64. The original candidate's 65 focused tests pass;
the clean remote-base checkout's 155 focused tests pass, zero failures/skips.
Targeted ESLint passes. No visual CLI behavior changed.

## Reproduction

From the repository root, after npm ci and generated Intl data setup:

```sh
node packages/safe-js/scripts/numberformat-data.mjs
npx vitest run packages/safe-js/src/interp/guest-proxy-construct.test.ts packages/safe-js/src/interp/guest-proxy-instanceof.test.ts packages/safe-js/src/interp/function-bound-snapshot.test.ts packages/safe-js/src/interp/ordinary-constructor-realm.test.ts packages/safe-js/src/interp/construction-state.test.ts packages/safe-js/src/interp/globals/reflect.test.ts packages/safe-js/test/integration/exotic-constructor-reentrancy.test.ts
npx eslint packages/safe-js/test/integration/exotic-constructor-reentrancy.test.ts
npm run test:conformance --workspace=@poe-code/safe-js -- --corpus /tmp/safejs-exotic-test262 --report /tmp/exotic-current-33fde231.jsonl --include built-ins/TypedArray/prototype/subarray/speciesctor-get-species-custom-ctor-invocation.js
```

The last command was executed only on the original dirty candidate. Use a fresh
report path: existing output is not overwritten. Pinned Test262 revision is
419d3e0a2273ba01a3bfcbec423f2801425b8e93. upstream.jsonl preserves source and
harness hashes, settings and individual results: zero passes, two failures,
zero unsupported/errors. Both modes fail with worker-wall-timeout at the
unchanged 3,000 ms deadline. This is not a newly introduced test failure or a
pass; it remains an unresolved acceptance blocker. Retained-data accounting
review did not establish a safe optimization, so no roots or budget checks were
removed. No timeout, runtime requirement, assertion or support policy changed.

An initial remote test command named two nonexistent files alongside the new
file; its seven passes are not represented as broader coverage. The corrected
command above selected seven real files and passed 155 tests. No full package,
other-runtime, full pinned category or installed-artifact gate is claimed from
these local checks. Prior Node18 resizable-buffer gaps and broader pinned
timeouts remain open. Capability boundaries are not ECMAScript defects.

## Delivery

This bounded qualification is deliverable independently of full task acceptance.
Local commit, verified remote ancestry, workflow conclusions and publications
will be recorded separately after their actual observation. No associated issue
was supplied. Recovery for the outstanding task is to repair the retained-data
performance failure without changing the corpus/deadline, rerun the complete
pinned selection and supported runtime matrix, then validate installed artifacts.
