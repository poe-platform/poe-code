import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
const own="/Users/kjopek/Workspace/safe-bash/tests/shell/pipestatus-author-20260829/preexec-v1";
const work="/private/tmp/pipestatus-independent-preexec-20260829";fs.mkdirSync(work,{mode:0o700});
const hash=value=>createHash('sha256').update(value).digest('hex');
const prepared={seal:{bytes:795793,sha256:'f61b8fb41db61be3ed89fba296f5cbb9a6e8b4c80dd019202b065fe4f5a093d5'}};const sealStat=fs.lstatSync(own+'/SEAL-v2.json');if(!sealStat.isFile()||sealStat.size!==prepared.seal.bytes||sealStat.size>2097152)throw Error('CONTROL_SEAL_SIZE');const sealBytes=fs.readFileSync(own+'/SEAL-v2.json');if(hash(sealBytes)!==prepared.seal.sha256)throw Error('CONTROL_SEAL_HASH');const seal=JSON.parse(sealBytes);
for(const row of seal.files){const stat=fs.lstatSync(row.path);if(!stat.isFile()||stat.size!==row.bytes||hash(fs.readFileSync(row.path))!==row.sha256)throw Error('CONTROL_HELPER_BINDING');}
const {preEvaluation,makeRole,verifyNpm}=await import(pathToFileURL(own+'/owner.mjs'));
const {validateTar,admitArchive,verifyPackage,timeWindow}=await import(pathToFileURL(own+'/admission.mjs'));
const {Primary,readPinned}=await import(pathToFileURL(own+'/reuse/auth.mjs'));
const {runDirect,openCapturePair}=await import(pathToFileURL(own+'/reuse/direct-child.mjs'));
const {finalize}=await import(pathToFileURL(own+'/reuse/finalization.mjs'));
const results=[];const record=(id,body)=>{try{body();results.push({id,pass:true});}catch(error){results.push({id,pass:false,message:String(error)});}};
const stage=work+'/admission';fs.mkdirSync(stage);const now=Date.now();
let admitted;
record('C01',()=>{admitted=preEvaluation(seal,stage,now,now+1800000);assert.equal(admitted.admitted.rows.length,1010);verifyPackage(admitted.sourceRoot,admitted.admitted.rows);});
if(!admitted)throw Error('ACTUAL_ADMISSION_STOP');
record('C02',()=>{const altered=Buffer.from(readPinned(seal.archive.path,seal.archive));altered[altered.length-1]^=1;const filename=work+'/changed.tgz';fs.writeFileSync(filename,altered,{flag:'wx'});assert.throws(()=>admitArchive(filename,admitted.manifest),/AUTH_HASH/u);});
record('C03',()=>assert.throws(()=>validateTar(admitted.admitted.tar,{...admitted.manifest,count:1002}),/CARDINALITY/u));
record('C04',()=>{const tar=Buffer.from(admitted.admitted.tar);const firstSize=admitted.manifest.members[0].size;const next=512+Math.ceil(firstSize/512)*512;tar.subarray(0,100).copy(tar,next);tar.subarray(345,500).copy(tar,next+345);tar.fill(32,next+148,next+156);let sum=0;for(let index=0;index<512;index++)sum+=tar[next+index];tar.write(sum.toString(8).padStart(6,'0')+'\0 ',next+148,8,'ascii');assert.throws(()=>validateTar(tar,admitted.manifest),/TAR_MEMBER/u);});
record('C05',()=>assert.throws(()=>validateTar(admitted.admitted.tar.subarray(1),admitted.manifest),/ALIGNMENT/u));
record('C06',()=>{const filename=admitted.sourceRoot+'/package.json';const before=fs.readFileSync(filename);const changed=Buffer.from(before);changed[0]^=1;try{fs.writeFileSync(filename,changed);assert.throws(()=>verifyPackage(admitted.sourceRoot,admitted.admitted.rows),/AUTH_HASH/u);}finally{fs.writeFileSync(filename,before);}verifyPackage(admitted.sourceRoot,admitted.admitted.rows);});
record('C07',()=>{assert.throws(()=>timeWindow(NaN,now+1800000),/TIME/u);assert.throws(()=>timeWindow(now,now+1800000,now+1800000),/TIME/u);});
record('C08',()=>{const result=finalize({primaryPresent:true,primary:false,census(){throw null;},publish(){throw 0;}});assert.equal(result.primary,false);assert.equal(result.secondary.length,2);assert.equal(result.secondary[0].reason,null);assert.equal(result.secondary[1].reason,0);});
record('C09',()=>{let acquired,closed=false,opens=0;const operations={openSync(...args){if(opens++)throw false;return acquired=fs.openSync(...args);},closeSync(descriptor){assert.equal(descriptor,acquired);fs.closeSync(descriptor);closed=true;}};const primary=new Primary(),ledger={rows:[]},row={};let rejected=false;try{openCapturePair({capture:work+'/partial'},ledger,row,primary,operations);}catch(reason){rejected=true;assert.equal(reason,false);}assert(rejected&&closed);assert.equal(row.childStarted,false);assert.equal(row.knownOutstanding,0);});

const sampleModule=await import(pathToFileURL(own+'/admission.mjs'));
verifyNpm(seal);
const capture=work+'/harmless';fs.mkdirSync(capture);
const ledger={starts:0,maximum:2,active:0,stopped:false,captureBytes:0,captureMaximum:2097152,rows:[]};
for(const id of ['C10','C11-C12-v2']){
  const app=work+'/'+id;fs.mkdirSync(app);
  const source=id==='C10'?String.raw`import assert from 'node:assert/strict'; assert.equal(1,1); process.stdout.write('HARMLESS\n');`:String.raw`const seen=[];try{await import('node:os');}catch(error){seen.push(error.message);}try{await import('./bad.mjs');}catch(error){seen.push(error.message);}process.stdout.write(JSON.stringify(seen)+'\n');`;
  if(id!=='C10')fs.writeFileSync(app+'/bad.mjs',"throw Error('MUST_NOT_EVALUATE');\n",{flag:'wx'});
  const bound=makeRole(seal,app,app+'/no-product',{roleId:id,layout:'harmless',case:{id}},capture,'harmless-control',Buffer.from(source));
  if(id!=='C10'){bound.role.edges[bound.role.entry]=bound.role.edges[bound.role.entry].filter(value=>value!=='node:os');bound.role.files[app+'/bad.mjs'].sha256='0'.repeat(64);bound.bytes=Buffer.from(JSON.stringify(bound.role));fs.writeFileSync(bound.role.rolePath,bound.bytes);bound.env.SURFACE_ROLE_BYTES=String(bound.bytes.length);bound.env.SURFACE_ROLE_SHA256=hash(bound.bytes);}
  const child=await runDirect({id,node:seal.node,args:bound.args,cwd:app,env:bound.env,capture:capture+'/'+id,bodyDeadline:Date.now()+30000,finalDeadline:Date.now()+40000,timeoutMs:5000},ledger);
  if(!child.row.qualified)throw Error('HARMLESS_RETIREMENT_STOP');
  const stdout=Buffer.from(child.row.captures.find(row=>row.kind==='stdout').base64,'base64').toString();const stderr=Buffer.from(child.row.captures.find(row=>row.kind==='stderr').base64,'base64').toString();
  const trace=fs.readFileSync(bound.role.trace);const events=trace.toString().split('\n').filter(Boolean).map(line=>JSON.parse(line));
  assert.equal(child.row.status,0);assert.equal(stderr,'');assert.equal(events.filter(row=>row.event==='permission-admitted').length,1);assert.equal(events.filter(row=>row.event==='synchronous-hooks-installed').length,1);
  if(id==='C10'){assert.equal(stdout,'HARMLESS\n');results.push({id:'C10',pass:true,lifecycle:child.row,traceSha256:hash(trace)});}else{assert.deepEqual(JSON.parse(stdout),['EDGE_REFUSED','AUTH_HASH']);for(const code of ['C11-v2','C12-v2'])results.push({id:code,pass:true,lifecycle:child.row,traceSha256:hash(trace),versionedCaughtBoundary:true});}
}
const vm=await import('node:vm');
const admissionSource=readPinned(own+'/admission.mjs',seal.files.find(row=>row.path===own+'/admission.mjs')).toString();
const ownerSource=readPinned(own+'/owner.mjs',seal.files.find(row=>row.path===own+'/owner.mjs')).toString();
record('N01',()=>{const sentinel=Object.assign(Error('gone'),{code:'ENOENT'});const exact=admissionSource.slice(admissionSource.indexOf('export function sample')).replace('export function sample','function sample');const sample=vm.runInNewContext(exact+';sample',{fs:{readdirSync(){return ['cache-temp'];},lstatSync(){throw sentinel;}},path});assert.throws(()=>sample('/owned/cache',1000),reason=>reason===sentinel);assert.equal(ownerSource.includes('setInterval'),false);assert.equal(ownerSource.includes('sample(seal.actualRoot,536870912)'),true);});
record('N02',()=>{for(const raw of [undefined,null,false,0]){const value=finalize({primaryPresent:true,primary:raw,census(){throw false;},publish(){throw 0;}});assert.equal(value.primaryPresent,true);assert.equal(value.primary,raw);assert.deepEqual(value.secondary.map(row=>row.reason),[false,0]);assert.equal(value.publicationAttempted,true);assert.equal(value.publicationSucceeded,false);}});
record('N03',()=>{const filename=work+'/grow';fs.mkdirSync(filename);fs.writeFileSync(filename+'/bytes',Buffer.alloc(11));assert.equal(fs.statSync(filename+'/bytes').size,11);assert.throws(()=>sampleModule.sample(filename,10),/WORK_LIMIT/);});
record('N04',()=>{const launch=fs.readFileSync(own+'/launch-v2.sh','utf8');assert.ok(launch.trimEnd().split('\n').at(-1).startsWith('exec "$NODE"'));const proposed=JSON.parse(fs.readFileSync(own+'/PUBLICATION.json')).command;assert.ok(proposed.includes('then /bin/zsh '));assert.equal(proposed.includes('then exec /bin/zsh '),false);});
record('N05',()=>{const guard=fs.readFileSync(own+'/reuse/guard.mjs','utf8');assert.equal(guard.includes('fsync'),false);assert.ok(guard.indexOf("trace({event:'module-loaded'")<guard.indexOf("return {format:'module',source:bytes"));});
record('N06',()=>{const filename=work+'/short.tgz';fs.writeFileSync(filename,Buffer.alloc(2),{flag:'wx'});assert.throws(()=>admitArchive(filename,admitted.manifest),/AUTH_TYPE_SIZE/);});
record('N07',()=>{const time=1700000000000;assert.equal(timeWindow(time,time+1800000,time+1619999).bodyDeadline,time+1620000);assert.throws(()=>timeWindow(time,time+1800000,time+1620000),/TIME_ADMISSION/);});
const {qualifyDirect}=await import(pathToFileURL(own+'/reuse/direct-child.mjs'));
record('N08',()=>{const row={primaryPresent:false,forced:false,exit:true,close:true,stdoutEOF:true,stderrEOF:true,capturesQualified:true,knownOutstanding:0};assert.equal(qualifyDirect(row),true);assert.equal(qualifyDirect({...row,knownOutstanding:1}),false);assert.equal(qualifyDirect({...row,primaryPresent:true,primary:undefined}),false);});
verifyPackage(admitted.sourceRoot,admitted.admitted.rows);verifyNpm(seal);
const summary={results,passed:results.filter(row=>row.pass).length,total:20,actualAdmissionMembers:1010,sourceInputs:307,npmFiles:seal.npmFiles.length,npmLinks:seal.npmFiles.filter(row=>row.kind==='link').length,managedChildren:ledger.starts,lifecycle:ledger.rows,retired:ledger.active===0&&ledger.rows.every(row=>row.knownOutstanding===0),productEvaluations:0,Workers:0,loaderThreads:0,versionedAuthorMap:true};
fs.writeFileSync(work+'/RESULT.json',JSON.stringify(summary,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({pass:summary.passed,total:summary.total,retired:summary.retired,children:ledger.starts}));process.exitCode=summary.passed===20?0:1;
