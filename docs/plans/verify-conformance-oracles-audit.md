# Oracle assumptions and independent accounting audit

Task `verify-conformance-oracles`, 2026-09-12, audit source `51f580428c75d2405c67b5fd719f88c54fab5d4f` on main. Original user changes are preserved. This is a manual verification plan executed by the agent; JSON attachments contain observations, not executable QA scripts.

## Fixed specification and public contracts

The target remains ECMA-262 edition 16 (June 2025), ECMA-402 edition 12 (June 2025), Test262 `419d3e0a2273ba01a3bfcbec423f2801425b8e93`, and the extension pins already recorded in the main ledger. Native feature availability cannot redefine that target. Temporal remains separately pinned at `e8cc03fc970a65a3359e8870e3b35e687ac94e55`.

Primary text was fetched from the [published edition](https://262.ecma-international.org/16.0/); clause text and whole-document SHA-256 are retained in [specification-clauses.json](verify-conformance-oracles/specification-clauses.json). The web reader rejected the large single-page edition; `curl -L --fail --silent https://262.ecma-international.org/16.0/ -o /tmp/verify-oracles-ecma262-16.html` succeeded. The first optional BeautifulSoup extraction failed because that package was absent; standard-library HTMLParser then extracted the clauses. These acquisition failures did not produce conformance outcomes.

| Assumption | Exact contract and qualification | Owner |
| --- | --- | --- |
| Correct/incorrect values | ECMA-262 §7.2.9 SameValue; pinned Test262 `assert.js` uses SameValue-style assertions. `assert.sameValue(1+1,3)` throws Test262Error; neighboring expected 2 completes. | verify-conformance-oracles |
| Parse vs runtime errors | ECMA-262 §16.1.5 ParseScript returns errors for grammar/early-error violations; §16.1.6 ScriptEvaluation evaluates the parsed Script. `let = ;` and `throw new SyntaxError()` expose different phases with the same error type. | qualify-language-semantics; harness phase adapter |
| Negative constructor name | Pinned [INTERPRETING.md](https://github.com/tc39/test262/blob/419d3e0a2273ba01a3bfcbec423f2801425b8e93/INTERPRETING.md), `negative`: missing throw, wrong phase, or wrong constructor **name** fails. Constructor identity is not the specified oracle. | verify-conformance-oracles |
| Async completion | Pinned `INTERPRETING.md` `async` and `doneprintHandle.js`: completion/failure print protocol, with timeout failure when completion never arrives. Raw direct `print('Test262:AsyncTestComplete')` is allowed. Trusted fixtures/worker results are assumed; this is not authentication against malicious fixture/worker forgery. | verify-conformance-oracles |
| Unhandled rejection | ECMA-262 §27.2.1.9 HostPromiseRejectionTracker is host-defined; its default returns unused. Treating remaining rejection as test failure is explicit SafeJS harness policy, not a mandatory ECMAScript throw. | qualify-async-job-order; verify-conformance-oracles |
| Blocking capability | ECMA-262 §9.6.2 AgentCanSuspend reads [[CanBlock]]. `CanBlockIsFalse` asks for a nonblocking host. Excluding it is a runner limitation; it does not establish that blocking permission is needed. | qualify-shared-memory |
| Files and variants | Pinned `INTERPRETING.md`: fresh realm/global Script; default sloppy+strict; onlyStrict/noStrict/module/raw adjust modes; `_FIXTURE` files never standalone tests. Original full manifest must remain attached to bounded reports. | complete-conformance-runner; verify-conformance-oracles |
| IsHTMLDDA/agents/GC | Pinned Test262 host API requires explicit host facilities. IsHTMLDDA exists only on supporting hosts. Missing facilities are unsupported observations, not inferred semantic failures or passes. | qualify-environment-contract; qualify-shared-memory; qualify-weak-lifetimes |

[Harness source pins](verify-conformance-oracles/pinned-harness-contract.json) record exact upstream URLs and hashes. No ambient host imports, process access, blocking, shared agent, or collector authority is added.

## Native controls

[Native receipts](verify-conformance-oracles/native-controls.json) include exact executable paths and complete `node -e` command arguments. Each fixture is read unchanged from the clean pinned checkout, with pinned harness includes in a fresh VM realm. Default sloppy and strict variants run separately. Feature probes precede execution. No polyfill is substituted for native support. The separately pinned [Temporal constructor clause](https://github.com/tc39/proposal-temporal/blob/e8cc03fc970a65a3359e8870e3b35e687ac94e55/spec/plaindate.html#L28-L40) defaults an undefined calendar to iso8601; its calendarId accessor returns the stored calendar. Both source clauses are retained in the specification receipt.

| Runtime | Array.of length, 2 variants | Math.f16round non-constructor, 2 variants | Temporal.PlainDate calendar default, 2 variants |
| --- | --- | --- | --- |
| Node 22.23.2 / ICU 78.2 | pass | native unavailable | native unavailable |
| Node 24.18.0 / ICU 78.3 | pass | pass | native unavailable |
| Node 26.8.1 / ICU 78.3 | pass | pass | pass |

All three runtimes also distinguish deliberately wrong arithmetic assertions from passing neighbors, parse SyntaxError from runtime SyntaxError/TypeError, async success/failure markers from no completion signal. These controls validate assumptions; they do not by themselves test SafeJS or qualify the complete feature semantics. Missing native APIs yield `native-unavailable` only. Native `Math.f16round` is supported for the ES2025 control; Temporal is a separately tracked extension control.

## Independent original-corpus reconciliation

The retained [original V4 manifest](complete-conformance-runner/baseline-v4/manifest.json) is unchanged: SHA-256 `c8b428444f7854afcba72fe3bfebcf9b9390dfe2a9714b1c2da36794a6e43617`, manifest ID `547fad76257b2e6e3d5aae1626ead11434d557f8f3d12b2b613aea238dee41a9`. Its execution source is historical `a4476e3fabf1bf5f3c492aa76f38ff0bf3d05e46`, Node22.23.2/ICU78.2, not current audit source. Its reported policy is empty budget options, unlimited configured scalar caps, 3,000 ms per-variant wall limit and 10,000 ms startup limit. Internal policy failures still occurred; the raw detail is retained. No policy was changed by this audit.

Executed independent Python standard-library checks, without importing runner code:

1. `git -C /private/tmp/safejs-baseline-test262-419d3e0 rev-parse HEAD` equals the fixture pin; `git ... status --porcelain` is empty.
2. Recursively enumerate all `test/**/*.js`; compare the sorted full filenames to `manifest.files`. Rehash each original source, each non-JavaScript `fixtureAssets` entry, and each pinned harness file.
3. Parse every one of the 216 original JSONL reports. Require header manifest identity, terminal completeness, selected filenames equal result filenames as multisets, source hash/kind equality, and modes equal the corresponding manifest's variant modes as multisets.
4. Form `filename#mode` identities. Reject duplicates, missing or unselected IDs. Count status rows independently and compare every aggregate count and every aggregate mismatch outcome to the original rows.
5. Compare all 9,706 nonpass IDs, reason/detail values, and referenced passing-neighbor status to the previous independent inventory. Reuse its semantic labels only as historical ownership, never current reproduction.

Result: **53,876 files; 294 JavaScript dependency fixtures; 20 separately enumerated non-JavaScript assets; 102,926 variants exactly once; 93,220 historical passes, 6,388 failures, 3,318 unsupported; zero missing/duplicate/unselected variants or hash/accounting mismatches.** The original aggregate is complete and unsuccessful. There is no historical all-green claim. [Accounting receipt](verify-conformance-oracles/historical-corpus-accounting.json) hashes each report and records counts, policy, original aggregate/inventory hashes, and every non-JavaScript asset. An initial audit-only Counter comparison mistakenly used mapping values as counts; correction to filename multiset and recheck is recorded in the receipt.

## Case-by-case exclusions and policy outcomes

[Case ledger](verify-conformance-oracles/exclusion-resource-cases.json) contains **7,992 individual rows** for all unsupported, timeout, host-error and harness-error outcomes, plus **294 JavaScript fixture exclusion rows and 20 non-JavaScript asset rows**. Each variant retains its original ID, actual result/reason/detail, category owner, explicit disposition and neighboring passing ID when one exists. Complete original identities/hashes/upstream esid links remain in the source inventory pinned by hash. Absence of a neighboring passing case is null, never a fabricated control.

Unsupported counts are module 1,996; shared-memory 974; agent 224; IsHTMLDDA 84; gc 22; blocking-mode 18. Each case's reason explains the missing adapter or host facility. Resource/harness accounting retains 4,488 wall timeouts, 141 harness initialization stringLength failures, 39 runtime budget failures (25 steps, ten stringLength, four dataDepth), and six generator reentry guards. The generator guards remain language-state candidates rather than being dismissed as legitimate capability policy. No historical candidate is declared repaired or reclassified as passed.

[Historical package-skip ledger](verify-conformance-oracles/historical-skip-cases.json) retains all 47 exact names and reasons: 33 filesystem backend/reference gaps, 11 unavailable native Temporal controls, two unavailable native f16round controls, one optional fuzz profile. These are distinct from Test262 unsupported variants. Current conformance tests have zero skips; the fresh package suite has its own receipt and may not inherit a historical outcome.

## Limits and delivery

The full historical execution is not replayed on current source by this accounting audit. Historical semantic candidates, fixture-to-edition membership, host adapters, broader runtime/replay/artifact coverage remain owned missing evidence. Report integrity relies on trusted executed callbacks/worker and source provenance; a consistently fabricated well-formed report cannot cryptographically prove execution. Fail-closed mutations establish protection against the tested wrong results, missing completion/rows, duplicate variants, truncated reports, and premature exits.

No commit, push, verified remote-main delivery, or release was performed for this task. Historical successful releases elsewhere in the ledger do not publish these changes. Fresh selected execution, TDD and maintained-check results are appended in the main ledger as they finish.

A second integration control applies the current maintained `aggregateReports` function to all unchanged historical report rows. `node --import tsx --input-type=module -e` imports `readFileSync`, `readdirSync`, and `aggregateReports`; loads the pinned V4 manifest and all sorted `batches/*.jsonl`; forms each selection report from its terminal summary and result rows; and compares the computed counts to the retained V4 aggregate. [Receipt](verify-conformance-oracles/current-code-historical-aggregate.json) records the identical counts, unsuccessful aggregate and empty unexecuted list. This is a current-code compatibility check for historical report accounting, not fixture re-execution.

The first ad hoc `npx tsx -e` invocation selected CJS loading and failed with MODULE_NOT_FOUND through portable Intl data imports; no result was counted. Explicit ESM import then completed successfully without changes to source or build artifacts.

A deliberate [native feature-gate removal](verify-conformance-oracles/native-feature-gate-mutation.json) on Node22 makes the pinned f16round constructor fixture throw `Test262Error: isConstructor invoked with a non-function value`. Missing support is the cause; it remains native-unavailable, not a SafeJS semantic failure. An initial concern that this narrow test might vacuously pass without the builtin does **not** reproduce because pinned isConstructor.js rejects non-functions. No fix was invented.

Reproduce the current-code historical aggregation check from the repository root with explicit ESM loading (no files are modified):

```sh
node --import tsx --input-type=module <<'JS'
import { readFileSync, readdirSync } from 'node:fs';
import { aggregateReports } from './packages/safe-js/test/conformance/report.ts';
const root = 'docs/plans/complete-conformance-runner/baseline-v4';
const manifest = JSON.parse(readFileSync(`${root}/manifest.json`, 'utf8'));
const reports = readdirSync(`${root}/batches`).filter(name => name.endsWith('.jsonl')).sort().map(name => {
  const rows = readFileSync(`${root}/batches/${name}`, 'utf8').trim().split('\n').map(line => JSON.parse(line));
  return { ...rows.at(-1), entries: rows.filter(row => row.type === 'result') };
});
const actual = aggregateReports(manifest, reports);
const expected = JSON.parse(readFileSync(`${root}/aggregate.json`, 'utf8'));
if (JSON.stringify(actual.counts) !== JSON.stringify(expected.counts) || actual.success !== false || actual.unexecutedVariants.length !== 0) {
  throw new Error('Historical report accounting mismatch');
}
console.log(JSON.stringify({ counts: actual.counts, success: actual.success, unexecutedVariants: actual.unexecutedVariants }));
JS
```

The native receipt contains the full JavaScript command body. Reproduction on a machine without the recorded cache paths may invoke the same body with `npx --yes --package=node@24.18.0 node -e '<body>'` or Node26.8.1 respectively, then verify the emitted Node/ICU versions before comparing results. The fixture checkout must be the clean pinned SHA at the path named in the body, or update only that checkout path. This does not broaden feature availability or substitute a missing cell.

[Excluded operational attempts](verify-conformance-oracles/historical-excluded-attempts.json) were independently audited as well: 18 named attempts preserve original reason, completion/exit information and explicit ineligibility for pass reuse. The two V2 coarse-selection archives have six freshly verified member hashes; the two V3 partial reports plus their logs and a bootstrap-only failure have five freshly verified raw artifact hashes. No archive extraction writes or source changes were made. Unknown process exit codes remain unknown; bootstrap produced no fixture results. V2 remains wholly superseded by its documented dynamic-import oracle defect. These historical records are disjoint from the complete V4 aggregation and current selected result set.
