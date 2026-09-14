# Remaining built-in category QA

Target: ECMA-262 edition 16 / ECMA-402 edition 12 (June 2025). Keep extension and corpus pins from the parent ledger. Run from the repository root. This plan is manual QA; the JSON files contain data and receipts.

1. Capture HEAD, all SafeJS file hashes, staged-diff hash, ledger prefix and Node/ICU. Verify the recorded historical 216 batch reports and 53,876 fixtures using the preceding reconciliation utility with a fresh output directory. Verify all 255 linked focused artifacts. Compare previous repairs' owned source hashes separately from full source closure.
2. Execute the exact argv in `corpus-command.json`. Selection is one unresolved historical case and its recorded control for each of twelve remaining categories. Inspect failures individually and keep unchanged variant deadlines and budgets. Never sum overlapping category parents. Save raw reports even on exit 1.
3. Run the source-SDK controls in `controls.json`, interpreting each source as a function body with `run(source)`. Compare the guest result to the fixed expected value. Use `node:vm` `runInNewContext('(function(){'+source+'})()')` as an isolated negative/comparison control; native execution does not define the edition. For the replay case, dump the pending execution, restore its JSON, rerun with the snapshot, then repeat from a completed dump. Save each outcome separately.
4. Repeat the controls on exact Node 18.18.0 using `npx --yes --package=node@18.18.0 node --loader tsx --input-type=module`. Default Node uses `node --import tsx --input-type=module`. Record engine/ICU and loader warnings. An unavailable runtime is unverified, never passed.
5. Inspect the selected fixture text and retained standard algorithm extracts. Assign each actual nonpass a stable named blocker with expected/actual result, owner and target applicability. Performance timeouts are not semantic counterexamples. Confirm there was no source/index mutation and the entire original ledger prefix survives before appending disposition.

The audit validated a typed-array integrity defect and added a minimal TDD repair. Run the focused selection, workspace unit gate, scoped ESLint and selected workspace build recorded in the terminal receipt. Inspect the actual affected corpus after the build has completed: provenance includes dist files, so a simultaneous build invalidates corpus qualification. No CLI layout or options changed, so no visual screenshot is required. Historical gates retain their original identity; these probes are not broad-gate replacements. Bun, Workerd, other runtime cells and installed publication remain unverified here.

## Source-SDK observation command

Pass this block on stdin to the Node invocation in step 4, redirecting stdout to a new JSON receipt. Exit 0 indicates observations were recorded; per-case `pass` and `replayPass` determine semantic outcomes. Use an async native wrapper for the two replay cases. The initial Node22 receipt used a synchronous native wrapper and retains those two tooling SyntaxErrors; corrected observations are separate.

```js
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {isDeepStrictEqual} from 'node:util';
import {run} from './packages/safe-js/src/run.ts';
import {dump} from './packages/safe-js/src/dump.ts';
import {restore} from './packages/safe-js/src/restore.ts';
const rows=[];
for (const c of JSON.parse(readFileSync('docs/plans/qualify-builtins/remaining-categories-20260913/controls.json','utf8'))) {
  const row={id:c.id,expected:c.expected};
  try { row.native=await runInNewContext('('+(c.replay?'async ':'')+'function(){'+c.source+'})()'); } catch(e) { row.nativeError={name:e.name,message:e.message}; }
  const execution=run(c.source);
  const observed=execution.catch(e=>({error:{name:e.name,message:e.message,code:e.code}}));
  if(c.replay){try{const state=restore(JSON.parse(await dump(execution)),{source:c.source});row.pendingReplay=(await run(c.source,{snapshot:state})).returnValue;}catch(e){row.pendingReplayError={name:e.name,message:e.message};}}
  const value=await observed;
  if(value.error)row.guestError=value.error;else row.guest=value.returnValue;
  if(c.replay){try{const state=restore(JSON.parse(await dump(execution)),{source:c.source});row.completedReplay=(await run(c.source,{snapshot:state})).returnValue;}catch(e){row.completedReplayError={name:e.name,message:e.message};}}
  row.pass=!row.guestError&&isDeepStrictEqual(row.guest,c.expected);
  if(c.replay)row.replayPass=!row.pendingReplayError&&!row.completedReplayError&&isDeepStrictEqual(row.pendingReplay,c.expected)&&isDeepStrictEqual(row.completedReplay,c.expected);
  rows.push(row);
}
console.log(JSON.stringify({runtime:process.versions,rows},null,2));
```

## Repair and resource checks

- Reproduce the six failing / two passing pre-repair maintained cases from `red.log`; the final test file extends this with shared-buffer and getter-isolation controls. It must pass without changing any budgets or timeouts.
- Run `node node_modules/vitest/vitest.mjs run packages/safe-js/src/interp/resizable-typed-array-integrity.test.ts` on the declared Node cells in `runtime-test-commands.json`. Classify missing resizable/growable buffer prerequisites separately from assertion failures.
- Build with `npm run build:workspaces -- --workspace=@poe-code/safe-js`, then use the exact `source`, `budgetSource` and budget in `built-sdk-controls.json` through the built `run`, `lint` and `Budget` exports. Require the recorded result, zero error diagnostics, unchanged host prototype property, and fatal budget rejection even through guest catch/finally. No host object or native prototype is supplied to guest code.
- Inspect every timed-out fixture's loop domain. Repeat only the deterministic boundary samples saved as executable function bodies in `timeout-controls.json`, using their stated budget. These independent semantic controls do not complete or pass the original timed-out loops.
- For source-SDK controls before the repair, compare results to `source-before.json`; for the first RAB candidate, use `candidate-source.json`; for the final mutation/query repair use `final-candidate-source.json`. Do not conflate those candidate closures.

## Final query correction

Reproduce the fixed-view query mismatch in `query-red.log` against the intermediate mutation-only candidate. Compare edition-16 `sec-testintegritylevel` and `sec-typedarray-defineownproperty`, not native isSealed. The final twelve-case regression source is archived in `test-versions.json`. Run the final affected corpus after the final build, adding Object/isSealed and Object/isFrozen to the earlier prefixes. Preserve both incomplete package attempts and require a complete `package-test-final.log`.

Execute each source in `query-sdk-controls.json` via the built SDK. For its replay case, dump/restore pending and completed executions as in the preceding observation block. Execute `cli-controls.json` sources using built `runCli`, injected readFile/stat and captured Writable streams; require the recorded exit/result/error for each case and leave fs authority disabled. Inspect the captured CLI output; the formatter/layout was not changed.
