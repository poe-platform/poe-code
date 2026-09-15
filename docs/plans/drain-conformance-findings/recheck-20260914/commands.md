# Reproduction and qualification

Run from repository root on Node 22.23.2 / ICU 78.2. Report paths must be new and absolute. Clean upstream checkout must resolve to 419d3e0a2273ba01a3bfcbec423f2801425b8e93. No fixture edits.

```sh
git fetch origin main
git rev-list --left-right --count HEAD...origin/main
git -C /private/tmp/safejs-binary-test262 rev-parse HEAD
git -C /private/tmp/safejs-binary-test262 status --short
npm run test:conformance --workspace=@poe-code/safe-js -- --corpus /private/tmp/safejs-binary-test262 --enumerate --report /absolute/new/manifest.jsonl
npm run test:conformance --workspace=@poe-code/safe-js -- --corpus /private/tmp/safejs-binary-test262 --manifest /absolute/new/manifest.jsonl --report /absolute/new/full-corpus.jsonl
npm run test:conformance --workspace=@poe-code/safe-js -- --corpus /private/tmp/safejs-binary-test262 --include built-ins/Array/S15.4.5.2_A3_T2.js --include built-ins/Array/fromAsync --report /absolute/new/array.jsonl
npm run test:conformance --workspace=@poe-code/safe-js -- --corpus /private/tmp/safejs-binary-test262 --include annexB/built-ins/RegExp/legacy-accessors --include annexB/built-ins/Array/from/iterator-method-emulates-undefined.js --report /absolute/new/legacy.jsonl
npx vitest run packages/safe-js/src/interp/globals/array-from-async-rejection-identity.test.ts
npx vitest run packages/safe-js/src/interp/globals/array-from-async-rejection-identity.test.ts packages/safe-js/src/interp/globals/array-from-async.test.ts packages/safe-js/src/interp/globals/array-static-proxy-results.test.ts
npx vitest run packages/safe-js/src/interp/async-function-cancellation.test.ts packages/safe-js/src/interp/async-function-driver.test.ts packages/safe-js/src/snapshot/async-function-continuations.test.ts packages/safe-js/src/run.promise-settlement-identity.test.ts packages/safe-js/src/interp/host-promise-settlement-identity.test.ts
npx eslint packages/safe-js/src/interp/async.ts packages/safe-js/src/interp/globals/array-from-async-rejection-identity.test.ts
npx tsc -p packages/safe-js/tsconfig.json --noEmit
```

Actual initial complete attempt exited 130 by deliberate interruption before repair; selected before Array and legacy runs exited 1, after Array exited 0. Enumeration exited 0. Red regression exited 1; green/interactions/lint/types exited 0. Re-run complete corpus after final semantic change and record one manifest/source/runtime; never aggregate across revisions.
