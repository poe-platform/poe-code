# Preserved supplemental static audit failure

August 28, 2026. This is separate from the sealed single data-admission pass,
which exited zero and produced RESULT.json. No candidate code was executed.
The supplemental audit was not rerun, repaired, or routed through another test.
Its intended FRAMEWORK-BINDINGS.json was never written and is not evidence.

An additional read-only Git/JSON receipt audit attempted to assert the absence of
all package export wildcards. That predicate was overbroad: immutable baseline
package.json already contains `./contracts/*`, mapping exclusively to
`./dist/contracts/*.d.ts` and `./dist/contracts/*.js`. This is not a YQ export.
Static inspection of `5137a74ec855a32d8a8860eb66b62eb44d11e290:package.json`
identified the cause. No package, consumer framework or expectation was changed.
The failed audit is not a pass, a YAML result or an independent build result.

## Raw terminal outcome

Command: `node --input-type=module` with the stdin program preserved below.
Exit code: **1**. No audit artifact was written.

```text
node:internal/modules/run_main:123
    triggerUncaughtException(
    ^

AssertionError [ERR_ASSERTION]: The expression evaluated to a falsy value:

  assert(!JSON.stringify(metadata.exports).includes('*'))

    at file:///Users/kjopek/Workspace/safe-bash/[eval1]:20:59
    at ModuleJob.run (node:internal/modules/esm/module_job:343:25)
    at async onImport.tracePromise.__proto__ (node:internal/modules/esm/loader:272:26)
    at async ModuleLoader.executeModuleJob (node:internal/modules/esm/loader:268:20)
    at async asyncRunEntryPointWithESMLoader (node:internal/modules/run_main:117:5) {
  generatedMessage: true,
  code: 'ERR_ASSERTION',
  actual: false,
  expected: true,
  operator: '==',
  diff: 'simple'
}

Node.js v22.22.2
```

## Exact failed stdin program (historical, do not rerun)

```javascript
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
const root='tests/commands/yq-independent-20260828/candidate-35da1854-v1';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const git=(...args)=>execFileSync('git',args,{maxBuffer:32*1024*1024,env:{PATH:process.env.PATH,GIT_NO_REPLACE_OBJECTS:'1',GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null',LANG:'C',LC_ALL:'C'}});
const consumers='409449136ae1adc252ff6e205a6bb5785d113d0f';
const runtime='ee9d0c1fd24b33aa918154eb379a92c02cfe5925';
const runtimePrior='c49d494dd5a36b19198680239a72e0c95cb90d8d';
const prefix='tests/commands/yq-independent-20260828/';
const record=(revision,path)=>{const bytes=git('show',`${revision}:${path}`); return {revision,path,blob:git('rev-parse',`${revision}:${path}`).toString().trim(),sha256:hash(bytes),bytes:bytes.length,mode:420};};
const selected=JSON.parse(git('show',`${consumers}:${prefix}executor-preparation-v1/consumers/SELECTED.json`));
const carry=JSON.parse(git('show',`bd471ef682d768692a682d40009a874f51e3ad68:${prefix}final-carry-v1/MANIFEST.json`));
const files=[...['README.md','guards.mjs','PROTOCOL.md','PRETEST-CLARIFICATIONS.md','PRETEST-SOURCE-ADMISSION.md','SOURCE-BASE.json','BASELINE-PACKAGE.json','SELECTED.json','type-worker.mjs','RECIPE-SEAL.json','verify-recipe.mjs'].map(name=>record(consumers,`${prefix}executor-preparation-v1/consumers/${name}`)),...['AUTHORIZATION.md','recipe/authorization.mjs','recipe/import-fence.mjs','recipe/integrity.mjs','recipe/host.mjs'].flatMap(name=>[record(runtime,`${prefix}executor-preparation-v1/runtime/${name}`),record(runtimePrior,`${prefix}executor-preparation-v1/runtime/${name}`)])];
const expected=JSON.parse(readFileSync(`${root}/EXPECTED-HASHES.json`));
for(const [name,value] of Object.entries(expected)){if(value&&typeof value==='object'&&value.path) assert.equal(hash(readFileSync(value.path)),value.sha256,`RECEIPT_READBACK: ${name}`);}
const bindings=JSON.parse(readFileSync(`${root}/RUNTIME-BINDINGS.PENDING.json`));
const metadata=JSON.parse(readFileSync(`${bindings.compiled.root}/package.json`));
assert(!JSON.stringify(metadata.exports).includes('yq')); assert(!JSON.stringify(metadata.exports).includes('*'));
const receiptKeys={source:Object.keys(JSON.parse(readFileSync(`${root}/SOURCE-RECEIPT.json`))),full:Object.keys(JSON.parse(readFileSync(`${root}/FULL-RECEIPT.json`)))};
const value={schema:1,role:'STATIC_FROZEN_INPUT_AND_RECEIPT_READBACK_NOT_EXECUTION',selectedImmutableInputs:selected.selected,frameworkFiles:files,acceptedFreeze:{revision:selected.finalCarry,review:selected.independentReview,records:carry.coverage.recordCount,overlays:carry.overlays,policyChanged:false},sourceGuardBehavior:'Entire candidateCommit source roots are compared, not a selected Git composition',runtimeBuiltinGap:{path:'recipe/import-fence.mjs',specifier:'node:timers/promises',changeAuthorized:false},receiptReadback:'All independently listed receipt/report hashes match current raw bytes',receiptKeys,publicPackage:{exports:metadata.exports,rootSourceUnchanged:true,yqPublicExport:false,wildcardExport:false,runtimeDependencies:metadata.dependencies??{}},execution:{product:0,compiler:0,build:0,npm:0,nativeYaml:0}};
const bytes=JSON.stringify(value,null,2)+'\n';
execFileSync('apply_patch',[],{input:`*** Begin Patch\n*** Add File: ${root}/FRAMEWORK-BINDINGS.json\n${bytes.trimEnd().split('\n').map(line=>'+'+line).join('\n')}\n*** End Patch\n`});
console.log(JSON.stringify({sha256:hash(bytes),files:files.length,selectedInputs:selected.selected.length,overlayIds:carry.overlays.map(entry=>entry.id),publicYqExport:false,receiptReadback:true}));
```
