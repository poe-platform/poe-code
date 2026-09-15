# Shared graph recovery boundary audit — 2026-09-14

This is manual QA of the public host transport and replay contract. It is not an
ECMAScript conformance test or a claim of exactly-once host effects. Grant only
`save`; run the following stdin from the repository root with
`node --import tsx --input-type=module`. No budget or timeout override is used.
The test requires original and completed replay to return 7, with one host call.
An unsupported path must reject predictably instead of silently returning 0.

```js
import { run, dump } from "./packages/safe-js/src/index.ts";
const rows = [];
const cases = [
  ["direct", "b", (v) => v],
  ["object property", "({ b })", (v) => v.b],
  ["array element", "[b]", (v) => v[0]],
  ["Map value", "new Map([['b', b]])", (v) => v.get("b")],
  ["Map key", "new Map([[b, 1]])", (v) => v.keys().next().value],
  ["Set element", "new Set([b])", (v) => v.values().next().value],
  [
    "object symbol",
    "({ [Symbol.for('shared')]: b })",
    (v) => v[Object.getOwnPropertySymbols(v)[0]]
  ],
  [
    "array symbol",
    "Object.assign([], { [Symbol.for('shared')]: b })",
    (v) => v[Object.getOwnPropertySymbols(v)[0]]
  ],
  ["array named property", "Object.assign([], { b })", (v) => v.b],
  ["nested Map view", "({ m: new Map([['b', new Uint8Array(b)]]) })", (v) => v.m.get("b").buffer]
];
for (const [shape, expression, extract] of cases) {
  let calls = 0;
  const bindings = {
    save(value) {
      calls++;
      new Uint8Array(extract(value))[0] = 7;
    }
  };
  const source = `const b=new SharedArrayBuffer(4);save(${expression});return new Uint8Array(b)[0];`;
  try {
    const original = await run(source, { bindings });
    const snapshot = JSON.parse(await dump(original));
    const replay = await run(source, { bindings, snapshot });
    rows.push({
      shape,
      originalOK: original.ok,
      original: original.returnValue,
      replayOK: replay.ok,
      replay: replay.returnValue,
      calls,
      replayError: snapshot.replayError ?? null,
      pass:
        original.ok &&
        replay.ok &&
        original.returnValue === 7 &&
        replay.returnValue === 7 &&
        calls === 1
    });
  } catch (error) {
    rows.push({
      shape,
      rejected: true,
      name: error.name,
      message: error.message,
      calls,
      pass: false
    });
  }
}
console.log(JSON.stringify({ versions: process.versions, rows }, null, 2));
if (rows.some((row) => !row.pass)) process.exitCode = 1;
```

## Observed result and disposition

Source HEAD `947a383449d67460e060a5ac0ae77dcc87be6ad9` plus the existing dirty
candidate, Node **22.23.2 / ICU 78.2**, Darwin arm64. All 1,871 files in the
previous continuation manifest matched at audit start. This audit changes no
runtime, test, budget, timeout, compatibility marker or support declaration.

The final probe exits **1: three passing controls and seven failures**. Every
case completes original and replay execution with `ok: true`, one invocation of
`save`, and `replayError: null`.

| Shape                           | Original | Completed replay | Disposition    |
| ------------------------------- | -------- | ---------------- | -------------- |
| Direct buffer                   | 7        | 7                | Pass           |
| Ordinary object property        | 7        | 7                | Pass           |
| Array element                   | 7        | 7                | Pass           |
| Map value                       | 7        | 0                | RR-8 confirmed |
| Map key                         | 7        | 0                | RR-8 confirmed |
| Set element                     | 7        | 0                | RR-8 confirmed |
| Object symbol property          | 7        | 0                | RR-8 expanded  |
| Array symbol property           | 7        | 0                | RR-8 expanded  |
| Array named property            | 7        | 0                | RR-8 expanded  |
| Nested Map holding a typed view | 7        | 0                | RR-8 expanded  |

The initial symbol probe incorrectly looked up the guest symbol using the host
`Symbol.for` registry and observed 0 even in original execution. That observation
is a probe error, not evidence of a transport defect. The final probe uses the
actual exported own symbol; both symbol cases then reproduce **7/0**. It makes no
claim of shared live symbol registries across realms. Initial and corrected raw
outputs are retained separately in the local audit receipts.

Source inspection in `packages/safe-js/src/interp/host-call.ts`, function
`normalize`, explains the omissions: the array branch visits numeric indices
only; the ordinary-object branch visits enumerable string descriptors only;
there is no collection-entry branch. Shared storage registration happens when
that traversal encounters the buffer. Public export admitting an edge therefore
does not imply the recovery walker tracks that edge. Changing historical
argument digests is not a safe compatibility repair by itself: any repair needs
TDD plus original/pending/completed and genuine legacy controls, with bounded,
getter-safe graph discovery and explicit capture ownership.

**Acceptance remains incomplete.** RR-8 now includes four additional graph
shapes. SM-REPLAY-1/2 also reproduces unchanged: a queued raw shared-buffer write
returns 7 originally and 0 in accepted pending/completed return-only recovery;
pending recovery can issue effects `[7,0]`, while completed replay detects the
mismatch only later. Synchronous direct-buffer controls return 7 throughout.
Unsupported histories must fail before resumed effects; a late mismatch does
not meet that criterion. These are product transport/recovery defects, not
missing ECMAScript capabilities by design. The prior Bun shared-storage blocker
and unverified runtime/artifact cells remain unresolved, not retested here.

Targets remain ECMA-262 edition 16 and ECMA-402 edition 12 (June 2025), Test262
`419d3e0a2273ba01a3bfcbec423f2801425b8e93`, and the separately pinned Temporal
extension `e8cc03fc970a65a3359e8870e3b35e687ac94e55`. No arbitrary live-realm
interoperability, native-stack capture or exactly-once external effects are
claimed. No repair or release is claimed by this evidence-only increment.

## Broader matrix command

Executed from the repository root, with the existing Vitest configuration:

```sh
CI=1 npx vitest run packages/safe-js/src/snapshot packages/safe-js/src/run. packages/safe-js/src/realm packages/safe-js/src/interp/host- packages/safe-js/src/interp/foreign-host packages/safe-js/src/interp/temporal- packages/safe-js/src/interp/shared-host packages/safe-js/src/migrate.test.ts packages/safe-js/src/migration-file.test.ts packages/safe-js/src/restore.test.ts packages/safe-js/src/dump.test.ts packages/safe-js/src/external-checkpoint packages/safe-js/src/checkpoint-views-validation.test.ts packages/safe-js/src/modules/registry.test.ts packages/safe-js/src/transport- packages/safe-js/src/host-symbol-paths.test.ts packages/safe-js/src/interp/pending-proof-encoding-rollback.test.ts packages/agent-harness/src/loader/run.test.ts packages/safe-js/src/interp/shared-callback-export.test.ts --reporter=json --outputFile=docs/plans/qualify-realms-and-recovery/final-audit-20260914/results.json > docs/plans/qualify-realms-and-recovery/final-audit-20260914/tests.log 2>&1
```

The preceding collection and queued-history witnesses were also freshly executed
from their recorded stdin in `continuation-20260914/minimized-collection-qa.md`
and `review-20260914/manual-qa.md`; the latter imports current
`./packages/safe-js/src/index.ts`. Their exits are respectively 1 (three failures,
one control) and 0 (successful observation of two passing synchronous cases and
two nonpassing queued cases). The final graph probe above has stdin SHA-256
`6bfeac5a24cfe00c13b4a09926710fe0badf53a1719e2d4c1ca9b09f8e68b134`.

The fresh selection exits **0: 4,413 passed, zero failed, four skipped in 294
files**. It includes **156 supported transport cells, 100 predictable-rejection
cells, 18 version-envelope cells and six genuine v8 controls**, all passing.
The four skips are native Temporal.Instant import, export, binding and forged
accessor controls unavailable on Node22; they remain skips. Snapshot selection
covers source ownership, same/mixed-source closures, templates and intrinsics,
dynamic globals, private fields, suspended guest frames, iterator state, errors,
promises, Temporal, weak/shared graphs, malformed records and allocation rollback.
Realm, reconciliation, cancellation, migration and maintained harness loader
checks also ran. These passes are bounded by the failures above.

Raw results SHA-256:
`7babe512e7e9e76edad5f1ac68f4dd8a58529349891e2045154d8ab434ef328c`.
Source receipt SHA-256:
`b6205c3927e3e5589b04ff0b232de56b5aaf1b486348bb0c6b02e690374e01b5`.
Receipts remain local under `final-audit-20260914`; generated artifacts are not
part of the evidence-only commit. The source receipt includes all 1,871 candidate
file hashes and full runtime versions; no fingerprinted source changed.

Manual checks for the committed Markdown are the exact formatted probe rerun
above, `npx prettier --check` on this document and the appended ledger section,
and `git diff --cached --check` on the isolated two-file commit. The probe's
expected failing exit is retained as an unresolved product finding, never
reported as a passing qualification. No runtime repair means no new unit test,
ESLint/build or CLI screenshot requirement is introduced. Full package/root
checks, cross-runtime matrix, installed-artifact probes and release checks were
not rerun; historical receipts are not promoted to fresh passes.

Delivery is an evidence-only local Conventional Commit; its SHA is reported
separately after creation. Verified remote-main delivery: **none**. Successful
publication: **none**. Release receipts: **none**. No push was requested or
performed. Unrelated staged and working changes are preserved; only this report
and the new ledger section belong to the commit.
