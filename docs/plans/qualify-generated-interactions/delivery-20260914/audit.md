# GI-1 reconciled delivery audit

Compatibility remains ECMA-262 edition 16 / ECMA-402 edition 12 (June 2025), Test262 `419d3e0a2273ba01a3bfcbec423f2801425b8e93`, with resource management separately tracked at `38c13295dc20c2273ba0a6ed82555f1fabb37764`. No target expansion, runtime repair, assertion relaxation or authority expansion occurs here.

`campaign.md` preserves the original Markdown campaign. Its historical paths and candidate-runtime observations are historical, not claims about this delivered source. The two `.ts.txt` fixtures preserve exact probe source; execute them temporarily in the maintained adversarial directory, using its existing random/report helpers. Do not install these as default tests in remote main: module admission is not present there. This delivery is evidence only.

```sh
cp docs/plans/qualify-generated-interactions/delivery-20260914/generated-interactions.test.ts.txt packages/safe-js/test/adversarial/generated-interactions.test.ts
cp docs/plans/qualify-generated-interactions/delivery-20260914/generated-interactions-counterexamples.test.ts.txt packages/safe-js/test/adversarial/generated-interactions-counterexamples.test.ts
node packages/safe-js/scripts/numberformat-data.mjs
SAFEJS_ADVERSARIAL_SLOW=1 node node_modules/vitest/vitest.mjs run packages/safe-js/test/adversarial/generated-interactions.test.ts packages/safe-js/test/adversarial/generated-interactions-counterexamples.test.ts --reporter=json --outputFile=<fresh-results.json>
```

Only copy if those paths are absent; preserve any concurrent files. Enforce a 30-second external subprocess watchdog; `command.json` records the executed argv, environment, versions, exit and duration. All generated budgets remain 10,000 steps, 32 depth, 128 array length, 4,096 string length, 1,000,000 bytes and 500 ms deadline, with 2,000 ms test timeout. Coverage is 24 parameter rows under three deterministic seeds, five templates per row, 12 return/12 throw branches. Counts are not conformance percentages. Native Proxy/eval controls are qualified by explicit spec results; completed replay is only for closed guest histories. Cancellation uses only registered `cap.stop`; module resolution admits only the literal fixture graph.

## Fresh terminal accounting

| Source                                                                         | Node / ICU     | Passed | Failed | Skipped | Seconds | Exit |
| ------------------------------------------------------------------------------ | -------------- | -----: | -----: | ------: | ------: | ---: |
| Local HEAD 59a3edd8192f01edd7957cafceb4d72fa8730c53 plus preserved dirty bytes | 22.23.2 / 78.2 |    124 |      2 |       0 |    8.84 |    1 |
| Fetched main eff793d5dfda1b4e6d1008b04f5da4033237f742 plus exact probes        | 22.23.2 / 78.2 |     99 |     27 |       0 |    8.63 |    1 |

Neither run timed out. `local-source.json` fingerprints local inputs and staged diff; `source.json` pins remote runtime/helper and probe hashes. Commands and full JSON failure messages are retained separately. The local abbreviated SHA above is descriptive; the exact SHA in `local-source.json` is authoritative. The original checkout is not merged, rebased or reset. The delivery checkout is detached at fetched main; no branch or force-push is used.

## Counterexample disposition

**GI-PENDING-DISPOSAL — blocking product snapshot contract.** Both hosts execute the original to return 1 but pending dump/restore fails validation. Minimal retained programs:

```js
async function f() {
  await using r = { async [Symbol.asyncDispose]() {} };
}
await f();
return 1;
async function f() {
  await using r = { [Symbol.asyncDispose]() {} };
}
await f();
return 1;
```

Actual errors are `Expected a guest heap array` at heap 924 and `Wrong guest heap reference kind` at heap 920. Removing the resource (`async function f(){await 0}await f();return 1`) or removing nested async ownership (`await using r={async [Symbol.asyncDispose](){}};return 1`) passes pending replay. These are fast success-asserting regressions, not expected-error passes. Manual grammar deletion established the retained reductions; the maintained synchronous line minimizer cannot evaluate asynchronous dump failures. No parallel QA executable was added. Ownership: snapshot/async/resource integration. Recovery: repair pending snapshot graph ownership with TDD against these exact assertions and rerun the unchanged campaign. This is not an evidenced original-execution ECMAScript defect.

**GI-REMOTE-MODULE — blocking missing integration capability.** Remote `run("export {};", {sourceType:"module"})` rejects at line 1 column 1, while its `run("return 1")` neighbor passes. The 24 generated module rows fail at entry export admission. Remote RunOptions lacks the candidate sourceType/sourceResolver surface; importing the entire concurrent candidate implementation is not a qualified repair. Ownership: source-module integration. Recovery: deliver and independently qualify that maintained capability before rerunning the 25 probes. Missing capability by design is not an ECMAScript defect.

No new mismatch class was found. GI-HOST-IDENTITY remains an invalid reference-identity oracle; the explicit copied Error data and cancellation/call-depth contract passes. GC/finalizer scheduling, other runtime cells and upstream conformance were not newly executed here. No historical receipt is relabeled as current or published evidence.

## Acceptance and delivery

The declared bounded campaign completed, with reproducible seed evidence and every mismatch recorded as a blocking counterexample. Semantic recovery remains blocked; this is not a successful compatibility qualification. The delivery is documentation only. Local commit, verified remote ancestry and workflow/publication receipts are recorded separately in the evidence index after execution. No associated issue was supplied. No local publication is permitted or attempted. If root release validation fails, preserve its diagnostics and follow a verified successor containing this commit after a separate tested repair; do not claim the prior scoped 0.1.604 publication as this task's release.
