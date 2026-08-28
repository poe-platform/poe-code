import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { archiveData, here, prior, rawRoot, release, archiveHash, indexHash, regular, digest } from './archive-data.mjs';
import { census, tarInventory } from '../../candidate-v1/boundary-app.mjs';
import { unpack } from '../preparation-v3/staging.mjs';
import { prepareCompiledMutation } from '../preparation-v3/compiled-mutation.mjs';

const own = path.resolve(here, '../..');
const originalSeal = JSON.parse(regular(path.join(prior,'SEAL.json'),'77a629c48547d75e791a5def6a0ac83bf3618d0861c7f3f6c9e5f0fb18cb2ae7'));
const scopeBytes = regular(path.resolve(here,'../SCOPE-BINDING-v2.json'),originalSeal.scopeSha256), scope=JSON.parse(scopeBytes);
const captured=await archiveData(['FINAL.json','types-source-build.json','types-installed.json','types-moved.json']);
const final=JSON.parse(captured.values.get('FINAL.json'));
assert.equal(final.candidate,scope.product);assert.equal(final.composition,scope.selectedComposition);
assert.deepEqual(fs.readdirSync(rawRoot).sort(),['apps','artifacts','build','records','scratch','source','tools']);
assert.deepEqual(fs.readdirSync(path.join(rawRoot,'records')),[]);
for(const tree of final.finalCensuses)assert.deepEqual(census(tree.root),tree.entries);
for(const entry of scope.selectedSource){const bytes=regular(path.join(rawRoot,'source',entry.path),entry.sha256);assert.equal(bytes.length,entry.bytes);assert.equal(fs.lstatSync(path.join(rawRoot,'source',entry.path)).mode&0o777,parseInt(entry.mode,8)&0o777);}
const tar=regular(path.join(rawRoot,'artifacts/virtual-bash-0.0.0.tgz'),scope.package.sha256);
assert.deepEqual(tarInventory(tar),scope.package.inventory);assert.equal(Object.keys(scope.package.inventory).length,862);
const packageMembers=unpack(tar);
const mutations=JSON.parse(regular(path.join(here,'MUTANTS.json'))).declarations;
const mutationData=mutations.map(definition=>{
  const keys=['id','member','originalSha256','originalBytes','mode','replacements','prefix','finalLF','changedSha256','changedBytes'];
  const bytes=prepareCompiledMutation(packageMembers.get(definition.member).bytes,Object.fromEntries(keys.map(key=>[key,definition[key]])));
  return{id:definition.id,bytes:bytes.length,sha256:digest(bytes),qualification:'exact bytes constructed in DATA memory; no module loaded/activated'};
});
assert.deepEqual(mutations.map(row=>row.id),['U08','U09','U11','U12','U13-S06']);
const jobs=JSON.parse(regular(path.join(here,'JOBS.json'))),policy=JSON.parse(regular(path.join(here,'POLICY.json')));
assert.equal(jobs.length+mutations.length,22);assert.equal(jobs.reduce((sum,row)=>sum+row.ids.length,0)+mutations.reduce((sum,row)=>sum+row.ids.length,0),52);
assert.equal(policy.maxProductWorkers,22);assert.equal(policy.maxOtherSupervisedChildren,22);assert.equal(policy.maxGitChildren,0);assert.equal(policy.totalElapsedMsIncludingCleanup,1200000);
const record=file=>{const bytes=regular(file);return{path:path.relative(own,file),bytes:bytes.length,mode:fs.lstatSync(file).mode&0o777,sha256:digest(bytes)};};
const roles=new Map();
for(const role of originalSeal.roles){const filename=path.join(own,role.path);assert.deepEqual(record(filename),role);roles.set(role.path,role);}
const originals=originalSeal.appRoles;
const appRoles=originals.map(role=>role.destination==='worker.mjs'?{...record(path.join(here,'worker.mjs')),destination:role.destination}:role.destination==='complete-adapter.mjs'?{...record(path.join(here,'tail-adapter.mjs')),destination:role.destination}:role);
appRoles.push({...originals.find(role=>role.destination==='complete-adapter.mjs'),destination:'complete-adapter-original.mjs'});
appRoles.push({...record(path.join(here,'CONTINUATION.json')),destination:'CONTINUATION.json'});
assert.equal(new Set(appRoles.map(role=>role.destination)).size,appRoles.length);
const appTemplates={};
for(const [kind,template]of [['source','source-app'],['installed','moved-app']]){
  const entries=census(path.join(rawRoot,'apps',template));
  for(const role of appRoles){assert.equal(path.basename(role.destination),role.destination);entries[role.destination]={mode:role.mode,bytes:role.bytes,sha256:role.sha256};}
  appTemplates[kind]=entries;
}
const newInputs=['archive-data.mjs','tail-adapter.mjs','worker.mjs','dispatch.mjs','seal.mjs','POLICY.json','JOBS.json','MUTANTS.json','CONTINUATION.json','RECIPE.md','cleanup-v1/POST.json','cleanup-v1/DELETE-MANIFEST.json','cleanup-v1/DELETE-JOURNAL.jsonl'];
for(const filename of newInputs){const role=record(path.join(here,filename));roles.set(role.path,role);}
for(const filename of [path.resolve(here,'../SCOPE-BINDING-v2.json'),path.join(prior,'SEAL.json'),path.join(release,'CAPTURE-INDEX.json'),path.join(release,'RECORDS.jsonl.gz')]){const role=record(filename);roles.set(role.path,role);}
for(const filename of [path.resolve(here,'../preparation-v4/controller.mjs'),path.resolve(here,'../preparation-v4/deadline.mjs'),path.resolve(here,'../preparation-v4/supervisor.mjs')]){const role=record(filename);roles.set(role.path,role);}
const storage=[{name:'source',directory:'source',maxBytes:16777216},{name:'apps',directory:'apps',maxBytes:67108864},{name:'artifacts',directory:'artifacts',maxBytes:33554432},{name:'prior-types',directory:'prior',maxBytes:67108864},{name:'records',directory:'records',maxBytes:134217728}];
const seal={kind:'array-affected-tail-preseal-v1',status:'NO actual GO; all candidate results remain unrun',candidate:scope.product,composition:scope.selectedComposition,packageSha256:scope.package.sha256,sourceInputs:269,scopeSha256:digest(scopeBytes),policySha256:digest(regular(path.join(here,'POLICY.json'))),jobsSha256:digest(regular(path.join(here,'JOBS.json'))),mutantsSha256:digest(regular(path.join(here,'MUTANTS.json'))),archiveHash,indexHash,node:scope.tools.node,git:originalSeal.git,roles:[...roles.values()],appRoles,appTemplates,storage};
const sealBytes=Buffer.from(JSON.stringify(seal,null,2)+'\n');fs.writeFileSync(path.join(here,'SEAL.json'),sealBytes,{flag:'wx'});
const receipt={kind:'preparation-DATA-only',candidateExecutions:0,archiveRecordsAuthenticated:captured.rows.length,sourceInputsAuthenticated:scope.selectedSource.length,packageMembers:862,priorTypeRecords:[...captured.values].filter(([name])=>name.startsWith('types-')).map(([name,bytes])=>({name,bytes:bytes.length,sha256:digest(bytes)})),newTypePasses:0,roles:roles.size,appRoles:appRoles.length,appTemplateEntries:Object.fromEntries(Object.entries(appTemplates).map(([name,value])=>[name,Object.keys(value).length])),mutationData,jobChildren:jobs.length,mutantChildren:mutations.length,maximumChildren:22,maximumIncludingCoordinator:23,expectedTopLevelObservations:52,sealSha256:digest(sealBytes),dispatcherSha256:digest(regular(path.join(here,'dispatch.mjs'))),cleanupPostSha256:digest(regular(path.join(here,'cleanup-v1/POST.json')))};
fs.writeFileSync(path.join(here,'PREPARATION-DATA.json'),JSON.stringify(receipt,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify(receipt));
