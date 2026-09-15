# Exotic descriptor reentrancy qualification — 2026-09-13

Acceptance remains **open**. This atomic change adds eight independent descriptor
reentrancy controls and records fresh focused and pinned-fixture checks. No
production source, budget, timeout, support policy or existing test was changed.

## Compatibility and source

The target remains ECMA-262 edition 16 (June 2025), ECMA-402 edition 12 and the
ledger's explicitly tracked newer APIs. The controlling algorithms are published
ECMA-262 §10.5.5 (`[[GetOwnProperty]]`), §10.5.6 (`[[DefineOwnProperty]]`) and
§6.2.6.5 (`ToPropertyDescriptor`):
<https://262.ecma-international.org/16.0/#sec-proxy-object-internal-methods-and-internal-slots-getownproperty-p>.
No latest-draft behavior or native-engine discrepancy changes that target.
The browser fetch of the complete specification exceeded the tool's response-size
limit; the existing pinned primary-clause receipts were used alongside code review
and independent native controls, without claiming a fresh document hash.

Test262 checkout: `419d3e0a2273ba01a3bfcbec423f2801425b8e93` at
`/tmp/safejs-exotic-test262`. Executed source HEAD:
`4caaa017fc01858ed43ebd0759b4a69e3063a844`, on local `main` with pre-existing dirty
runtime and integration changes. Maintained conformance runner source hash:
`88a0352b98cd5d377ebca117613126187348eef5ff90b9b21022b7d238e185df`.
This qualifies those working-source bytes, **not clean HEAD or remote main**.
Runtime: Node **22.23.2**, ICU **78.2**, V8 **12.4.254.21-node.56**, Darwin arm64.

## Added controls

`packages/safe-js/test/integration/exotic-descriptor-reentrancy.test.ts` asserts
literal ordered traces and final descriptor/sibling state. Each program also runs
in a separate native VM realm as an independent control. The VM has no injected
host callbacks or shared objects; native values are not passed into guest code.

- Two controls freeze the target and mutate a sibling while reading the trap's
  descriptor. Validation uses the previously captured descriptor: a configurable
  report succeeds, while a newly frozen report throws after all descriptor reads.
- Two controls prevent extensions during descriptor conversion. The previously
  captured extensibility allows a configurable synthetic property; a claimed
  nonconfigurable property throws. Neither installs the reported property.
- Two controls revoke the proxy in the trap lookup getter. The captured handler,
  target and callable remain valid for the current operation. A descriptor getter
  either throws a sentinel immediately or completes; the next operation throws
  `TypeError`. Exact handler `this`, target identity and property key are asserted.
- Two controls distinguish successful descriptor conversion from an abrupt value
  getter before `defineProperty` trap lookup. They assert sibling mutation,
  descriptor field order, target/handler identity and the absence of late reads.

These controls validate current behavior; no new semantic defect was reproduced,
so no speculative runtime repair was made. Test code only imports the maintained
public run route and the independent native oracle. It adds no production helper,
filesystem fixture, LLM dependency or host capability.

## Manual checks on the exact committed test bytes

Initial controls: **8/8 pass**, zero failures/skips. The handler identity assertion
was then strengthened from distinguishing an unrelated object to asserting the
actual handler. Final focused run: **111/111 tests pass**, zero failures/skips/todo,
across 11 selected files (Vitest reports 13 suites), exit **0**. This includes
existing snapshot, symbol/prototype/descriptor state, host-copy refusal, native
prototype isolation, constructor, species, ownKeys coercion and mutation controls.
ESLint for the new test: exit **0**. The report initially failed Prettier
formatting; after formatting it, the check passed (exit **0**). The isolated
commit diff passed `git diff --cached --check` (exit **0**). No visual CLI
change requires a screenshot.
The full package/repository gates and other runtime cells were not rerun in this
continuation; these focused checks are not a substitute for their open results.

Run from the repository root with Node 22.23.2 on PATH:

```sh
/Users/kjopek/.nvm/versions/node/v22.23.2/bin/node node_modules/vitest/vitest.mjs run packages/safe-js/src/host-result-prototype-replay.test.ts packages/safe-js/src/proxy-data-copy.test.ts packages/safe-js/src/proxy-host-callback.test.ts packages/safe-js/src/interp/clone-prototype-independent.test.ts packages/safe-js/src/interp/exotic-invariant-qualification.test.ts packages/safe-js/test/integration/exotic-mutation-controls.test.ts packages/safe-js/test/integration/exotic-species-realm.test.ts packages/safe-js/test/integration/exotic-subarray-species.test.ts packages/safe-js/test/integration/exotic-symbol-constructor.test.ts packages/safe-js/test/integration/exotic-coercion-order.test.ts packages/safe-js/test/integration/exotic-descriptor-reentrancy.test.ts --reporter=json --outputFile=/tmp/exotic-descriptor-focused.json
npx eslint packages/safe-js/test/integration/exotic-descriptor-reentrancy.test.ts
```

The final test file SHA-256 is `c8021df61ebd7721d18ed1a7e724b37eb7650a719a486ee3c73017fc745dd02c`.
The focused JSON receipt SHA-256 is `db58a2ba0605568e1f623146195d15c47603786c51e979584b4de9022add9b5b`.
Raw receipts remain local under this report's directory and are not committed
artifacts. The commands and substantive outcomes are preserved here independently
of those local receipts.

## Fresh pinned cases and unresolved failures

The following maintained command completed with exit **1**, five files / ten
variants: **8 passed, 2 failed**, zero unsupported, metadata errors or execution
errors. Both strict and sloppy modes ran. There are no hidden skips.

```sh
npm run test:conformance --workspace=@poe-code/safe-js -- --corpus /tmp/safejs-exotic-test262 --report /tmp/exotic-descriptor-upstream.jsonl --include built-ins/Array/prototype/slice/create-proto-from-ctor-realm-array.js --include built-ins/TypedArray/prototype/subarray/BigInt/speciesctor-get-species-custom-ctor-invocation.js --include language/statements/class/subclass/builtin-objects/Symbol/new-symbol-with-super-throws.js --include language/statements/class/subclass/builtin-objects/Symbol/symbol-valid-as-extends-value.js --include built-ins/TypedArray/prototype/subarray/speciesctor-get-species-custom-ctor-invocation.js
```

Use a fresh report pathname when reproducing: the runner refuses to overwrite it.
The native 3,000 ms per-variant policy and configured budgets were unchanged.

| Pinned fixture                                                                                     | Sloppy              | Strict              |
| -------------------------------------------------------------------------------------------------- | ------------------- | ------------------- |
| `built-ins/Array/prototype/slice/create-proto-from-ctor-realm-array.js`                            | Pass                | Pass                |
| `built-ins/TypedArray/prototype/subarray/BigInt/speciesctor-get-species-custom-ctor-invocation.js` | Pass                | Pass                |
| `built-ins/TypedArray/prototype/subarray/speciesctor-get-species-custom-ctor-invocation.js`        | worker-wall-timeout | worker-wall-timeout |
| `language/statements/class/subclass/builtin-objects/Symbol/new-symbol-with-super-throws.js`        | Pass                | Pass                |
| `language/statements/class/subclass/builtin-objects/Symbol/symbol-valid-as-extends-value.js`       | Pass                | Pass                |

Each failure reports host-phase `worker-wall-timeout`, reason `timeout`,
“Isolated variant exceeded 3000 ms; child terminated”. Numeric fixture SHA-256:
`8c6e8c658584a6b3db6b288d2c51c494043bd2dd2b638f22e2a23ffb0cdb78ac`.
Runner report SHA-256: `b46b89aadff8a130ddcef3aedb0cbef1dea722b73bb7acf64ac7125814fd96a9`.
The initial standalone control process finished before this upstream run; its
last stages overlapped the final focused test/lint processes. This is recorded as
execution context, not grounds to excuse the timeout or infer performance gains.

These current failures prevent acceptance. Prior locally recorded 68 broad
selection timeouts, Node 18 resizable-buffer support failures and missing broader
runtime/installed-artifact qualification are not cleared by this run. Existing
profiles implicate repeated retained-graph accounting but do not establish a safe
optimization; removing roots or relaxing deadlines would not constitute a repair.
Missing capabilities by design remain separate from ECMAScript defects. Full
category qualification and release acceptance remain outstanding.

## Commit and delivery disposition

This report, the new test, and only this continuation's ledger addition form one
atomic qualification commit. Existing staged safe-bash changes and all pre-existing
working changes are excluded. The pre-task staged-diff SHA-256 is
`839e9e04f0f5e07fae2138a1c64a573e924875d6ccbb339c87774d51eaf251a8`.
The source SHA above identifies execution before the qualification commit; the
new local commit SHA is reported separately after creation, rather than predicting
its self-referential identifier.

Verified remote-main delivery: **none**. Publication/release receipts: **none**.
No push, release or installed-artifact verification was attempted; unresolved
acceptance failures are not represented as a completed delivery.
