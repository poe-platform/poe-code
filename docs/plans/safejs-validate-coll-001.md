# Independent COLL-001 validation

## Scope and authority

Validate the working TypeScript implementation in `/Users/kjopek/Workspace/poe-code-safejs-fixes`, initially at `9ef2e738dc177eb2ac96358b1e1a0f9f40fe97dc`. This worker is not the author. No production fixes, README changes, Git mutation, old artifact edits, CLI changes, or certification of MC003/STR03 are permitted.

## Bootstrap qualification

Ancestor and root AGENTS instructions were read. The exact 38 archive exclusions in `inventory-verification.json` match `inventory.json`; the whole `security/` directory is additionally excluded. Bootstrap hashes and the full exclusion list are in `out/safejs-remediation/coll-001-validation/bootstrap.json`.

**Protocol deviation:** Before establishing that exclusion list, the validator misread the security-directory instruction and displayed the six root security metadata/report files (also counted their lines/bytes). No nested examples, evidence, or licenses were read, and nothing was executed. This is not a compliant zero-archive-read bootstrap; the deviation cannot be undone and is retained explicitly. No collection family payload was read before the corrected bootstrap. All subsequent excluded payload reads, hashes, displays, and executions are prohibited.

## Agent-executed QA procedure

1. Read the production diff and iterator/checkpoint implementation independently. Identify ordinary execution and replay invariants before writing tests.
2. Read only allowlisted original collection worklists, growth/deletion/update reductions, and eager-array controls after checking each path against the metadata exclusions. Retain their hashes without changing the original audit.
3. Run the exact original payloads against current `src/run.ts` and separately evaluate native JavaScript for expected values. SafeJS eager collection methods are intentional arrays: materialize native iterators at the same point when testing that contract.
4. Add focused unit tests only in `packages/safejs/src/interp/globals/collections-iteration-validation.test.ts`. Use bounded ordinary data and in-memory checkpoints, never real guest network, filesystem, processes, or LLMs. Keep failing expectations red; do not change production code.
5. Exercise JSON-serialized checkpoint/resume before and after live Map/Set growth, deletion, update, clear/reinsert, and eager-array controls. Compare against independent native results and uninterrupted current TypeScript. Distinguish new regressions from older replay limitations when evidence permits.
6. Run the author tests, relevant broader ordinary-data unit suites, package typecheck, and scoped formatting/lint checks. Record commands, exit status, counts, actual failures, and limitations, without broad security/adversarial runs.
7. Record final SHA-256 hashes of the COLL production and test files, changed paths, authoritative red cases, and ship blockers. No screenshot is needed for headless runtime-only changes.

## Independent verdict

**Qualified PASS for COLL-001 ordinary live iteration and current public `run()` journal replay; NOT an all-green checkpoint certification.**

- The eight exact original audit payloads pass against current TypeScript, including both complete graph worklists, Map/Set growth, Map update/deletion, Set deletion, the deliberately eager Map entries control, and the array-growth control. All six historical direct-collection failures independently reproduce with the two COLL production files read from baseline `9ef2e738dc177eb2ac96358b1e1a0f9f40fe97dc` and substituted in memory. No working-tree production file was reverted or edited.
- All 86 public JSON-serialized checkpoint/replay tests pass: two current-entry-deletion controls, 14 checkpoints across the two original worklists, 64 before/after first/second-visit mutation cases, and six eager-array method controls. This is representative bounded validation, not all possible checkpoint patterns.
- **Eleven raw `interpret()` checkpoint tests remain red** (101 passed / 11 failed / 112 focused tests). They cover growth, delete-next, delete-current final state, clear/insert, and reinsertion for both collections, plus Map value update. Their native and uninterrupted current values agree; raw resume does not. The two original raw deletion tests that only asserted visits pass; asserting remaining membership reveals additional state loss.
- The author suite and relevant broader suites pass: **713 tests in 13 files**, including all 18 author regressions. Package `tsc --noEmit` passes. These green commands do not cancel the 11 red focused cases.
- The retained two-file pre-COLL comparison reproduces raw state loss for both growth witnesses. This is an existing lower-level checkpoint limitation exposed by the newly correct live traversal, **not a demonstrated regression in current public serialized journal replay**. The baseline comparison isolates only the two COLL files, not the entire historical repository; parallel unrelated changes remain current and are not certified here.
- The bootstrap deviation recorded above prevents a clean archive-protocol-compliance claim even though the functional results are reproducible.

### Shipment disposition

No new COLL-specific blocker was found for the ordinary public `run()` path. Do not claim that all raw interpreter checkpoints are fixed or tested green. The author/coordinator must explicitly disposition the retained raw-checkpoint defect and the 11 failing regression tests before treating the complete workspace/release gate as green. The validator does not waive them, mark them expected failures, remove them, or silently fix production. This worker performs no commit, push, or release. A compliant archive-bootstrap rerun requires a fresh validator if the coordinator requires that certification.

The concrete raw finding was reported immediately to the coordinator, then narrowed after the read-only baseline comparison. No additional exhaustive checkpoint research is pending.

## Independent root-cause review

1. Before COLL, `snapshotableIterationValues` in `interp/interpreter.ts` converted direct Map/Set loops to arrays. That captured stale membership and Map values. `getSandboxIterator` in `interp/iteration.ts` separately captured Map entries in an array. Set's shared iterator already used its backing Set.
2. The author's patch removes only the two collection snapshot branches and uses the backing Map iterator. Direct loops now share the existing iterator evaluator; additions, deletions, updates, clear/insert, and reinsertion follow live native iteration in the tested ordinary cases.
3. Explicit `keys()`, `values()`, and `entries()` remain intentionally eager arrays. The exact native execution of original case 14 returns both `start` and `end`; the SafeJS contract correctly returns only `start`. Its independent contract oracle materializes `Array.from(work.entries())` at capture time. This difference is retained, not misreported as native parity.
4. Current `run.ts` uses an interpreter snapshot only when the restored snapshot has no `replay` field and has loop state. Current public snapshots include journal replay; the public tests assert that field and the exact `await pause` source offset. Journal replay reconstructs the initial inputs and loop execution, which is why those tests pass despite the raw numeric-cursor concern.
5. Raw `InterpreterSnapshot` stores a numeric loop index, not an insertion-history cursor. More immediately, `isRestorableBindingValue` excludes `kind: "map"` and `kind: "set"`, so declaration replay recreates collections from initializers and loses mutations already present in the captured snapshot. `cloneSandboxValue` preserves the actual captured collection for these tests; loss is not caused by JSON flattening of a native Map in the validator. Merely serializing a numeric cursor does not establish live-collection replay correctness. No production repair is proposed or applied here.

## Authoritative red witness

```js
const work = new Map([
  ["a", 1],
  ["b", 2],
  ["c", 3]
]);
const visited = [];
for (const [key, value] of work) {
  visited.push([key, value]);
  if (key === "a") work.set("d", 4);
}
return { visited, remaining: [...work] };
```

Capture the second `loop-iteration` breakpoint using `yieldPoint.snapshot()`, clone the bindings with `cloneSandboxValue`, and pass that snapshot to a new `interpret(program, { bindings: globals, snapshot })`. The retained captured Map already contains `d`; its loop index is 1.

| Observation                       | `visited`                           | `remaining`                         |
| --------------------------------- | ----------------------------------- | ----------------------------------- |
| Native independent expectation    | `[["a",1],["b",2],["c",3],["d",4]]` | `[["a",1],["b",2],["c",3],["d",4]]` |
| Current uninterrupted TS          | same as native                      | same as native                      |
| **Current raw resumed TS**        | **`[["a",1],["b",2],["c",3]]`**     | **`[["a",1],["b",2],["c",3]]`**     |
| Pre-COLL uninterrupted comparison | `[["a",1],["b",2],["c",3]]`         | `[["a",1],["b",2],["c",3],["d",4]]` |
| Pre-COLL raw resumed comparison   | `[["a",1],["b",2],["c",3]]`         | `[["a",1],["b",2],["c",3]]`         |

The Set witness replaces the initializer with `new Set(["a","b","c"])`, records each key, and calls `work.add("d")`. Native/current uninterrupted return `{visited:["a","b","c","d"],remaining:["a","b","c","d"]}`; current raw resumed returns `{visited:["a","b","c"],remaining:["a","b","c"]}`. Pre-COLL raw resume also loses `d`.

Both complete graph worklists now return exactly:

```json
{
  "processed": ["start", "lexer", "cache", "parser", "index", "typecheck", "emit"],
  "distances": {
    "start": 0,
    "lexer": 1,
    "cache": 1,
    "parser": 2,
    "index": 2,
    "typecheck": 3,
    "emit": 4
  },
  "path": ["start", "lexer", "parser", "typecheck", "emit"],
  "reachable": 7
}
```

The isolated pre-COLL comparison returns `processed:["start"]`, distances `{start:0,lexer:1,cache:1}`, an empty path, and `reachable:3` for both.

## Commands and results

All commands run in `/Users/kjopek/Workspace/poe-code-safejs-fixes`. Test logs and JSON reports are under `out/safejs-remediation/coll-001-validation/`. No `dist` import, real guest external integration, disk-backed snapshot backend, or executable QA file is used. Tests are in-memory Vitest unit tests; this Markdown is the QA procedure.

### Focused runs, including retained failed attempts

```sh
node_modules/.bin/vitest run packages/safejs/src/interp/globals/collections-iteration-validation.test.ts --reporter=verbose --reporter=json --outputFile=out/safejs-remediation/coll-001-validation/initial-replay-red.json > out/safejs-remediation/coll-001-validation/initial-replay-red.log 2>&1
node_modules/.bin/vitest run packages/safejs/src/interp/globals/collections-iteration-validation.test.ts --reporter=verbose --reporter=json --outputFile=out/safejs-remediation/coll-001-validation/raw-cursor-first.json > out/safejs-remediation/coll-001-validation/raw-cursor-first.log 2>&1
node_modules/.bin/vitest run packages/safejs/src/interp/globals/collections-iteration-validation.test.ts --reporter=verbose --reporter=json --outputFile=out/safejs-remediation/coll-001-validation/raw-cursor-corrected.json > out/safejs-remediation/coll-001-validation/raw-cursor-corrected.log 2>&1
node_modules/.bin/vitest run packages/safejs/src/interp/globals/collections-iteration-validation.test.ts --reporter=verbose --reporter=json --outputFile=out/safejs-remediation/coll-001-validation/expanded-validation.json > out/safejs-remediation/coll-001-validation/expanded-validation.log 2>&1
node_modules/.bin/vitest run packages/safejs/src/interp/globals/collections-iteration-validation.test.ts --reporter=verbose --reporter=json --outputFile=out/safejs-remediation/coll-001-validation/final-focused.json > out/safejs-remediation/coll-001-validation/final-focused.log 2>&1
```

Executed wrappers retained each status with `result=$?`, displayed the log, then `exit "$result"`; no pipe masked a failure.

| Artifact prefix        | Exit | Result                                                                                                      |
| ---------------------- | ---- | ----------------------------------------------------------------------------------------------------------- |
| `initial-replay-red`   | 0    | 2 passed; filename anticipated red but the actual two public replay tests passed                            |
| `raw-cursor-first`     | 1    | 2 passed / 2 validator import failures (`parseModule` not exported by `src/parse.ts`); not runtime findings |
| `raw-cursor-corrected` | 0    | 4 passed after correcting only the validator import to `src/parse/parser.ts`                                |
| `expanded-validation`  | 1    | 101 passed / 11 raw checkpoint failures, 112 total, 2.09 seconds                                            |
| `final-focused`        | 1    | 101 passed / 11 raw checkpoint failures, 112 total, 2.04 seconds, tests 973 ms                              |

The final test assertion reports each raw case name separately rather than allowing Vitest's common-line grouping to hide different diffs. All 11 diffs remain in `final-focused.log` and its JSON report. An earlier ad hoc `dump(execution)` probe captured a loop-entry yield rather than the requested await; it was not accepted as await-checkpoint evidence. The proper tests verify the captured await offset before asserting replay.

### Broader tests

```sh
node_modules/.bin/vitest run packages/safejs/src/interp/globals/collections-iteration.test.ts packages/safejs/src/interp/globals/collections.test.ts packages/safejs/src/interp/globals/object-array.test.ts packages/safejs/src/interp/generator.test.ts packages/safejs/src/interp/patterns.test.ts packages/safejs/src/interp/values.test.ts packages/safejs/src/interp/interpreter.test.ts packages/safejs/src/run.random.test.ts packages/safejs/src/run.completed-replay.test.ts packages/safejs/src/dump.test.ts packages/safejs/src/restore.test.ts packages/safejs/src/snapshot/restore.test.ts packages/safejs/src/snapshot/serialize.test.ts --reporter=default --reporter=json --outputFile=out/safejs-remediation/coll-001-validation/broader-unit.json > out/safejs-remediation/coll-001-validation/broader-unit.log 2>&1
```

Exit 0: **713 passed, 13 files, 4.88 seconds**. This includes the author's seven-file command and focused dump/restore/randomness/completed-replay/serialization coverage. No broad security/adversarial suite was run. Existing slow cases were not modified as unrelated work.

### Typecheck and style

```sh
node_modules/.bin/tsc -p packages/safejs/tsconfig.json --noEmit > out/safejs-remediation/coll-001-validation/typecheck.log 2>&1
node_modules/.bin/eslint packages/safejs/src/interp/globals/collections-iteration-validation.test.ts > out/safejs-remediation/coll-001-validation/eslint.log 2>&1
```

Both exit 0. The package tsconfig excludes test files; the typecheck is a production-package check, not a claim that all test TypeScript is statically checked. Formatting output was applied only to the validator's own files via `apply_patch`.

### Evidence files and owned paths

- `packages/safejs/src/interp/globals/collections-iteration-validation.test.ts`: the only code authored by this validator; 112 tests, including 11 intentionally retained red assertions (not `it.fails`, skipped, or weakened).
- `docs/plans/safejs-validate-coll-001.md`: this procedure, verdict, and command/result record.
- `out/safejs-remediation/coll-001-validation/**`: bootstrap deviation/list/hash record, original source manifest, native/current/pre-COLL values, full Vitest logs/reports, lint/typecheck logs, and final hash/result manifest.

No other path is authored or edited by this validator. MC003, STR03, parser/lint work, and other parallel changes are not certified. No CLI behavior changed; screenshots are not applicable. Final source hashes and final HEAD are recorded in `out/safejs-remediation/coll-001-validation/final-hashes.json`.

## Full native/current/baseline command

The following ad hoc command was executed with exit **1**, preserving the two raw resumed mismatches rather than claiming success because all eight original cases passed. It creates only the new JSON evidence artifact through `apply_patch`; it is retained as Markdown, not an executable QA file. The original artifact remains unchanged. Rerunning the command requires choosing a new evidence filename because its patch adds a file.

```sh
node_modules/.bin/tsx --input-type=module <<'TS'
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { build } from 'esbuild';
import { run } from './packages/safejs/src/run.ts';
import { interpret } from './packages/safejs/src/interp/interpreter.ts';
import { parseModule } from './packages/safejs/src/parse/parser.ts';
import { cloneSandboxValue } from './packages/safejs/src/interp/values.ts';
import { Budget } from './packages/safejs/src/interp/budget.ts';
import { createCollectionGlobals } from './packages/safejs/src/interp/globals/collections.ts';
import { createObjectArrayGlobals } from './packages/safejs/src/interp/globals/object-array.ts';
const base='9ef2e738dc177eb2ac96358b1e1a0f9f40fe97dc';
const files=['packages/safejs/src/interp/interpreter.ts','packages/safejs/src/interp/iteration.ts'];
const before=new Map(files.map(file=>[path.resolve(file),execFileSync('git',['show',`${base}:${file}`],{encoding:'utf8'})]));
const bundled=await build({stdin:{contents:files.slice(0,1).map(file=>`export { interpret } from './${file}';`).join('\n')+`\nexport { run } from './packages/safejs/src/run.ts';\nexport { parseModule } from './packages/safejs/src/parse/parser.ts';\nexport { cloneSandboxValue } from './packages/safejs/src/interp/values.ts';\nexport { Budget } from './packages/safejs/src/interp/budget.ts';\nexport { createCollectionGlobals } from './packages/safejs/src/interp/globals/collections.ts';\nexport { createObjectArrayGlobals } from './packages/safejs/src/interp/globals/object-array.ts';`,resolveDir:process.cwd(),loader:'ts'},bundle:true,platform:'node',format:'esm',write:false,plugins:[{name:'readonly-coll-baseline',setup(builder){builder.onLoad({filter:/\.ts$/},args=>before.has(args.path)?{contents:before.get(args.path),loader:'ts'}:undefined);}}]});
const baseline=await import('data:text/javascript;base64,'+Buffer.from(bundled.outputFiles[0].text).toString('base64'));
const current={run,interpret,parseModule,cloneSandboxValue,Budget,createCollectionGlobals,createObjectArrayGlobals};
const root='/Users/kjopek/Workspace/poe-code/out/safejs-audit-2026-08-27';
const policy=JSON.parse(fs.readFileSync(root+'/inventory-verification.json','utf8')).archiveReadPolicy;
const manifest=JSON.parse(fs.readFileSync('out/safejs-remediation/coll-001-validation/original-source-manifest.json','utf8'));
const originalResults=[];
for(const item of manifest.sources){
 const relative='out/safejs-audit-2026-08-27/collections/'+item.name;
 if(policy.excludedPaths.includes(relative)||relative.includes('/security/'))throw Error('Blocked artifact');
 const source=fs.readFileSync(root+'/collections/'+item.name,'utf8');
 if(crypto.createHash('sha256').update(source).digest('hex')!==item.sha256)throw Error('Source changed');
 const native=new Function(`return ${source.slice('export default '.length)}`)()();
 const expected=item.name.startsWith('14-')?new Function(`return ${source.replace('work.entries()','Array.from(work.entries())').slice('export default '.length)}`)()():native;
 const observed=await run(source,{entryPointArgs:[],budget:new Budget({maxSteps:20000})});
 const old=await baseline.run(source,{entryPointArgs:[],budget:new baseline.Budget({maxSteps:20000})});
 originalResults.push({name:item.name,sha256:item.sha256,native,expected,expectedContract:item.name.startsWith('14-')?'deliberately eager array materialization; raw native live iterator differs':'native exact source',current:observed.ok?observed.returnValue:observed,beforeColl:old.ok?old.returnValue:old,matches:observed.ok&&JSON.stringify(observed.returnValue)===JSON.stringify(expected)});
}
const rawResults=[];
for(const collection of ['Map','Set']){
 const initial=collection==='Map'?'new Map([["a", 1], ["b", 2], ["c", 3]])':'new Set(["a", "b", "c"])';
 const binding=collection==='Map'?'[key,value]':'key';
 const entry=collection==='Map'?'[key,value]':'key';
 const source=`const work=${initial}; const visited=[]; for(const ${binding} of work){visited.push(${entry}); if(key==="a") ${collection==='Map'?'work.set("d",4)':'work.add("d")'};} return {visited,remaining:[...work]};`;
 const record={collection,source,expected:new Function(source)()};
 for(const [label,api] of [['current',current],['beforeColl',baseline]]){
  const module=api.parseModule(source);
  const program={type:'BlockStatement',body:module.body,span:module.span};
  const budget=new api.Budget({maxSteps:20000});
  const globals={...api.createObjectArrayGlobals({budget}),...api.createCollectionGlobals({budget})};
  let saved; let count=0;
  const uninterrupted=await api.interpret(program,{budget,bindings:globals,onYield(point){if(point.kind==='loop-iteration'&&++count===2){const snapshot=point.snapshot();saved={...snapshot,bindings:api.cloneSandboxValue(snapshot.bindings),loopIterations:structuredClone(snapshot.loopIterations)};}}});
  if(!saved)throw Error('Missing raw snapshot');
  const collectionAtCapture=collection==='Map'?[...saved.bindings.work.entries]:[...saved.bindings.work.values];
  const resumed=await api.interpret(program,{budget,bindings:globals,snapshot:saved});
  record[label]={uninterrupted:uninterrupted.ok?uninterrupted.returnValue:uninterrupted,collectionAtCapture,loopIterations:saved.loopIterations,resumed:resumed.ok?resumed.returnValue:resumed};
 }
 rawResults.push(record);
}
const evidence={timestamp:new Date().toISOString(),base,baselineMethod:'Read-only git show of only COLL interpreter.ts/iteration.ts, bundled in memory via esbuild; every other module uses current workspace TS. Not a historical whole-repository checkout and no production or Git mutation.',currentMethod:'Direct imports from packages/safejs/src/*.ts through tsx; not dist.',originalResults,rawResults};
execFileSync('apply_patch',[`*** Begin Patch\n*** Add File: out/safejs-remediation/coll-001-validation/native-current-baseline.json\n${JSON.stringify(evidence,null,2).split('\n').map(line=>'+'+line).join('\n')}\n*** End Patch\n`],{stdio:'inherit'});
console.log(JSON.stringify(evidence,null,2));
const rawFailures=rawResults.filter(item=>JSON.stringify(item.current.resumed)!==JSON.stringify(item.expected));
console.log(`Original cases: ${originalResults.filter(item=>item.matches).length}/${originalResults.length}; raw resumed mismatches: ${rawFailures.length}`);
process.exitCode=originalResults.every(item=>item.matches)&&rawFailures.length===0?0:1;
TS
```

## Final hygiene commands

```sh
node_modules/.bin/eslint packages/safejs/src/interp/interpreter.ts packages/safejs/src/interp/iteration.ts packages/safejs/src/interp/globals/collections-iteration.test.ts packages/safejs/src/interp/globals/collections-iteration-validation.test.ts
node_modules/.bin/prettier --check packages/safejs/src/interp/globals/collections-iteration-validation.test.ts docs/plans/safejs-validate-coll-001.md
git diff --check -- packages/safejs/src/interp/interpreter.ts packages/safejs/src/interp/iteration.ts
```

Exit statuses are retained in `final-checks.json`; these style/whitespace checks cannot waive runtime failures. Final hashes cover the two production files, the author test, and the independent validation test.

## Revalidation after Banach repair — 2026-08-29 UTC

**READY for the scoped COLL-001 publication candidate.** This section supersedes the initial runtime verdict and shipment hold above; it does not erase any initial failures or the disclosed bootstrap deviation. No production file, author test, or independent test was edited by this validator. No commit or push is authorized or performed here. Overall repository publication remains subject to the coordinator's clean-publisher gates and other issues.

The unchanged independent test file remains SHA-256 `9eb79e3bd34244fc59f90840c3d8dd49ba60165efe1dd65a4677c60233086814`. All **112 tests now pass**, including the exact 11 previously failing raw cursor cases. All **24 author tests pass**, including the six added finite checkpoint cases. No tests are weakened, skipped, marked expected failures, or added during this revalidation.

### State-consistency review

- Branded Map/Set declaration bindings are now restored rather than recreated. The recursive restorable-data check tracks visited objects, allowing the tested object aliases and cycles while retaining existing unsupported-value rejection behavior.
- At capture, the backing native iterator's remaining live suffix determines the next position in current membership. Rebuilding the iterator at that position is synchronous and does not invoke guest code. Normal traversal stays live; capturing does not replace the worklist with an eager snapshot. The exhausted flag preserves the distinction between a not-yet-observed end and an iterator that has returned done.
- Each loop saves the collection and already-selected current entry together through the existing binding graph. Restoring the saved current entry once, followed by the next cursor, avoids losing an entry deleted before a nested checkpoint and avoids duplicating or skipping it when the live membership shifts.
- Object aliases/cycles and nested deletion/clear/reinsertion are covered by the six author cases. Existing plain-JSON Map/Set checkpoint regressions pass without expectation changes; their fallback retains the selected current entry when the collection brand was flattened. This is not a promise to reconstruct arbitrary legacy snapshots whose contents were already discarded.
- The independent live-mutation matrix, both full worklists, public serialized journal replay, and explicit eager collection methods remain green. No remaining blocker was found in this finite COLL-001 scope. No unrelated matrix or unfinished parser suite was added.

### Actual red-to-green values

The exact two raw witnesses retained in `native-current-baseline.json` were independently rerun, using the same source and second-loop-breakpoint capture. New evidence is `revalidation-raw-witnesses.json`:

- Map expected and current resumed: both `visited` and `remaining` are `[["a",1],["b",2],["c",3],["d",4]]`. The previous resumed result lacked `["d",4]` in both fields.
- Set expected and current resumed: both fields are `["a","b","c","d"]`. The previous resumed result lacked `"d"` in both fields.
- Each captured loop now stores next index 2 plus its internal binding name, preserving the current second entry independently of the next cursor.

The original audit's eight exact sources were read only after reestablishing agreement of the exact 38 exclusions from both inventory metadata files and the retained bootstrap, with the entire security directory excluded. Each source SHA matches the original manifest. Both worklists again produce seven reachable vertices, the complete expected traversal/distances, and path `start → lexer → parser → typecheck → emit`. Growth/deletion/update and array/eager controls all match their independent expectations. Original case 14 still intentionally differs from a native live iterator; its eager materialization oracle is retained explicitly. No excluded payload bytes were read during this revalidation. The original bootstrap violation remains historical fact.

### Executed commands and results

All commands ran in `/Users/kjopek/Workspace/poe-code-safejs-fixes`. The `revalidation-` evidence filenames are new; none of the prior logs or JSON results was overwritten. Each test command's shell wrapper saved `$?`, displayed its log, and exited with that same status.

```sh
node_modules/.bin/vitest run packages/safejs/src/interp/globals/collections-iteration-validation.test.ts packages/safejs/src/interp/globals/collections-iteration.test.ts --reporter=verbose --reporter=json --outputFile=out/safejs-remediation/coll-001-validation/revalidation-focused.json > out/safejs-remediation/coll-001-validation/revalidation-focused.log 2>&1
node_modules/.bin/vitest run packages/safejs/src/interp/interpreter.test.ts -t 'restores for...of over a' --reporter=verbose --reporter=json --outputFile=out/safejs-remediation/coll-001-validation/revalidation-json-compatibility.json > out/safejs-remediation/coll-001-validation/revalidation-json-compatibility.log 2>&1
node_modules/.bin/vitest run packages/safejs/src/interp/globals/collections-iteration-validation.test.ts packages/safejs/src/interp/globals/collections-iteration.test.ts packages/safejs/src/interp/globals/collections.test.ts packages/safejs/src/interp/globals/object-array.test.ts packages/safejs/src/interp/generator.test.ts packages/safejs/src/interp/patterns.test.ts packages/safejs/src/interp/values.test.ts packages/safejs/src/interp/interpreter.test.ts packages/safejs/src/run.random.test.ts packages/safejs/src/run.completed-replay.test.ts packages/safejs/src/dump.test.ts packages/safejs/src/restore.test.ts packages/safejs/src/snapshot/restore.test.ts packages/safejs/src/snapshot/serialize.test.ts packages/safejs/src/run.snapshot.test.ts packages/safejs/test/integration/crash-resume.test.ts packages/safejs/test/integration/snapshot-roundtrip.test.ts --reporter=default --reporter=json --outputFile=out/safejs-remediation/coll-001-validation/revalidation-broader.json > out/safejs-remediation/coll-001-validation/revalidation-broader.log 2>&1
node_modules/.bin/tsc -p packages/safejs/tsconfig.json --noEmit > out/safejs-remediation/coll-001-validation/revalidation-typecheck.log 2>&1
node_modules/.bin/eslint packages/safejs/src/interp/interpreter.ts packages/safejs/src/interp/iteration.ts packages/safejs/src/interp/globals/collections-iteration.test.ts packages/safejs/src/interp/globals/collections-iteration-validation.test.ts > out/safejs-remediation/coll-001-validation/revalidation-eslint.log 2>&1
node_modules/.bin/prettier --check packages/safejs/src/interp/interpreter.ts packages/safejs/src/interp/iteration.ts packages/safejs/src/interp/globals/collections-iteration.test.ts packages/safejs/src/interp/globals/collections-iteration-validation.test.ts docs/plans/safejs-fix-coll-001.md > out/safejs-remediation/coll-001-validation/revalidation-prettier-initial.log 2>&1
git diff --check -- packages/safejs/src/interp/interpreter.ts packages/safejs/src/interp/iteration.ts
```

| Check                                                                   | Exit | Actual result                                                                      |
| ----------------------------------------------------------------------- | ---- | ---------------------------------------------------------------------------------- |
| Independent plus author focused suites                                  | 0    | 136 passed, 2 files; 1.94 seconds                                                  |
| Selected legacy compatibility                                           | 0    | 3 passed: Map, Set, sandbox generator; 474 nonselected tests skipped by the filter |
| Requested broader scope                                                 | 0    | **875 passed, 17 files, zero failed/skipped; 5.28 seconds**                        |
| Exact original audit payloads, current TS and fresh native expectations | 0    | 8/8 matched their contracts                                                        |
| Exact former raw Map/Set witnesses                                      | 0    | 2/2 resumed values now equal native/uninterrupted                                  |
| Package typecheck                                                       | 0    | No diagnostics; does not certify the unrelated root workspace typecheck            |
| Scoped ESLint                                                           | 0    | No diagnostics                                                                     |
| Five frozen source/author-plan formatting checks                        | 0    | All matched files pass                                                             |
| Scoped production diff whitespace                                       | 0    | No diagnostics                                                                     |

The two ad hoc witness executions use `node_modules/.bin/tsx --input-type=module` with current `src` imports, fresh native expected values, finite `maxSteps: 20_000`, and no guest external capabilities. Their source text, results, previous failures, and original-source hashes are retained in the new JSON artifacts; they are not executable QA files. The original-payload replay follows the full native/current command retained above but omits the no-longer-needed pre-COLL bundle. The raw replay uses the two exact `rawResults[].source` strings from that immutable evidence.

### Six-file candidate and publication boundary

The immutable handoff is `out/safejs-remediation/coll-001-validation/candidate/manifest.json` with **exactly six publication payload files** under `candidate/files/`, preserving these repository-relative paths:

1. `packages/safejs/src/interp/interpreter.ts`
2. `packages/safejs/src/interp/iteration.ts`
3. `packages/safejs/src/interp/globals/collections-iteration.test.ts`
4. `packages/safejs/src/interp/globals/collections-iteration-validation.test.ts`
5. `docs/plans/safejs-fix-coll-001.md`
6. `docs/plans/safejs-validate-coll-001.md`

The manifest records byte lengths, SHA-256 values, source/capture paths, base HEAD, and base-HEAD preimages (including explicit absence for new paths). The tracked production diff is captured, reverse-checked without applying it, and verified unchanged against the validated source. Candidate bytes equal those same validated files; recorded base preimages equal Git's base-HEAD blobs. The independent test hash is checked before tests, after tests, and in the candidate. All 19 prior evidence files remain byte-identical; this validation plan is append-only and retains its entire original byte prefix.

Publisher instructions: use the captured six payloads, not later shared-workspace source. Verify all manifest hashes and base preimages before applying; retain this candidate unchanged. The capture does not stage, commit, push, build a release, or certify MC003, STR03, TREE01, lint fixes, global declaration failures, or other issues. Clean-publisher full gates remain required. This scoped READY verdict clears the prior COLL-001 hold only for these exact captured bytes.

Historical references above to prospective `final-checks.json` / `final-hashes.json` were not completed before the previous urgent handoff. They are not evidence of checks that ran. The new revalidation result record and candidate manifest are the authoritative final records for this repair.

The first formatting check of this newly appended section exited 1 and is retained in `revalidation-plan-format-first.log`. Only the new section's formatting was corrected with `apply_patch`, preserving the initial report byte prefix. Final six-file formatting, candidate identity, and diff checks are recorded in `revalidation-results.json` and the candidate manifest.
