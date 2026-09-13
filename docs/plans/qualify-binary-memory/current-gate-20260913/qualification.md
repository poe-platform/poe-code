# Binary memory qualification: maintained gate refresh

Date: 2026-09-13. **Acceptance remains open.** This increment audits existing
qualification and finishes a previously interrupted maintained check. It changes
only this report and an appended evidence-ledger section. Existing dirty tests,
runtime changes, other documentation and staged Safe Bash changes are preserved.

## Candidate and compatibility contract

Source HEAD: `33fde231ac697685bce3a353d0bbae4f002c859b`, branch `main`, plus the
existing dirty SafeJS tree. This is not a clean committed-runtime qualification.
Runtime: Node 22.23.2, ICU 78.2. A local `source.json` receipt fingerprints the
SafeJS files and index before checks; raw receipts are retained locally and are
not included in this evidence-only commit. The SHA-256 of the sorted compact JSON
path-to-SHA-256 map (all SafeJS files excluding `dist` and `node_modules`) is
`970acc7974d3938b846cbebfd875f02d3d2f7348d2a99ab5c744754966c5cebf`. The map includes existing untracked source tests.

The target remains published ECMA-262 edition 16 / ECMA-402 edition 12, with the
previously tracked newer APIs unchanged. Test262 remains pinned to
`419d3e0a2273ba01a3bfcbec423f2801425b8e93`. No corpus or target change was made.

| Required surface     | Current inventory and evidence boundary                                                                                                                                                                                                                                |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ArrayBuffer          | Fixed/resizable allocation, resize, transfer, transferToFixedLength, detached getter. Resize is required edition behavior; native support is still required by this implementation.                                                                                    |
| SharedArrayBuffer    | Fixed/growable allocation, monotonic grow, shared block aliases. Transfer/detach are not SAB requirements. Unowned host SAB admission is deliberately rejected.                                                                                                        |
| DataView             | OOB and tracking metadata, endian access, coercion revalidation and Float16 access. Existing independent controls assert literal bytes.                                                                                                                                |
| Typed arrays         | Int8, Uint8, Uint8Clamped, Int16, Uint16, Int32, Uint32, Float16, Float32, Float64, BigInt64, BigUint64; all twelve remain declared in `src/interp/typed-array-constructors.ts`.                                                                                       |
| Recovery and budgets | Existing bounded tests cover admission aliases, snapshot codecs, completed replay, rejected live snapshots, transfer allocation failure, and rejection before replayed shared writes/growth. Exhaustive allocation-site and pending-replay qualification remains open. |

## Revalidated blockers

Fresh native controls use a two-byte SharedArrayBuffer with maximum four bytes.
The exact executable paths, argument vectors, runtime versions and outputs are
retained locally in `native-controls.json`. Reproduction on each named runtime:

```js
console.log(process.versions);
console.log(typeof ArrayBuffer.prototype.resize, typeof SharedArrayBuffer.prototype.grow);
const original = new SharedArrayBuffer(2, { maxByteLength: 4 });
const copy = structuredClone(original);
const read = Object.getOwnPropertyDescriptor(SharedArrayBuffer.prototype, "byteLength").get;
console.log(read.call(original));
console.log(read.call(copy));
```

- Node 18.18.0 / ICU 73.2 and Node 18.20.8 / ICU 74.2: both methods are
  `undefined`; shared copy brand succeeds. The probe's exit zero is not a
  resize/grow pass. `array-buffer-host-compatibility.test.ts` still explicitly
  expects resizable construction to reject without native resize support.
- Node 22.23.2 / ICU 78.2: both methods are functions; shared copy brand succeeds.
- Bun 1.3.11 / ICU 74.2: both methods are functions, but the copy brand getter
  throws `TypeError: Receiver must be SharedArrayBuffer`; original brand succeeds.
  This repeats the backend failure. `shared-array-buffer.ts` still captures
  native `structuredClone`, so the dependency remains. A byte copy cannot replace
  genuine shared storage identity or growth.
- `test/conformance/execute.ts` still excludes SharedArrayBuffer/Atomics metadata
  before guest execution. Nonblocking SAB fixtures therefore remain unqualified;
  withholding host agent/blocking authority is not an ECMAScript defect.

No production repair is claimed. No support declaration, budget, timeout or
assertion was weakened, and no new host authority was enabled.

## Upstream inventory reconciliation

The local corpus HEAD was rechecked at the pinned SHA. Recursive `.js` counts
under `test/built-ins` are ArrayBuffer **221**, SharedArrayBuffer **104**,
DataView **561**, TypedArray **1,446**, TypedArrayConstructors **738**, and
Uint8Array **70**: **3,140 files** before edition filtering or variant expansion.
These are inventory counts, not executed tests or edition-conformance totals.

Constructor-specific tests mostly live under `TypedArrayConstructors`, not
individual top-level kind directories. That directory has 12 files each for
BigInt64/BigUint64 and 11 each for the nine other named constructor directories;
Float16 has no dedicated constructor directory there. The shared
`harness/testTypedArray.js` adds Float16 and BigInt constructors conditionally on
global availability. Therefore a shared fixture pass alone cannot prove every
kind ran: the declared-kind inventory and independent twelve-kind controls remain
necessary. The harness comment calling Float16 newer does not override the
published edition-16 target. This census does not close edition filtering or
per-fixture/per-kind execution reconciliation. Reproduce with `Path.rglob("*.js")`
for the six directories above in `/tmp/safejs-binary-test262`.

## Manual checks

- `npm test --workspace=@poe-code/safe-js`: **exit 1**, after all four
  type-contract environments passed. Vitest completed in 1,233.04 seconds:
  **29,897 passed / 47 skipped**, with **1 failed / 1,388 passed / 2 skipped
  files**. The failed file did not collect any tests. Skips are not passes:
  33 memfs reference cases, 13 unavailable native controls, and one opt-in fuzz
  case retain their existing skip dispositions.
- Failure: `src/interp/dom-exception-platform.test.ts` fails during import at
  `src/interp/host-bridge.ts:84`, reading `.get` from an absent DOMException
  prototype `name` descriptor. The fixture supplies a DOMException replacement
  with own diagnostics and no intrinsic getter. The current uncommitted bridge
  addition assumes the getter exists. This is a validated integration failure,
  not an ECMAScript binary algorithm defect and not a successful package gate.
- Independent reproduction:
  `npx vitest run packages/safe-js/src/interp/dom-exception-platform.test.ts`:
  **exit 1**, one failed suite, zero collected tests, same import exception.
  Raw output remains in local `dom-platform-red.log`. No repair or green result
  is claimed. The failing bridge addition is absent from HEAD and belongs to the
  preserved uncommitted host-boundary changes; this report does not commit that
  feature or silently change its authority policy.
- The completed package run includes passing `binary-memory-qualification`
  (**45**) and `run.binary-recovery-qualification` (**36**) controls; these are
  included in the overall count, not added to it. Existing binary, species,
  Float16, capacity and shared-replay rejection suites also ran in this gate.
- Documentation-only manual check:
  `npx prettier --check docs/plans/qualify-binary-memory/current-gate-20260913/qualification.md`
  and formatting of the exact appended ledger section pass before commit.
  `git diff --check` for the isolated two-file candidate passes. No code lint
  claim is made for preserved uncommitted runtime changes.

No CLI visual behavior changed, so screenshot checks do not apply. No build,
root-wide lint/test, upstream corpus rerun, Workerd or installed-artifact result
is claimed in this increment. Existing upstream reports are not counted again.

## Disposition and delivery

The freshly reproduced package import failure, Node18 and Bun backend blockers,
runner shared-memory exclusions,
full binary corpus/kind reconciliation, Workerd, exhaustive charged-growth and
rollback paths, and complete pending replay remain unresolved. Passing existing
independent byte controls cannot establish the full acceptance criteria.

Local evidence commit: see the appended ledger section and delivery response.
Verified remote-main delivery: none. Successful release/publication: none;
no release receipt. No push requested or performed in this increment.
