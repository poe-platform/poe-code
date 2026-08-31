# SafeJS Node18 test/runtime compatibility

## Status and scope

Implemented after explicit root ownership authorization. The only production
change is the builtin crypto import for the existing UUID capability. All 27
original focused tests and three new regressions pass on Node18 and Node22.

Exact edited files:

- `packages/safe-js/src/modules/time.ts`
- `packages/safe-js/src/modules/time.test.ts`
- `packages/safe-js/test/integration/input-error-projection.test.ts`
- `docs/plans/safe-js-node18-test-runtime.md`

- Workspace: `/Users/kjopek/Workspace/poe-code-safejs-publish-rename`.
- Baseline: `main`, `7fbbd81fd99c46928bcf314ad89410b946d203cc`.
- Existing dependencies; Node `v18.20.8` and `v22.22.2`.
- Only the two missing-crypto failures and the input-error-projection suite-load
  failure from `out/math-array-validation/node18-safejs.log` were investigated.
- Concurrent Math/Array work, README, array-native oracles, and Math checkpoint
  binding comparisons remain outside this investigation.
- No install, full build, audit-document reads, commits, pushes, or skill sync.
  Diagnostic bundles used esbuild `write: false`; probes used memory and pipes.

## Reproduced baseline

Commands run from the workspace root for baseline and final verification:

```sh
"$HOME/.nvm/versions/node/v18.20.8/bin/node" node_modules/vitest/vitest.mjs run \
  packages/safe-js/src/modules/time.test.ts \
  packages/safe-js/test/integration/input-error-projection.test.ts --maxWorkers=1 --silent

"$HOME/.nvm/versions/node/v22.22.2/bin/node" node_modules/vitest/vitest.mjs run \
  packages/safe-js/src/modules/time.test.ts \
  packages/safe-js/test/integration/input-error-projection.test.ts --maxWorkers=1 --silent
```

| Runtime | Time module | Input-error projection | Duration |
| --- | --- | --- | --- |
| Node18 | 15 pass, 2 fail | beforeAll fails to deserialize child output | 0.95s |
| Node22 | 17 pass | 10 pass | 4.23s |

Vitest reports the ten Node18 projection tests as skipped because their shared
setup failed. No test was disabled or assertion removed. These are baseline
results, not a claim of a green Node18 suite after changes.

## Failures 1 and 2: real UUID runtime defect

At baseline, both failures occurred first in spies at
`packages/safe-js/src/modules/time.test.ts:14` and `:106`, where the tests reference
the unavailable global `crypto`. At baseline,
`packages/safe-js/src/modules/time.ts:64` used the same free global in the
unseeded/default UUID implementation. Importing crypto only in the tests would
move the failures into production code rather than fix the behavior.

An independent unmocked probe bundled the actual time module in memory and
imported it from an ESM stdin process, without setting any globals:

- Node18: `typeof globalThis.crypto === "undefined"`, while
  `typeof webcrypto.randomUUID === "function"` from `node:crypto`.
  `makeTimeModule({ seed: 123 }).uuid()` succeeds, but
  `makeTimeModule().uuid()` throws `ReferenceError: crypto is not defined` at the
  production UUID expression. The child exits 1.
- Node22: the same default UUID assertion passes; the child exits 0.

Minimal production probe that was RED before the import and is now GREEN,
using only existing dependencies and no generated files:

```sh
"$HOME/.nvm/versions/node/v18.20.8/bin/node" --input-type=module <<'JS'
import assert from 'node:assert/strict';
import { build } from 'esbuild';
const compiled = await build({
  entryPoints: ['packages/safe-js/src/modules/time.ts'],
  bundle: true, write: false, platform: 'node', format: 'esm', target: 'node18'
});
const moduleURL = 'data:text/javascript;base64,' +
  Buffer.from(compiled.outputFiles[0].text).toString('base64');
const { makeTimeModule } = await import(moduleURL);
assert.equal(typeof makeTimeModule().uuid(), 'string');
JS
```

### Applied UUID fix

Added `import { webcrypto as crypto } from "node:crypto";` to the authorized
production file and its time test file. Existing spies target the same host
dependency. The call-time property lookup, seeded branch, exact UUID expectations,
and spy call-count assertions remain unchanged. No guest capability, global
polyfill, runtime flag, or Math.random fallback was added.

An in-memory prototype adding that lexical import passed on both versions:
default UUID shape/version/variant, the existing exact mocked UUID with one
call after module creation, and seeded UUID equality against the original
implementation. Node18's global crypto remained undefined. That pre-authorization
prototype made no repository edits; applied-fix validation is recorded below.

## Failure 3: test-only child transport truncation

The failure at
`packages/safe-js/test/integration/input-error-projection.test.ts:251` is downstream
of the child helper's `finish` at line 34. That helper calls
`process.stdout.write(serialize(observation))` and immediately `process.exit(0)`.
It can terminate before the pipe write completes.

The child uses `process.execPath`; producer and consumer are not intentionally
running different Node versions. The fixture files are source text and JSON,
not checked-in V8 byte strings. A diagnostic of the existing capture path showed:

| Child | Serialized bytes | Received bytes | Child-local deserialize | Parent deserialize |
| --- | --- | --- | --- | --- |
| Node18 | 25,835 | 16,384 | pass | Unable to deserialize cloned data |
| Node22 | 25,663 | 8,192 | pass | Unable to deserialize cloned data |

These measurements used a synchronous diagnostic parent to expose the race;
the unchanged asynchronous Vitest parent passed on Node22 in the baseline run.
The exact truncation point is scheduling-dependent. The child reported SafeJS
capture status `ok` and could deserialize its complete payload before emitting it.
This is not evidence of an incompatible V8 fixture or a SafeJS snapshot defect.

### Applied test-helper change

In `packages/safe-js/test/integration/input-error-projection.test.ts` only,
`finish` now awaits the stdout write callback, rejects on write errors, and calls
`process.exit(0)` only after successful completion. Capture, completion, and
error paths await `finish`; the timeout callback uses the same flush helper.
The serialize/deserialize representation and all ten original tests and their
assertions are preserved.

Waiting for the callback without awaiting the capture call is insufficient: it
allows execution to fall through into restore logic and emit a second observation.
A synchronous `writeFileSync(1, payload)` alternative was also rejected after
the diagnostic pipe returned `EAGAIN`. Neither unsuccessful prototype changed
repository files or swallowed its failure.

The correctly awaited in-memory prototype passed capture and raw-input probes
on both versions:

| Runtime / mode | Sent bytes | Received bytes | Observed status |
| --- | --- | --- | --- |
| Node18 capture | 25,835 | 25,835 | ok |
| Node18 raw | 13,766 | 13,766 | error: UnhandledRejectionError |
| Node22 capture | 25,685 | 25,685 | ok |
| Node22 raw | 13,704 | 13,704 | error: UnhandledRejectionError |

Assertions retained actual `Error` instances, reason aliases, native expected
values, and the unchanged left receipt for capture. Raw input still produced
`Unsupported sandbox value at <root>: Error` and no proof requests. No fixture
normalization, serializer replacement, malformed-input reinterpretation, global
polyfill, timeout increase, or runtime-budget change was made.

## TDD and final verification

- Original Node18 RED reproduced: two time tests fail; projection setup fails.
- After adding the test import and UUID regressions, before the production import:
  Node18 time tests have 4 failures and 15 passes. Failures now reach the actual
  runtime UUID expression, including the unmocked UUID and host-error assertions.
- Before the flush fix: Node22 projection tests have 1 failure and 10 passes.
  The new oversized-output test fails with `Unable to deserialize cloned data`.
- New UUID tests exercise actual UUID-v4 generation without Math.random and
  propagate a mocked host UUID error without a Math.random fallback.
- The output regression round-trips a 1 MiB string in the transport envelope,
  checks complete string equality, original values, Error type/reason aliases,
  and zero reissued calls/proof requests. It replays the existing completed
  capture rather than creating a second independent capture. No sandbox fixture
  data, checked-in serialized fixtures, pipe capacity, or buffer limit is changed.

Final focused verification with the two commands above:

| Runtime | Time tests | Projection tests | Total | Duration |
| --- | --- | --- | --- | --- |
| Node18 v18.20.8 | 19 pass | 11 pass | 30 pass, 0 fail, 0 skipped | 5.93s |
| Node22 v22.22.2 | 19 pass | 11 pass | 30 pass, 0 fail, 0 skipped | 5.71s |

Both runs include every original complete/minimal/native-fields projection,
raw-left/genuine-null-left provenance, serialized checkpoint/replay assertion,
and raw-input rejection test. Separate independent review remains pending.
No CLI visual behavior changes; no full build, commit, or push was performed.

Additional checks: Prettier and ESLint pass for the three edited TypeScript files;
the scoped diff and new plan have no whitespace errors. Reproduction:

```sh
node_modules/.bin/prettier --check packages/safe-js/src/modules/time{,.test}.ts \
  packages/safe-js/test/integration/input-error-projection.test.ts
node_modules/.bin/eslint packages/safe-js/src/modules/time{,.test}.ts \
  packages/safe-js/test/integration/input-error-projection.test.ts
git diff --check -- packages/safe-js/src/modules/time{,.test}.ts \
  packages/safe-js/test/integration/input-error-projection.test.ts
```
