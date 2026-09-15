# Module authority revalidation — 2026-09-13

Acceptance remains unmet. This is an evidence-only audit of the existing dirty
candidate, not a resolver repair or a claim that its code has been committed.

Source HEAD: `61fb23e4dd0fd5ea15d68440e687e647bb71a004`, main.
Runtime: Node 22.23.2, ICU 78.2, V8 12.4.254.21-node.56, Darwin arm64.
Target unchanged: ECMA-262 edition 16 and ECMA-402 edition 12 (June 2025),
Test262 `419d3e0a2273ba01a3bfcbec423f2801425b8e93`, plus the evidence ledger's
explicitly tracked newer APIs. No target, runtime support, assertion, budget,
or timeout was changed.

## Results and disposition

- Focused source-module/CLI/SDK selection: **138 passed, 18 files, no failures or skips**, exit 0, 6.40 seconds.
- Stable rooted access succeeds. Persistent outside symlink denies before opening. Transient ancestor swap reads outside source under an inside identity: **authority failure**. All opened handles close. Atomic ancestor confinement requires a host capability the current pathname adapter does not supply; another pathname recheck does not establish it.
- A 26-byte source succeeds. The 20,024-byte oversized source is fully read before `dataSize:5000` rejects registration: **pre-acquisition byte admission missing**. UTF-16 retained-data accounting is not a transport byte ceiling.
- Width 64 starts 64 resolver operations concurrently. Depth 32 succeeds with 33 calls despite `maxCallDepth:2`: **dedicated module-count, graph-depth and concurrency admission contracts absent**. This finite counterexample does not assert infinite capacity. All gates release and active work returns to zero.
- Changed dependencies produce values 1 and 2 with the same entry hash. Dump and restore both reject the unsupported operation; restore calls the resolver zero times. **Graph-aware restore/changed-source validation remains unavailable**, not an accepted corrupt restore.
- A resolver ignoring its signal remains active after run rejection, despite the signal being aborted. Explicit host release reduces active work to zero. **Universal host quiescence is not established**. Arbitrary injected host work cannot be forcibly stopped by an AbortSignal; cooperative cancellation is covered separately.

The focused tests cover bare/relative/absolute specifiers; canonical identity;
dot segments; literal encoded separators; file URL and mocked redirect identities;
path aliases; concurrent request deduplication; cycles; failed-load caching;
revocation across filesystem awaits; cancellation during linking/evaluation;
rejected top-level await; live namespace bindings; and rooted CLI/SDK parity.
Rooted URL transport, HTTP redirects, package lookup and arbitrary host imports
are intentionally unavailable. A custom SDK resolver may explicitly authorize
opaque identifiers; its final identity is respected. Those missing host capabilities
are not ECMAScript defects. No implicit installer or ambient resolver was added.

Source review: `modules/source-files.ts` uses pathname canonicalization, stat,
open and handle checks; `modules/source-graph.ts` starts dependency edges without
a concurrency queue and charges registration after resolution. `run.ts` supplies
rooted authority to the SDK; `cli-runtime.ts` forwards its explicit source root.
No ad hoc specifier filter or alternative resolution semantics was introduced.

## Reproduction

Run the following from repository root against the recorded dirty candidate.
Filesystem fixtures use memfs; resolver capabilities are mocked. These are manual
QA steps, not a QA script. Probe exit 0 means the observation completed, **not**
that security acceptance passed. No real network, installation, or outside-host
filesystem fixture is needed. Each started command completed.

### integration

```sh
npx vitest run packages/safe-js/src/modules/source-authority.test.ts packages/safe-js/src/modules/source-graph.test.ts packages/safe-js/src/modules/source-files.test.ts packages/safe-js/src/modules/source-loading.test.ts packages/safe-js/src/modules/source-request-budget.test.ts packages/safe-js/src/modules/source-linking-budget.test.ts packages/safe-js/src/modules/source-bindings.test.ts packages/safe-js/src/realm.source-modules.test.ts packages/safe-js/src/run.source-modules.test.ts packages/safe-js/src/run.source-root.test.ts packages/safe-js/src/cli.source-modules.test.ts packages/safe-js/src/parse/module-source-budget.test.ts packages/safe-js/src/modules/source-revocation.test.ts packages/safe-js/src/modules/source-cancellation-qualification.test.ts packages/safe-js/src/parse/source-module.test.ts packages/safe-js/src/parse/source-module-context.test.ts packages/safe-js/src/parse/source-import-meta.test.ts packages/safe-js/test/conformance/source-modules.test.ts
```

Observed: 138 passed / 18 files, zero failed or skipped; exit 0.

### independent-controls

```sh
node --import tsx --input-type=module <<'JS'
import assert from 'node:assert/strict';
import native from 'node:fs/promises';
import {syncBuiltinESMExports} from 'node:module';
import {fs,vol} from 'memfs';
const saved={realpath:native.realpath,stat:native.stat,open:native.open};
try {
 for(const mode of ['stable','persistent-symlink','transient-swap']) {
  vol.reset();vol.fromJSON({'/grant/sub/dep.js':'export const location="inside"','/outside/dep.js':'export const location="outside"'});
  let phase=0,opened=0,closed=0;const reads=[];
  native.stat=async pathname=>{
   if(mode==='transient-swap' && pathname==='/grant/sub/dep.js' && phase===0){
    vol.renameSync('/grant/sub','/grant/prior');vol.symlinkSync('/outside','/grant/sub');phase=1;
   }
   return fs.promises.stat(pathname);
  };
  native.realpath=async pathname=>{
   if(mode==='transient-swap' && pathname==='/grant/sub/dep.js' && phase===1){
    vol.unlinkSync('/grant/sub');vol.renameSync('/grant/prior','/grant/sub');phase=2;
   }
   return fs.promises.realpath(pathname);
  };
  native.open=async (...args)=>{
   const handle=await fs.promises.open(...args);opened++;
   const read=handle.readFile.bind(handle),close=handle.close.bind(handle);
   handle.readFile=async (...args)=>{const text=await read(...args);reads.push(text);return text};
   handle.close=async()=>{closed++;return close()};return handle;
  };
  syncBuiltinESMExports();
  const {createRootedSourceResolver}=await import('./packages/safe-js/src/modules/source-files.ts');
  const resolver=await createRootedSourceResolver('/grant');
  if(mode==='persistent-symlink'){vol.renameSync('/grant/sub','/grant/prior');vol.symlinkSync('/outside','/grant/sub')}
  const result=await resolver('./sub/dep.js','/grant/entry.js',{});
  assert.equal(opened,closed);
  if(mode==='stable')assert.equal(result.source,'export const location="inside"');
  if(mode==='persistent-symlink'){assert.equal(result,undefined);assert.equal(opened,0)}
  console.log(JSON.stringify({mode,result,reads,opened,closed,authorityPass:!reads.some(text=>text.includes('outside'))}));
 }
} finally {Object.assign(native,saved);syncBuiltinESMExports();vol.reset()}
JS
```

Exit 0. Observed:

```text
{"mode":"stable","result":{"id":"/grant/sub/dep.js","source":"export const location=\"inside\""},"reads":["export const location=\"inside\""],"opened":1,"closed":1,"authorityPass":true}
{"mode":"persistent-symlink","reads":[],"opened":0,"closed":0,"authorityPass":true}
{"mode":"transient-swap","result":{"id":"/grant/sub/dep.js","source":"export const location=\"outside\""},"reads":["export const location=\"outside\""],"opened":1,"closed":1,"authorityPass":false}
```

### source-read

```sh
node --import tsx --input-type=module <<'JS'
import fsPromises from 'node:fs/promises';
import {syncBuiltinESMExports} from 'node:module';
import {fs,vol} from 'memfs';
import {Budget} from './packages/safe-js/src/interp/budget.ts';
const original={realpath:fsPromises.realpath,stat:fsPromises.stat,open:fsPromises.open};
try {
 Object.assign(fsPromises,{realpath:fs.promises.realpath,stat:fs.promises.stat,open:fs.promises.open});syncBuiltinESMExports();
 const {run}=await import('./packages/safe-js/src/run.ts');
 for(const length of [1,10000]){
  const source=`/*${'é'.repeat(length)}*/export const value=1`;
  vol.reset();vol.fromJSON({'/grant/dep.js':source});let bytesRead=0;
  fsPromises.open=async (...args)=>{
   const h=await fs.promises.open(...args);const read=h.readFile.bind(h);
   h.readFile=async (...opts)=>{const value=await read(...opts);bytesRead+=Buffer.byteLength(value);return value};return h;
  };syncBuiltinESMExports();
  let outcome;
  try {const r=await run("export {value} from './dep.js'",{sourceType:'module',sourceRoot:'/grant',budget:new Budget({dataSize:5000})});outcome={ok:r.ok}}
  catch(e){outcome={code:e.code,budget:e.budget,message:e.message}}
  console.log({sourceCodeUnits:source.length,sourceBytes:Buffer.byteLength(source),bytesRead,dataSize:5000,outcome});
 }
}finally{Object.assign(fsPromises,original);syncBuiltinESMExports()}
JS
```

Exit 0. Observed:

```text
{
  sourceCodeUnits: 25,
  sourceBytes: 26,
  bytesRead: 26,
  dataSize: 5000,
  outcome: { ok: true }
}
{
  sourceCodeUnits: 10024,
  sourceBytes: 20024,
  bytesRead: 20024,
  dataSize: 5000,
  outcome: {
    code: 'budgetExceeded',
    budget: 'dataSize',
    message: 'Sandbox budget exceeded for dataSize: 10117 > 5000.'
  }
}
```

### limits

```sh
node --import tsx --input-type=module <<'JS'
import {run} from './packages/safe-js/src/run.ts';
import {Budget} from './packages/safe-js/src/interp/budget.ts';
import {SourceModuleGraph} from './packages/safe-js/src/modules/source-graph.ts';
import {Scope} from './packages/safe-js/src/interp/scope.ts';
import {createModuleEnvironment} from './packages/safe-js/src/modules/registry.ts';
for(const width of [1,64]) {
 let active=0,peak=0;const releases=[];
 const graph=new SourceModuleGraph({budget:new Budget({maxSteps:10000,dataSize:100000,maxCallDepth:2}),scope:new Scope(),modules:createModuleEnvironment(undefined,{}),resolver:id=>{
  active++;peak=Math.max(active,peak);
  return new Promise(resolve=>releases.push(()=>{active--;resolve({id,source:''})}));
 }});
 const execution=graph.evaluateSource({id:'entry',source:Array.from({length:width},(_,i)=>`import '${i}';`).join('')});
 await new Promise(resolve=>setImmediate(resolve));
 const beforeRelease=active;for(const release of releases)release();
 await execution;await graph.settle();graph.close();
 console.log({width,peak,beforeRelease,afterRelease:active});
}
for(const depth of [1,32]) {
 let calls=0;const budget=new Budget({maxCallDepth:2});
 const result=await run("import '0';export const done=true",{sourceType:'module',budget,sourceResolver:id=>{
  calls++;return {id,source:Number(id)===depth?'':`import '${Number(id)+1}'`};
 }});
 console.log({depth,calls,maxCallDepth:2,ok:result.ok,peakCallDepth:budget.peakCallDepth});
}
JS
```

Exit 0. Observed:

```text
{ width: 1, peak: 1, beforeRelease: 1, afterRelease: 0 }
{ width: 64, peak: 64, beforeRelease: 64, afterRelease: 0 }
{ depth: 1, calls: 2, maxCallDepth: 2, ok: true, peakCallDepth: 1 }
{ depth: 32, calls: 33, maxCallDepth: 2, ok: true, peakCallDepth: 1 }
```

### restore

```sh
node --import tsx --input-type=module <<'JS'
import {run} from './packages/safe-js/src/run.ts';
import {dump} from './packages/safe-js/src/dump.ts';
const source="export {value} from 'dep'",results=[];
for(const value of [1,2])results.push(await run(source,{sourceType:'module',sourceResolver:()=>({id:'dep',source:`export const value=${value}`})}));
let dumpError,restoreError,calls=0;
try{await dump(results[0])}catch(e){dumpError=e.message}
try{await run(source,{sourceType:'module',snapshot:results[0].snapshot,sourceResolver:()=>{calls++;return {id:'dep',source:'export const value=2'}}})}catch(e){restoreError=e.message}
console.log({values:results.map(r=>r.returnValue.value),hashes:results.map(r=>r.snapshot.sourceHash),dumpError,restoreError,resolverCalls:calls});
JS
```

Exit 0. Observed:

```text
{
  values: [ 1, 2 ],
  hashes: [ '621f4a91', '621f4a91' ],
  dumpError: 'Snapshot is not replayable: Live realm state cannot be serialized or replayed.',
  restoreError: 'Live extension runs do not support snapshots or entryPointArgs; use a persistent realm.',
  resolverCalls: 0
}
```

### noncooperative-cleanup

```sh
node --import tsx --input-type=module <<'JS'
import assert from 'node:assert/strict';
import {run} from './packages/safe-js/src/index.ts';
let release,active=0,signal;
try {
 await assert.rejects(run("import 'pending';import 'denied'",{
  sourceType:'module',sourceResolver:(id,_referrer,context)=>{
   if(id==='denied')return undefined;
   signal=context.signal;active++;
   return new Promise(resolve=>{release=()=>{active--;resolve({id,source:''})}});
  }
 }),/Source resolver denied/);
 console.log(JSON.stringify({phase:'after-run-rejection',active,aborted:signal.aborted}));
} finally {release?.();await new Promise(resolve=>setImmediate(resolve))}
assert.equal(active,0);console.log(JSON.stringify({phase:'after-host-cleanup',active}));
JS
```

Exit 0. Observed:

```text
{"phase":"after-run-rejection","active":1,"aborted":true}
{"phase":"after-host-cleanup","active":0}
```

## Source identity and verification scope

The checkout has pre-existing tracked and untracked resolver changes. HEAD alone
does not identify that code. SHA-256 of the sorted JSON map (Python
`json.dumps(manifest, sort_keys=True)`) of every file under SafeJS `src` and
`test` is `4c47b7d060cdbdf4a406df0567eee067c40be65c247126acc2feb3c57ead266d`.
The resolver and integration files below identify the directly inspected source:

| File                                           | SHA-256                                                            |
| ---------------------------------------------- | ------------------------------------------------------------------ |
| `packages/safe-js/src/modules/source-files.ts` | `a3d4a7e54b6aa42f760a215869e9819cbe2c12dcd0ecc1b9e2608f73aec3f439` |
| `packages/safe-js/src/modules/source-graph.ts` | `92031243f6c7cacfdb28d18d05605834aea8b9f1d806b3dd78aef0dce92eaa3f` |
| `packages/safe-js/src/modules/registry.ts`     | `d551da53a6c01d2d68e29832ad35f433c5817e934feebf826ba4111770048887` |
| `packages/safe-js/src/run.ts`                  | `b3667bccaa44d375f97a7cb6102ecda1ec425eaa62158608ca14db0b07642725` |
| `packages/safe-js/src/realm.ts`                | `d26e60d6b7900e9c6d23fc2b63ede75bf9e97b6801018b9bdf6475fceb76c01d` |
| `packages/safe-js/src/cli.ts`                  | `e32b5a29c955e082a5e1fa65eb8ae2bc0c2e43b3611b894ca8300f80bb358ec3` |
| `packages/safe-js/src/cli-runtime.ts`          | `639e903893c512f9bb70c6bac21b6ec00ac4afe4dc843d72b7579f9aa5b9bc07` |
| `packages/safe-js/src/index.ts`                | `dd7e1f6bebfaf429fdf5a6490acf1a2e068936bf2866d94f6cf0da55e7b4e39e` |

No runtime files were edited, so no repair TDD claim is made. Fresh checks are the
focused tests and five probes above. The previous full package/build/runtime
matrix receipts remain historical; they were not rerun here. Other Node versions,
Bun, Workerd, repository-wide checks, full Test262 and graph-aware replay are
unexecuted in this audit. No CLI visual change was made; no fresh screenshot
qualification is claimed.

For the exact two documentation paths committed, manual checks are scoped
Prettier validation, task-patch whitespace validation, review of all command
outcomes, source-hash preservation and verification that unrelated staged blobs
are unchanged. No code test failure was encountered in the fresh selection. Initial report
formatting validation failed; formatting the task-owned report corrected it.
Final `npx prettier --check` passed for the report, the isolated ledger addition,
and the complete HEAD-plus-addition ledger candidate. No inherited working-tree
ledger paragraphs were reformatted.

## Delivery

This report and its appended ledger entry are the sole task-owned change.
The commit records evidence only; inherited resolver code stays uncommitted.
Local commit SHA is reported after commit. Remote-main delivery is unverified;
no push was requested or performed by this audit. Release/publication receipts:
none. No issue was closed. The task remains open for the acceptance gaps above.
