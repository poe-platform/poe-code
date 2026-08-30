import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { authenticate, digest } from '../../candidate-v1/boundary-app.mjs';
import { computedTree } from './reference.mjs';

const here=path.dirname(fileURLToPath(import.meta.url)),own=path.resolve(here,'../..');
const predecessor='c7f198821b82f8ce2661913b944211b747de2bd5a4017c431406687cda212d80';
const prior=JSON.parse(authenticate(path.join(here,'../preparation-v4/SEAL.json'),predecessor));
for(const role of prior.roles)authenticate(path.join(own,role.path),role.sha256);
authenticate(prior.node.path,prior.node.sha256);authenticate(prior.git.path,prior.git.sha256);
const source=authenticate(path.join(own,'candidate-v1/seal-admission-02.mjs'),'c1aeb7c00aed5c48050f13f5b4222acea37af08f9ba604df7e3bd069c641b02a').toString();
const start=source.indexOf('function computedTree(entries) {'),end=source.indexOf('\n}\n',start)+2;assert.ok(start>=0&&end>start);
assert.equal(fs.readFileSync(path.join(here,'reference.mjs'),'utf8').split('export ')[1].trim(),source.slice(start,end).trim(),'exact previously qualified pure reference function');
function add(name,text){const file=path.join(here,name);assert.equal(fs.existsSync(file),false);execFileSync('apply_patch',[],{input:`*** Begin Patch\n*** Add File: ${file}\n${text.trimEnd().split('\n').map(line=>'+'+line).join('\n')}\n*** End Patch\n`,timeout:10000,maxBuffer:1048576});}
const entry=(name,mode='100644',hash='1'.repeat(40))=>({name,mode,hash});
const vectors=[
 {id:'T01',entries:[]},
 {id:'T02',entries:[entry('foo','40000','2'.repeat(40)),entry('foo.bar'),entry('foo0','100644','3'.repeat(40))]},
 {id:'T03',entries:[entry('雪'),entry('😀'),entry('A'),entry('é')]},
 {id:'T04',entries:[entry('run','100755')]},
 {id:'T05',entries:[entry('AGENTS.md','100644','4'.repeat(40)),entry('src','40000','5'.repeat(40))]},
 {id:'T06',invalid:true,inputs:[[entry('same'),entry('same')]]},
 {id:'T07',invalid:true,inputs:[[entry('run','040000')],[entry('a/b')],[entry('..')]]},
 {id:'T08',invalid:true,inputs:[[entry('file','100644','short')],[entry('file','100644','A'.repeat(40))],[entry('file','100644',null)]]}
];
for(const vector of vectors)if(vector.entries)vector.expected=computedTree(vector.entries.map(item=>({path:item.name,mode:item.mode,blob:item.hash})));
assert.equal(vectors[0].expected,'4b825dc642cb6eb9a060e54bf8d69288fbee4904');add('TREE-VECTORS.json',JSON.stringify(vectors,null,2)+'\n');
const original=fs.readFileSync(path.join(here,'composition.mjs'),'utf8');
const mutations=[
 {id:'FORMAT',file:'composition-bad-format.mjs',case:'C01',before:"return objectHash('tree', body);",after:"return objectHash('blob', body);"},
 {id:'BLOB',file:'composition-no-blob-check.mjs',case:'C21',before:"assert.ok(bytes.length === entry.bytes && sha256(bytes) === entry.sha256 && objectHash('blob', bytes) === entry.blob, 'actual source blob validation');",after:'void bytes;'},
 {id:'MANIFEST',file:'composition-no-manifest-check.mjs',case:'C02',before:"assert.equal(sha256(scopeBytes), binding.scopeSha256, 'fixed manifest byte binding');",after:'void scopeBytes;'}
];
for(const mutation of mutations){assert.equal(original.split(mutation.before).length,2);const text=original.replace(mutation.before,mutation.after);mutation.originalSha256=digest(Buffer.from(original));mutation.sha256=digest(Buffer.from(text));add(mutation.file,text);}
add('MUTATIONS.json',JSON.stringify(mutations,null,2)+'\n');
const names=new Set(prior.roles.map(role=>role.path));
for(const name of ['SEAL.json','RUN-ARRAY-S06-20260828-01/records/FINAL.json','RUN-ARRAY-S06-20260828-01/records/child-001.json','RUN-ARRAY-S06-20260828-01/records/child-002.json'])names.add('s06-successor-v1/preparation-v4/'+name);
names.add('candidate-v1/seal-admission-02.mjs');
for(const name of fs.readdirSync(here).sort())if(/\.(mjs|md|json)$/u.test(name)&&name!=='SEAL.json'&&!/^(?:RESULT|SYNTHETIC-|METADATA-|REPORT|CLEANUP|PACKED-)/u.test(name))names.add('s06-successor-v1/preparation-v5/'+name);
const roles=[...names].sort().map(name=>{const file=path.join(own,name);assert.equal(fs.realpathSync(file),file);const stat=fs.lstatSync(file);assert.ok(stat.isFile());const bytes=fs.readFileSync(file);return{path:name,bytes:bytes.length,mode:stat.mode&0o777,sha256:digest(bytes)};});
const policySha256=digest(fs.readFileSync(path.join(here,'POLICY.json'))),dispatcherSha256=digest(fs.readFileSync(path.join(here,'dispatch.mjs')));
const seal={...prior,kind:'array-successor-canonical-composition-admission-v5',status:'metadata/synthetic validation authorized; actual candidate run NOT authorized',predecessorSealSha256:predecessor,roles,policySha256,counts:{...prior.counts,expectedGitChildren:283,expectedTotalDirectChildren:356,expectedTotalProcessesIncludingCoordinator:357},admissionMutants:mutations,admission:{moduleSha256:digest(Buffer.from(original)),storedBaseCommit:'5137a74ec855a32d8a8860eb66b62eb44d11e290',storedBaseTree:'48e5ae39ce98e1c8e416bae77da40d88b75e1db5',derivedComposition:'30f88590b66b88dc9694a56c85f1ee690f02218b',expectedMetadataGitChildren:282,sourceInputs:269,metadataMaxElapsedMs:180000,metadataMaxGitChildren:300,metadataMaxCapturedBytes:33554432,metadataMaxWorkingBytes:67108864,wholeAdmissionCases:28,referenceCases:8,loadedHarnessMutants:3,syntheticMaxElapsedMs:180000,syntheticChildProcesses:0,opaqueInstructions:'AGENTS metadata hash/mode only; no instruction body reads'},launch:{...prior.launch,file:'s06-successor-v1/preparation-v5/dispatch.mjs',sha256:dispatcherSha256,action:'execute-array-successor-v5'},limitations:[...prior.limitations,'019f82b0 consumed the prior grant after two Git checks and zero candidate execution. This derived-tree repair does not rescore that failure or authorize another product run.','Metadata/DATA synthetic results are source-admission proof only, not array behavior/type/layout acceptance. The computed whole-tree identity is required but need not be stored as a Git object.']};
add('SEAL.json',JSON.stringify(seal,null,2)+'\n');console.log(JSON.stringify({sealSha256:digest(fs.readFileSync(path.join(here,'SEAL.json'))),dispatcherSha256,roles:roles.length,appRoles:seal.appRoles.length,expectedMetadataGitChildren:282,expectedActualGitChildren:283,actualProductExecutions:0}));
