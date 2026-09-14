# String split admission and resource/timing qualification — 2026-09-14

Disposition: the declared local matrix passes, including both fresh maintained repetitions; overall acceptance/publication remain incomplete because the previously validated published scan-accounting gap remains open. Earlier timing failures are retained, not discarded.

## Source, target and authority

Tested base local main SHA: `316c9c5b1f8eb7783ffb2636c90aced7345c38c4`. The working tree contains inherited changes; HEAD alone does not identify the candidate. Local `source.json` fingerprints all SafeJS package inputs (receipt SHA-256 `eeed087de66c517f670bbd9f380de8213f905eeebc5c009d7f97c25065b4c8fc`). Task-owned repaired string source SHA-256: `878fa473608cf0f4531490c9b549b84d77c478c9e887c708e824b1b88d0dd612`; new regression SHA-256: `d645c114c40035b5a50a8c0afd439cbf68800802df58fb481b3fce4732188f70`. Raw receipts, profiles and logs are local diagnostic evidence, not committed artifacts. The owned change is independently described below and isolated from inherited source changes.

Compatibility stays **ECMA-262 edition 16 / ECMA-402 edition 12 (June 2025)** and the existing explicitly tracked newer API pins. Test262 pin remains `419d3e0a2273ba01a3bfcbec423f2801425b8e93`. No runtime support, authority, limits, assertions or deadlines changed. Missing ambient process/require/fetch and host capability admission remain intentional; they are not ECMAScript defects.

Environment: Darwin arm64, 15 logical CPUs, 24 GiB RAM. Node22.23.2 / ICU78.2 is the build, accounting, profile and maintained-scheduler runtime. Representative focused repetitions additionally use Node20.20.0 / ICU77.1 and Node24.14.0 / ICU78.2, three repetitions per runtime, CI=1, two workers. No claim of Ubuntu CI, Bun, Workerd, separately excluded virtual-bash or whole-floor-runtime certification is made by this increment.

## Validated overhead and repair

String-separator split previously materialized the native output array, then used `.map` to validate every string into a second array, and only then checked the array-length budget. The deterministic witness `a,b,c` split at comma under arrayLength 2 performs three unnecessary output-string checks before rejecting length 3. The corrected red test reproduces **one failure / two passing controls**. This is avoidable admission/fixture runtime overhead, not a newly demonstrated successful guest budget bypass.

The repair checks container length first, validates output strings in place, and removes the proxy-only `splitString` helper. The native first result array still allocates before length admission; this residual cost is not hidden. String checks are preserved on every admitted slot. Exact limit 2, explicit split limit, UTF-16 surrogate slots, string rejection, retained-root cleanup and trusted check suspension pass. Trusted suspension is explicit internal host authority and does not truncate output. No new authority is granted. If both output budgets fail, container admission now rejects first; neither limit is weakened.

Initial red and initial green attempts had an incorrect test expectation: required separator coercion also invokes allocateString. That tooling/test mistake is retained as a failed attempt. The corrected expectation permits exactly the separator coercion and zero output-string visits; it still fails against the preimage and passes after repair. Corrected green full string-method/independent/lazy/new admission selection: **844 passed / zero failed / zero skipped**. An independent local-HEAD archive with only this repair and three new tests also passes **844 / zero / zero**. It reuses installed dependencies and identical ignored generated Intl assets; it is not a clean-install check. The first archive launch copied assets from the wrong directory and fails all four suites at startup with ERR_MODULE_NOT_FOUND; corrected asset path `packages/safe-js/src/intl-data/dist` passes. Neither startup failure nor an empty test count is treated as a semantic pass.

## Deterministic accounting audit

The maintained selection passes **440 tests / zero failures / zero skips**, including the three new admission tests. It exercises work/string/array/data/call-depth checks across coercion, dynamic eval/module source, property metadata and symbols, regex aggregate/public scan admission, host collection/promise/shared admission, realm ownership, restored replay graphs and failed-charge rollback. Fatal work rejection retains consumed work while depth/roots unwind; failed data charges preserve current/peak counters; trusted native Proxy rejection and descriptor mutation keep their existing authority controls. The published artifact is separately open below; these results do not assert universal absence of bypasses.

Exact command (the prior nonexistent cli-runtime.test.ts filter is removed; it contributes no passes):

```sh
npm exec -- vitest run packages/safe-js/src/interp/promise-symbol-retained-accounting.test.ts packages/safe-js/src/interp/arguments-accessor-budget.test.ts packages/safe-js/src/interp/array-buffer-capacity-budget.test.ts packages/safe-js/src/interp/await-allocation-budget.test.ts packages/safe-js/src/interp/budget-owner.test.ts packages/safe-js/src/interp/budget-realm-views.test.ts packages/safe-js/src/interp/budget.compile-guard.test.ts packages/safe-js/src/interp/budget.test.ts packages/safe-js/src/interp/data-budget.test.ts packages/safe-js/src/interp/datetimeformat-requested-options-accounting.test.ts packages/safe-js/src/interp/finalization-held-accounting.test.ts packages/safe-js/src/interp/function-realm-budget-reuse.test.ts packages/safe-js/src/interp/globals/eval-budget.test.ts packages/safe-js/src/interp/globals/intrinsic-context-budget-reuse.test.ts packages/safe-js/src/interp/globals/iterator-to-array-budget.test.ts packages/safe-js/src/interp/globals/weak-ref-budget.test.ts packages/safe-js/src/interp/host-promise-property-budget.test.ts packages/safe-js/src/interp/host-reconciliation-budget.test.ts packages/safe-js/src/interp/measure-record-budget.test.ts packages/safe-js/src/interp/native-promise-admission-budgets.test.ts packages/safe-js/src/interp/pending-promise-proof-budget.test.ts packages/safe-js/src/interp/promise-property-budgets.test.ts packages/safe-js/src/interp/regex/aggregate-scan-budget.test.ts packages/safe-js/src/interp/retained-root-accounting.test.ts packages/safe-js/src/interp/shared-host-budget.test.ts packages/safe-js/src/interp/shared-scope-accounting.test.ts packages/safe-js/src/interp/string-coercion-retention.test.ts packages/safe-js/src/interp/symbol-registry-accounting.test.ts packages/safe-js/src/interp/typed-array-symbol-accounting.test.ts packages/safe-js/src/modules/source-linking-budget.test.ts packages/safe-js/src/modules/source-request-budget.test.ts packages/safe-js/src/parse/eval-source-budget.test.ts packages/safe-js/src/parse/module-source-budget.test.ts packages/safe-js/src/run.pending-proof-future-budget.test.ts packages/safe-js/src/run.promise-property-key-budgets.test.ts packages/safe-js/src/run.replay-input-allocation-budgets.test.ts packages/safe-js/src/snapshot/preflight-budget-diagnostics.test.ts packages/safe-js/src/snapshot/replay-transaction-qualification.test.ts packages/safe-js/test/integration/budgets.test.ts packages/safe-js/src/interp/measure-symbol-mutation.test.ts packages/safe-js/src/interp/regex/public-scan-accounting-qualification.test.ts packages/safe-js/src/named-host-policy.test.ts packages/safe-js/src/realm-resource-ownership.test.ts packages/safe-js/src/cli.test.ts packages/safe-js/src/interp/methods/string-split-admission.test.ts --maxWorkers=2 --reporter=json --outputFile=docs/plans/qualify-resource-and-timing-behavior/admission-review-20260914/accounting.json
```

The first accounting-command launcher failed before executing tests (`ValueError: list.index(x): x not in list`): it searched for a separate `--outputFile` argument although the stored command uses `--outputFile=...`. The corrected launcher changes only the output receipt path, adds the new test and removes the previously nonexistent filter; the failed launch contributes no passes.

Other manual checks, on the exact owned runtime/test bytes: scoped `npx eslint packages/safe-js/src/interp/methods/string.ts packages/safe-js/src/interp/methods/string-split-admission.test.ts`, normal `npm run build`, and repository `npm run lint` all exit 0. Full repository lint includes ESLint, types/contracts and workflows. No workflow unit tests, wall-clock unit tests, README edits or visual CLI changes were authored. No screenshots are needed for this nonvisual runtime repair.

## Repeated unchanged original workloads

All nine complete five-file repetitions pass **837 tests each: 7,533 passes / zero failures / zero skips**. Command for each runtime, repeated three times sequentially:

```sh
CI=1 <node-executable> node_modules/vitest/vitest.mjs run packages/safe-js/src/run.completed-replay.test.ts packages/safe-js/test/adversarial/snapshot-mutation.test.ts packages/safe-js/src/interp/float32-camera.test.ts packages/safe-js/src/interp/methods/string-split.independent.test.ts packages/agent-harness/src/testing/replay-equivalence.test.ts --maxWorkers=2 --reporter=json --outputFile=<sample-receipt.json>
```

Executables: `/Users/kjopek/.nvm/versions/node/v22.23.2/bin/node`, `/Users/kjopek/.nvm/versions/node/v20.20.0/bin/node`, `/Users/kjopek/.nvm/versions/node/v24.14.0/bin/node`. Their resolved commands/versions, initial load, start/elapsed and exit are retained in local `matrix.json`; no test-name filter or fixture reduction is used. Each existing snapshot inner 750 ms assertion passes; per-test totals below include setup and are not that inner interval.

| Runtime/sample | Elapsed s | Replay max ms | Snapshot total ms | Camera max ms | Split max ms | Harness max ms |
|---|---:|---:|---:|---:|---:|---:|
| node-22.23.2-workers-2-1 | 17.53 | 932.19 | 545.19 | 1307.07 | 285.45 | 1276.19 |
| node-22.23.2-workers-2-2 | 16.61 | 1002.06 | 553.55 | 1351.51 | 302.82 | 1346.82 |
| node-22.23.2-workers-2-3 | 15.62 | 793.75 | 491.41 | 1461.12 | 282.87 | 1154.91 |
| node-20.20.0-workers-2-1 | 19.68 | 976.26 | 639.52 | 1266.27 | 122.2 | 1514.55 |
| node-20.20.0-workers-2-2 | 18.15 | 826.9 | 521.05 | 1222.47 | 101.29 | 1380.4 |
| node-20.20.0-workers-2-3 | 18.01 | 905.15 | 527.24 | 1214.6 | 111.3 | 1342.55 |
| node-24.14.0-workers-2-1 | 14.77 | 741.0 | 444.69 | 1047.73 | 648.41 | 1093.83 |
| node-24.14.0-workers-2-2 | 15.56 | 939.42 | 470.19 | 1120.37 | 671.77 | 1005.33 |
| node-24.14.0-workers-2-3 | 14.34 | 737.69 | 436.21 | 1043.94 | 678.68 | 1021.77 |

All **18** inspector-profiled original-workload samples pass unchanged assertions: three each for 128 draws/three replay generations, the current complete 96-case snapshot corpus, each of three complete historical camera fixtures, and the reported split with own undefined capture oracle. Camera preserves both structured-value and recorded JSON comparisons. Diagnostic 5,000 ms comparisons all pass; they are not new unit-test deadlines. Exact workload code and inspector instructions: [profile-command.md](profile-command.md). Native output is only a control; the original edition-16 split oracle and fixture hashes are unchanged.

| Profiled workload | Three elapsed samples, ms |
|---|---|
| historical-replay-128 | 1033.27, 862.67, 825.28 |
| snapshot-current-96 | 245.91, 238.35, 238.63 |
| historical-camera-inverse-coordinate-transforms:camera-axis-frustum-typed | 1259.47, 1169.15, 1164.81 |
| historical-camera-inverse-coordinate-transforms:camera-oblique-frame-typed | 1056.38, 1081.48, 1074.99 |
| historical-camera-inverse-coordinate-transforms:camera-offset-handoff-typed | 876.99, 882.69, 906.44 |
| split-reported | 15.3, 13.04, 12.37 |

Six local CPU profiles and top-self-CPU summary retain original measurements, Node/ICU/environment and sample count. Retained graph traversal remains prominent in replay/camera; no mutable-graph cache, traversal omission, coverage reduction or timing speedup is claimed for this split repair. Historical full-scheduler camera 6,224/8,312 ms against 5,000 ms, later harness 5,225/5,000 ms and cleanup EPERM failures remain material variability evidence. Finite new passes do not erase those failures or guarantee arbitrary-load timing.

## Maintained concurrency receipts

Two sequential exact `CI=1 npm test -- --concurrency=4 --exclude-workspace=virtual-bash` attempts were launched after task-owned build, lint, profiles and focused measurements finished. Membership/dependencies and uncached execution come from maintained declarations, including native pre/post tasks and repository-local Git-variable clearing. No substitute root-only or fixed-count route is used. Virtual-bash exclusion follows the previously declared representative maintained matrix and remains unverified, not counted as a pass.

First terminal receipt: **exit 0, 637.45 seconds**. SafeJS **30,645 passed / zero failed / 47 skipped** in 1,447 files; shared task **22,603 passed / zero failed / two skipped**; terminal-pilot **288 passed**; native posttest **two passed**. All original timing workloads pass and no EPERM is reported. **Second terminal receipt: exit 0, 740.30 seconds**, with the same per-task pass/skip totals and successful native posttest. All original timing workloads pass again; neither run reports EPERM. Total elapsed time is 16.1% higher in the second sample; this is retained variability, not discarded as an outlier. Raw terminal logs and maintained-commands.json retain both complete attempts.

SafeJS skip disposition: 33 named memfs-vs-native filesystem reference gaps, seven unavailable native host Temporal.Instant clone controls, four unavailable native Temporal.Instant controls, two unavailable native Math.f16round comparisons, and one opt-in parser-fuzz test. Native/polyfill and independent deterministic controls remain passing; absent native APIs are not counted as passes. The shared task reports two existing skips; their exact identity is not available in the immediate reporter log, so that count is retained without inventing passed coverage. Prior descriptor-review two passes (664.63 / 640.13 seconds) remain prior-candidate evidence, not fresh certification of this increment.

## Release observations and disposition

Fresh read-only commands: `gh api repos/poe-platform/poe-code/commits/main --jq .sha`, `gh run list --limit 6 --json databaseId,headSha,name,status,conclusion,url`, `npm view @poe-platform/safe-js version dist.integrity --json`.

Remote main is `775253e664c8c14502178cf9dcb74e6a656aacb0`. Root Release [34898444904](https://github.com/poe-platform/poe-code/actions/runs/34898444904) is cancelled; schema [34898444408](https://github.com/poe-platform/poe-code/actions/runs/34898444408) succeeds. Scoped safe [34898209657](https://github.com/poe-platform/poe-code/actions/runs/34898209657) succeeds at `8a458a38a443fd3448955ccb10e5ab918f54171e`. Registry latest remains `@poe-platform/safe-js@0.1.603`, integrity `sha512-q1TtPHgl9QSxgzaRQ3y2CIpgQ/FA+ec+9848lA/Gnfq1VmVCR5LhUgqfjyB+iIr7ysgINVPSthaZib16d67BlQ==`. These are other revisions' release receipts, not this task's publication.

The preceding integrity-checked installed-artifact witness remains open: six-character /z/ input at maxSteps100 returns false at constant88 steps instead of rejecting; local inherited aggregate-scan repair rejects at101 and cleans up. No fresh installed-artifact semantic rerun is claimed here; unchanged registry version corroborates the existing receipt, not a new probe. The inherited aggregate-scan runtime repair belongs to its existing owner and is not staged/claimed by this increment. Published gap, delivery and unverified required platform cells keep overall acceptance incomplete. No push was requested or attempted, no remote history was merged, and no successful task release is claimed.

Only the owned runtime hunks, new deterministic test, this report/profile instructions and this increment's evidence append are eligible for its Conventional Commit. Initial staged diff SHA-256 `839e9e04f0f5e07fae2138a1c64a573e924875d6ccbb339c87774d51eaf251a8` is retained for preservation verification. Broad checks certify the fingerprinted dirty combination; isolated string checks qualify only the owned repair. Local commit SHA is reported separately from remote delivery/publication.

Final preservation: all fingerprinted SafeJS source/package inputs remain unchanged through both maintained runs. The initial unrelated staged binary diff still has SHA-256 `839e9e04f0f5e07fae2138a1c64a573e924875d6ccbb339c87774d51eaf251a8`. Commit preparation uses an isolated index to include only task-owned runtime hunks and evidence; unrelated working bytes are preserved. No task push or publication is claimed.

Exact-commit manual checks: isolated scoped ESLint exits 0 and maintained selected build closure `npm run build:workspaces -- --workspace=@poe-code/safe-js` exits 0 against local HEAD plus only the owned runtime patch and new regression. The same isolated archive passes all 844 string tests. This independently validates the exact runtime/test bytes to be committed; broader maintained gates remain qualification of the separately fingerprinted dirty combination.

Commit preflight caught a trailing blank line present only in the isolated overlay and stopped before creating any commit. After normalizing the archive to the staged bytes, the exact 844-test selection, scoped ESLint and maintained selected SafeJS build closure all pass again. No runtime logic, candidate workload or budget changed; exact-byte comparison now passes.


Local split-admission repair receipt: **`87b49c345c304c00e9f9ffbab623b5b58877385f`** (`fix(safe-js): admit split arrays before string validation`). Exact owned runtime/test bytes pass the 844-test string selection, scoped lint and maintained selected SafeJS build closure; candidate normal build/repository lint, 440 accounting tests, nine complete timing repetitions and both maintained concurrency runs pass as recorded above. Unrelated staged/local edits remain preserved. **Remote delivery: not attempted. Task publication: not claimed. Overall acceptance: incomplete; the published 0.1.603 scan-accounting gap remains open.**
