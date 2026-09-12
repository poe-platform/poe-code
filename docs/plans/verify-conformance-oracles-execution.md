# Execution and isolation oracle verification

Task: verify-conformance-oracles. Source baseline: `51f580428c75d2405c67b5fd719f88c54fab5d4f`, inspected on main, 2026-09-12. Environment: Node `v22.23.2`, ICU `78.2`. Changes are confined to the conformance harness and tests; no runtime repair, budget increase, or timeout increase. Existing local/staged changes are preserved.

## Contract and owner

The category owner is the SafeJS Test262 harness. Fixture negative metadata follows the pinned Test262 `INTERPRETING.md`: expected error phase and constructor name must match. Native engines are controls, not specifications. Target ECMAScript edition and upstream fixture SHA remain those pinned in `safejs-gap-closure-evidence.md`.

The IPC contract requires exactly one start acknowledgement for the requested variant, followed by a well-formed result for that ID/mode. Process exit (including code zero), malformed results, or silence cannot substitute for a result. The report and worker now share `isTest262ExecutionResult` for the closed result vocabulary.

## Reproduced defect and TDD receipt

Before the validator change, `npx vitest run packages/safe-js/test/conformance/isolate.test.ts` failed **5 tests**, with **12 passing**, in 218 ms (Vitest test time 26 ms). The five injected worker results were:

- `{mode:"strict",status:"passed",reason:"timeout"}`: incorrectly returned as a pass.
- `{mode:"strict",status:"failed",reason:"invented"}`: unrecognized failure reason accepted.
- `{mode:"strict",status:"unsupported",reason:"invented"}`: unrecognized unsupported reason accepted.
- `{mode:"strict",status:"failed",reason:"host-error",detail:{code:42}}`: malformed diagnostics accepted.
- `{mode:"strict",status:"passed",detail:"unexecuted"}`: contradictory pass accepted.

Expected outcome for each: fail with `host-error`, `detail.code=worker-error`, and retire the worker. Actual baseline: returned the injected malformed result unchanged. This is a reporting/protocol product defect, not an ECMAScript runtime defect. In-memory EventEmitter workers and fake timers reproduce it without launching processes, touching disk, or querying models.

Repair: validate the closed outcome vocabulary and diagnostic shape before resolving a worker result. Well-formed passed, failed, harness-error string details, and unsupported results remain accepted as neighboring controls.

## Counterexamples and dispositions

| Oracle / class | Small counterexample | Neighbor / qualification |
| --- | --- | --- |
| Deliberately wrong value | `if(1+1!==3)throw new Error("wrong value")` → unexpected-throw | Expected `2` passes |
| Missing expected throw | `0` with runtime TypeError negative → missing-throw | `throw new TypeError()` passes |
| Wrong phase | runtime TypeError with parse negative; `return 0` with runtime SyntaxError negative → wrong-phase | Matching runtime TypeError passes |
| Wrong type | `throw new RangeError()` with runtime TypeError negative → wrong-error-type | Matching runtime TypeError passes |
| Async failure | `$DONE("wrong value")` → async-failure | `$DONE()` passes |
| Missing async completion | async body `0` → timeout using fake timers | `$DONE()` and Promise callback completion pass |
| Unhandled rejection | `Promise.reject(42);$DONE()` → unhandled-rejection | Handled rejection with completion passes; rejecting unhandled rejections is harness policy, not an ECMAScript requirement to throw (edition 16 §27.2.1.9 HostPromiseRejectionTracker) |
| Harness error | missing include or include throwing TypeError → harness-error | Ordered valid includes pass; harness throw cannot satisfy fixture negative |
| Resource policy | maxSteps 10 plus runtime Error negative → host-error / budgetExceeded / steps | `0` at the same tiny cap also exhausts; cap is insufficient even for initialization. Normal-budget positive controls pass elsewhere. This is host policy, not ECMAScript evidence |
| Early exit | started acknowledgement then exit 0, 1, or SIGTERM → host-error / worker-exit | Well-formed explicit result passes |
| Missing start / hard wall timeout | no acknowledgement or result → timeout / worker-wall-timeout | Correct start+result passes; original 3000 ms deadline unchanged |
| Startup timeout | no ready signal → host-error / worker-startup-timeout | Separate original 10000 ms startup allowance unchanged |
| Unsupported module | module or runtime import requirement → unsupported/module | Parse-negative dynamic import controls remain evaluated |
| Unsupported agent | agent.js / atomicsHelper.js include requirement → unsupported/agent | No claim about absent host agents |
| Unsupported shared memory | SharedArrayBuffer/Atomics feature requirement → unsupported/shared-memory | Intentional host authority boundary |
| Unsupported blocking mode | CanBlockIsFalse or CanBlockIsTrue → unsupported/blocking-mode | Runner exclusion; CanBlockIsFalse itself is permitted for a nonblocking host (§9.6.2), so unsupported here is missing qualification, not an inherent capability prohibition |
| Unsupported IsHTMLDDA | feature requirement → unsupported/IsHTMLDDA | Host object absent by design |
| Unsupported GC | observed `$262.gc()` in main/child realm → unsupported/gc | Capability absence tracked even if guest catches throw |
| Fixture file | `_FIXTURE.js` → fixture, no pass | Ordinary enumerated script runs both variants |

A drafting assumption that source `0` would pass at maxSteps 10 was disproven by the focused test (1 failure, 57 passes). The diagnostic showed initialization itself exhausts this cap. The test now asserts that host-policy result for both programs and retains the exact cap; no implementation was changed to satisfy the invalid assumption.

The raw async source `print("Test262:AsyncTestComplete")` passes. This is the pinned print completion protocol, which trusts upstream fixture/harness content; it is not authentication against a hostile fixture forging a completion marker. It requires actual fixture evaluation. The runner likewise cannot detect an arbitrary malicious worker fabricating an otherwise valid transcript; mutation controls establish rejection of the tested protocol/accounting defects, not cryptographic execution attestation.

## Validation

`npx vitest run packages/safe-js/test/conformance/isolate.test.ts packages/safe-js/test/conformance/execute.test.ts packages/safe-js/test/conformance/result.test.ts packages/safe-js/test/conformance/realm.test.ts packages/safe-js/test/conformance/worker.test.ts`

Result: **5 files, 105 tests passed**, no skips, 6.22 s total, 2.66 s test time. Isolation mutation tests: 24 tests in 31 ms. All new fixtures reside in strings/maps or in-memory EventEmitter objects. Existing fake timers test timeout outcomes without extending the configured deadlines.

Focused ESLint and package validation receipts are reported in the main evidence ledger after completion. No commit, push, remote-main receipt, or release was performed by this execution subtask; delivery is recorded separately by the coordinating task.

Independent review found that advanced IPC preserves Date/Map/Set diagnostics. Three added mutations first failed (3 failed, 24 passed); validating plain or null-prototype diagnostic records then passed all 27 isolation tests. Same focused command and baseline revision/environment apply. No ECMAScript runtime change.

## Maintained package validation blocker

The maintained `npm test --workspace=@poe-code/safe-js` route runs pretest generation/type contracts and the complete package test selection. During this run the existing user-owned untracked `src/interp/promise-import-properties.test.ts` failed its symbol-property test. Independent reproduction on the same revision/environment:

`npx vitest run packages/safe-js/src/interp/promise-import-properties.test.ts`

Result: **1 failure, 1 pass**, test time 7 ms. Counterexample: define an enumerable own `Symbol("label")` value `42` on a native Promise, then call `deepCopyToSandbox` and read that symbol from `getPromiseProperties`: actual `undefined`. Neighboring own string descriptor `label="answer"` is preserved and passes.

`values.ts` imports descriptors through `nativePromiseDataProperties`, which admits own string descriptors. Broadly copying own native Promise symbols would also copy private Node async-resource / AsyncLocalStorage context into guest data. The existing `safejs-native-promise-symbol-boundary.md` documents why symbol descriptions and a sampled fresh Promise are not reliable ownership discriminators. The current failure was independently reproduced rather than treated as excused history. Resolving it requires an explicit safe symbol-admission/ownership contract across native Promise import and replay; this is a host capability design blocker, not an ECMAScript conformance oracle defect. The user-owned test and runtime remain unchanged. No budget/assertion/timeout was weakened. Complete package log and exit receipt are under `docs/plans/verify-conformance-oracles/package-test.*`.

A fresh memory-only Node control also confirms the host-symbol concern on this exact runtime: enable `createHook({init(){}})`, create a Promise inside `new AsyncLocalStorage().run(...)`, then attach an enumerable `Symbol("label")` property. `Object.getOwnPropertySymbols(promise)` reports `async_id_symbol`, `trigger_async_id_symbol`, `kResourceStore`, and the user `label`, all enumerable. Only key descriptions/identity flags were printed; private context values were not inspected or exposed. Thus blanket enumeration cannot safely infer user ownership from enumerability. This observation revalidates the environment-dependent premise of the previously documented blocker.

The baseline-tracked public host contract confirms this classification: `git show 51f580428c75d2405c67b5fd719f88c54fab5d4f:packages/safe-js/README.md`, lines 424–432, says native Promise string data properties are copied, symbol properties are omitted because they can carry private host async-context state, and user-symbol admission remains unresolved. The failing fixture asks for future admission beyond that current contract. It remains a failing gate and unresolved requested capability, not a mislabeled ECMAScript product defect.

## Parent import-boundary regression control

Independent review found that initially placing the shared validator in `result.ts` caused report/isolation imports to load guest runtime modules into the parent process. This was introduced by the harness repair itself, so it was corrected before delivery. A new memory-only `import-boundary.test.ts` mocks `object-model.js` and `values.js` to throw on import; importing `report.ts` and `isolate.ts` must still succeed. Before the move, `npx vitest run packages/safe-js/test/conformance/import-boundary.test.ts` failed **2/2**, with both traces pointing to `result.ts:1`. The validator now lives in dependency-free `execution-result.ts`; `result.ts` remains solely the guest outcome classifier. No forwarding wrappers, elapsed-time assertions, or budget changes were added.

Final focused receipt after this move: `npx vitest run packages/safe-js/test/conformance` → **11 files, 204 tests passed**, no skips, 5.74 s total (3.04 s test time). This includes every reporting/producer mutation repair and both import-boundary controls. Files: `docs/plans/verify-conformance-oracles/final-conformance-tests.log` and `.exit` (`0`). The broad package run already in flight predates discovery of the new boundary-test file; the complete final conformance run supplies its coverage without repeating the costly broad gate.
