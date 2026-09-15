# Array length assignment qualification

Acceptance remains open. This increment repairs QB-ARRAY-BOX and QB-ARRAY-ORDER from the existing ledger. It does not supersede other categories or claim their focused audits passed.

## Contract and provenance

The target remains ECMA-262 edition 16 and ECMA-402 edition 12, June 2025; the existing separately tracked extension pins are unchanged. ArraySetLength (10.4.2.4) converts the supplied value twice, in ToUint32 then ToNumber order. Ordinary assignment first checks the writable descriptor. No proposal API was added.

Base HEAD: `bf8bb1dd67cfbeba967d9bf1c7f2a9ea34d3c439`, plus inherited dirty source. `source-before.json` records the precise input file hashes and Node/ICU versions. `runtime.patch` contains only this increment's source change. The initial successful corpus records maintained source closure `9e8b9d9685b4a72bc58c46c7aa0279a91c5ea33664a8f9dc14338145c56e6f52`, Test262 `419d3e0a2273ba01a3bfcbec423f2801425b8e93`, Node 22.23.2 / ICU 78.2 / V8 12.4.254.21-node.56. Dirty-tree observations are not clean-HEAD qualification.

## Evidence reuse and remaining categories

`reconciliation.json` independently rechecks 216 original report hashes, exact source/runtime/limits, 53,876 fixture hashes and harness hashes. It reproduces 93,220 passed / 6,388 failed / 3,318 unsupported at historical source `a4476e3fabf1bf5f3c492aa76f38ff0bf3d05e46`. All 108 category rows retain actual results and exact owners. Overlapping parent rows cannot be summed. Reproduce with the prior `bigint-construct-20260913/reconcile.py`, directing its OUT variable to a fresh directory; the algorithm was executed unchanged apart from its output destination.

`focused-integrity.json` verifies all 255 linked focused artifacts: zero missing or changed. This establishes artifact integrity, not current acceptance. The previous BigInt receipt is at base `e07a8fd3a0db21495cc0b14c6d7321fa0df4610e`, closure `7a24ccf822b66275857569905882340a89bfc3fc486d68c30b72eb2b8ae305d0`, with 154/154 corpus passes. Its two owned source hashes are separately checked in the terminal receipt. The Array runtime change prevents claiming identical whole-source closure afterward.

The existing [6,777 indexed nonpasses](../reconciliation-20260913/unresolved-variants.json.gz) remain individually addressable. Only the two named Array defects are superseded here. QB-ARGUMENTS-ITERATOR, QB-DATE-PRECISION, QB-SYMBOL-REALM, QB-THROWTYPEERROR-REALM, QB-CALLER and category-wide QB-REVISION/QB-EDITION/QB-REVALIDATE/QB-MATRIX remain unresolved. QB-MATCH-EDITION remains an edition mismatch, not a repair request. Recorded RegExp indices timeouts, RGI budget rejections and minimum-runtime Unicode prerequisites remain failures. No unchanged full RegExp corpus was repeated or claimed passing. Missing host authority by design is not reclassified as a defect.

## TDD and review

`red.log`: four failures and one passing nonwritable negative control. Native assignment attempted conversion on sandbox objects and threw before guest valueOf/Proxy hooks. `green.log`: the original five cases pass after routing length assignment through the existing descriptor-definition implementation. The assignment-specific writable check remains before coercion. No new abstraction, duplicate coercion algorithm, host authority, or proxy-only function was added; the Promise continuation only adapts the definition result to the assignment's void return contract.

`focused.log`: the initial candidate passes 111/111 tests across five files, zero skips. Eight new regressions cover boxed values, observable Proxy lookup/call ordering, unequal conversion rejection, nonwritable rejection before conversion, partial truncation on a nonconfigurable index, second-conversion exceptions, fatal caller-budget propagation, and subclass identity through pending/completed JSON replay. Existing Proxy assignment and Array species tests pass. The existing definition path retains operands during conversion and releases them in finally. No snapshot format, cancellation mechanism, CLI/SDK surface or regex engine changed. No visual CLI screenshot is warranted by this internal change.

`corpus.jsonl`: complete=true, two original pinned Array files / four variants, four passed, zero failed/unsupported/metadata errors/execution errors, exit 0. Default 3,000 ms variant and 10,000 ms startup deadlines and budget defaults are unchanged. These are actual fixture results, not property inventory checks. No budget, assertion, timeout or supported runtime was weakened.

## Broader-gate correction

The first maintained package run was terminated after concrete failures appeared; `package-tests.log` is incomplete and is not an all-package pass. Two existing Array.from tests exposed a regression in the first candidate: routing primitive numeric length assignments through descriptor definition changed retained-data representation, rejecting 29,602 > 20,000 and 6,664 > 4,000. The final patch routes only nonnumeric values through guest conversion and preserves the existing numeric path. No budget was raised. `expanded.log` confirms both Array.from controls pass afterward (545 passes / one separate String failure).

The same run discovered a bare-interpreter String/RegExp mismatch, repaired separately in [the following atomic increment](../regex-bare-interpreter-20260913/qualification.md). That increment's final focused run covers both final source changes: 593 passes, zero skips. Its final corpus and package receipts supersede the earlier candidate runs. The initial five-case green log and four-variant corpus remain accurate observations of their earlier exact source, not final-source certificates.

`job-order-control.json` records the executable source and exact expected trace: both synchronous coercions, assignment, then both Promise callbacks. `length-budget-controls.json` records a passing boxed length 128 and fatal 129 > 128 rejection that survives guest catch and returning finally. Both source-SDK probes exit 0 with their assertions intact; they add no test source and do not replace the pinned fixtures. Reproduce each recorded source with `run`, using the recorded Budget for the capacity controls.

## Reproduction

From the repository root, with a fresh corpus report filename:

```sh
node node_modules/vitest/vitest.mjs run packages/safe-js/src/interp/array-length-coercion.test.ts packages/safe-js/src/interp/guest-proxy-set.test.ts packages/safe-js/src/interp/guest-proxy-set-expression.test.ts packages/safe-js/src/interp/guest-proxy-array-species.test.ts packages/safe-js/src/interp/methods/array-species.test.ts
npx eslint packages/safe-js/src/interp/interpreter.ts packages/safe-js/src/interp/array-length-coercion.test.ts
node --import tsx packages/safe-js/test/conformance/command.ts --corpus /tmp/safejs-regexp-test262-419d3e0 --include built-ins/Array/S15.4.5.2_A3_T2.js --include built-ins/Array/S15.4.5.2_A3_T1.js --report <fresh-report.jsonl>
/Users/kjopek/.nvm/versions/node/v18.20.8/bin/node node_modules/vitest/vitest.mjs run packages/safe-js/src/interp/array-length-coercion.test.ts
npm run test:unit --workspace=@poe-code/safe-js
```

Final check outcomes and preservation are recorded in `receipt.json`. No exact-minimum-runtime, Workerd or installed-artifact acceptance is inferred from the selected Node18 control.

## Delivery

The atomic local commit is separate from remote-main delivery and release publication. No push was requested in this increment. There is no verified remote delivery or new release receipt. All named category/revision/edition/runtime blockers remain open; this is a narrow repair, not completion of qualify-builtins.

## Terminal maintained checks

Final maintained SafeJS unit gate: **1,397 files passed / two files skipped; 30,053 tests passed / 47 skipped / zero failures**, exit 0. Skips remain separately visible: one opt-in parse fuzz case, two unavailable native Math.f16round comparisons, 33 filesystem reference gaps, and eleven unavailable native Temporal.Instant cases. No unavailable case is counted as a pass. The selected maintained workspace build passes, including **eight built-import checks**, zero skips/failures. ESLint passes on all four edited/new source files. Exact commands and hashes are in the final receipt.
