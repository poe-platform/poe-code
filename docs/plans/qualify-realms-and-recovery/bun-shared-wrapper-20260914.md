# Bun shared-wrapper recovery repair — 2026-09-14

The native Bun 1.3.11 `structuredClone(SharedArrayBuffer)` returns an ordinary
ArrayBuffer and loses shared storage. That caused all ten documented shared-graph
recovery paths to fail before reaching the host operation. A same-thread native
MessageChannel produces the required distinct SharedArrayBuffer wrapper while
preserving the underlying storage, including growability.

## Source and compatibility

This independent repair starts from delivered RR-8
`5ad2344edc13cd11508cb0b4cee1828c8b9e2c26`. The integrated source/commit receipt
follows after reconciliation with the jobs-v9 delivery. The original dirty main
checkout is preserved; only this exact patch is mirrored into it, retaining its
unrelated shared-buffer receipt implementation and original staging.

Node 22.23.2 / ICU78.2 / Darwin arm64 is the local test host. The language target
remains ECMA-262 edition 16 / ECMA-402 edition 12 (June2025), Test262
`419d3e0a2273ba01a3bfcbec423f2801425b8e93`, with the separately tracked Temporal
pin `e8cc03fc970a65a3359e8870e3b35e687ac94e55`. This is a host transport defect,
not a missing language capability by design.

## Repair and TDD

Three regression cases first fail on zero, four and 65,536-byte shared storage;
the native fast-path control passes. A bounded, private one-byte capability probe
now checks the native clone's brand, wrapper identity and actual storage aliasing
once at module initialization. Correct hosts retain the captured native fast path.
An inadequate clone selects the captured native MessageChannel path; each call
closes both local ports in `finally`. No worker is spawned and no guest capability
or external IO authority is added. Guest storage is not passed to a broken native
clone before fallback, and is never temporarily mutated to test support.

The existing owned-storage map and allocation accounting are retained. Input native
brand checks and native postMessage avoid arbitrary constructor/property getters.
Workerd retains its direct native structured-clone path through the existing
platform import condition; its bundle does not gain node:worker_threads.

The first post-repair run exposed Vitest's object matcher reading the deliberately
poisoned constructor while comparing identity. The assertion now compares the
identity expression as a boolean, preserving the exact distinct-wrapper requirement
and zero-getter assertion. This diagnostic failure remains in the logs. Broader
selection then exposed three Worker-only module mocks missing MessagePort exports.
Those mocks now retain the module's real non-Worker APIs; worker scheduling,
rollback/cancellation assertions and timeouts are unchanged.

Eight focused fallback controls pass, covering lost brand, disconnected shared
storage, same-wrapper clone, native clone throwing, zero/large buffers, two-way
aliasing, no getters and shared growth. The shared-buffer/atomic-wait selection
passes **172 tests / zero failures / zero skips in 17 files**. No assertion,
budget, runtime support or timeout was weakened.

## Reproduction

```sh
npm run build:workspaces -- --workspace=@poe-code/safe-js
CI=1 npx vitest run packages/safe-js/src/platform/shared-buffer-clone.test.ts packages/safe-js/src/interp/shared- packages/safe-js/src/interp/atomic-wait.test.ts packages/safe-js/src/snapshot/atomic-wait-
CI=1 npm run test:unit --workspace=@poe-code/safe-js
npx eslint packages/safe-js/src/platform/node.ts packages/safe-js/src/platform/workerd.ts packages/safe-js/src/platform/shared-buffer-clone.test.ts packages/safe-js/src/interp/shared-array-buffer.ts packages/safe-js/src/interp/atomic-wait.test.ts packages/safe-js/src/snapshot/atomic-wait-race.test.ts packages/safe-js/src/snapshot/atomic-wait-rollback.test.ts
```

Run the exact [ten-shape manual graph QA](shared-graph-boundary-audit-20260914.md)
against the built `packages/safe-js/dist/index.js` with Node stdin
`--input-type=module`, or `bun run -`. Require every original/replay result to be 7
and the host operation count to be 1. The recorded built-artifact run passes all
**70 distinct runtime/shape cells** across Node18.18.0/ICU73.2,
18.20.8/ICU74.2, 20.20.2 / ICU 78.2, 22.23.2 / ICU 78.2, 24.21.0 / ICU 78.3,
26.8.2 / ICU 78.3 and Bun 1.3.11/reported ICU74.2. The actual native Bun growth
control also preserves maxByteLength8, growable=true and the grown length8.

Exact source hashes, commands, runtime versions and red/green outputs are retained
under `bun-shared-wrapper-20260914/`. Full-package, integrated Workerd and
publication receipts follow after completion; focused checks are not substituted
for those pending gates.

## Remaining task disposition

This repair resolves the Bun shared-wrapper boundary. It does not resolve
SM-REPLAY-1/2: raw shared writes outside captured operation boundaries can still
produce 7 originally and 0 on recovery, with resumed effects before detection.
The documented ownership/history design blocker remains. No arbitrary live-realm
interoperability, deterministic native weak lifetime or exactly-once effects are
claimed. The task remains incomplete while that unsupported history is admitted.

## Integrated verification

The first full package gate passes **29,695 tests / zero failures / 47 skips** in
1,375 files (687.78s) on RR-8 plus the wrapper repair. The repair then fast-forwards
cleanly onto delivered v9 commit `4e02e3fa84c2c6dc1437da63ddee717d63935657`, without
conflicts or source edits to the fallback. A fresh full package gate is running
on that combined source; the earlier count is not presented as its result.

The combined built source again passes all **70 Node/Bun graph cells**. Actual
Workerd 2026-09-01 passes **nine controls**, including shared-graph original/replay
results. The [exact Workerd fixture](workerd-shared-wrapper-20260914.md) and
bundle metadata prove the SafeJS Workerd platform is selected. An initial
metafile check accidentally included the pre-existing SafeFS Node platform;
restricting the assertion to the intended SafeJS platform resolves that diagnostic
mistake without changing the bundle. Temporary QA files were hashed then removed,
and only the task-owned server was stopped.

A fresh [shared-history witness](shared-history-integrated-20260914.md) on both
Node 22 and Bun 1.3.11 still produces **7/0** and effects **[7,0]** for queued writes;
synchronous controls produce **7/7/7**. Observer exit 0 is not semantic acceptance.
The wrapper repair resolves the earlier Bun admission failure while exposing the
same independent unsupported-history defect; that defect remains unresolved.

The final combined-source gate passes **30,003 tests / zero failures / 47 skips**
in 1,384 files (687.17s). The maintained workspace build completes 23 builds and
eight built-import controls. Native Temporal and existing opt-in skips remain
unavailable controls, not passed support cells. Source hashes match the integrated
pre-gate receipt. No timeout, budget or assertion was changed during verification.

The preceding v9 commit `4e02e3fa84c2c6dc1437da63ddee717d63935657` is verified on
remote main after a normal-hook push. Scoped run 34837374651 and schema run 34837374667
succeeded; root release 34837374864 remains pending at this report increment.
All three scoped packages **0.1.597** now have verified integrity/provenance
and independent installed smokes. SafeJS metadata, attestations and tarball
propagated at different times; the tarball's successful retry is recorded at
11:30:58 UTC after retained 404s, including an alternate read-only registry check.
Installed SafeJS passes ten Node graph controls, 12 metadata/admission controls
on each of Node/Bun and the exact jobs-v9 marker. Consumer audit verifies 18
signatures / 12 attestations. The root release is still pending; no complete v9
publication is claimed until that separate artifact is verified.

Final scoped ESLint passes, all 100 filesystem type-contract cells pass, and the
maintained harness/loader/smoke selection passes 71 tests in four files. The
pre-gate source hashes still match. Required local verification is complete.

## Native Bun getter control

On the built source of commit `0bba68687af792727e8ae86d158b2999e8990193`, this
additional direct Bun1.3.11 control passes all three sizes with zero getter reads:

```js
import assert from "node:assert/strict";
import { cloneSharedBufferWrapper } from "./packages/safe-js/dist/platform/node.js";
let reads = 0;
for (const length of [0, 4, 65536]) {
  const source = new SharedArrayBuffer(length);
  Object.defineProperty(source, "constructor", {
    get() {
      reads++;
      throw Error("getter ran");
    }
  });
  const copy = cloneSharedBufferWrapper(source);
  assert.equal(copy === source, false);
  assert(copy instanceof SharedArrayBuffer);
  assert.equal(copy.byteLength, length);
  if (length) {
    new Uint8Array(copy)[0] = 7;
    assert.equal(new Uint8Array(source)[0], 7);
  }
  assert.equal(reads, 0);
}
```

Execute as `bun run -` from the repository root after the maintained build.
This supplements the Node-based fault-injection tests with the actual native Bun
fallback. It is not a new public API or authority grant.

## Additional native API comparisons

Node 26.8.2 / ICU 78.3 exposes native Temporal and Math.f16round. Running the four
maintained native Instant/structured-clone/f16round test files with that Node
executable passes **86 tests / zero failures / zero skips**, including the 13
comparisons unavailable in the main Node 22 gate. The original 47 skips are not
retroactively changed. The exact command, source SHA and log hash are recorded
in `bun-shared-wrapper-20260914/node26-native-comparators.json`.
