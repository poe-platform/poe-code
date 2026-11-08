import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
const own='/Users/kjopek/Workspace/safe-bash/tests/shell/pipestatus-author-20260829/preexec-v1';
const work='/private/tmp/safe-bash-pipestatus-preexec';
const hash=value=>createHash('sha256').update(value).digest('hex');
const prepared=JSON.parse(fs.readFileSync(own+'/PREPARED.json','utf8'));const sealStat=fs.lstatSync(own+'/SEAL.json');if(!sealStat.isFile()||sealStat.size!==prepared.seal.bytes||sealStat.size>2097152)throw Error('CONTROL_SEAL_SIZE');const sealBytes=fs.readFileSync(own+'/SEAL.json');if(hash(sealBytes)!==prepared.seal.sha256)throw Error('CONTROL_SEAL_HASH');const seal=JSON.parse(sealBytes);
for(const row of seal.files){const stat=fs.lstatSync(row.path);if(!stat.isFile()||stat.size!==row.bytes||hash(fs.readFileSync(row.path))!==row.sha256)throw Error('CONTROL_HELPER_BINDING');}
const {preEvaluation,makeRole}=await import(pathToFileURL(own+'/owner.mjs'));
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
const capture=work+'/harmless';fs.mkdirSync(capture);
const ledger={starts:0,maximum:3,active:0,stopped:false,captureBytes:0,captureMaximum:2097152,rows:[]};
for(const [id,source,negative]of [
  ['C10',"import assert from 'node:assert/strict'; assert.equal(1,1); process.stdout.write('HARMLESS\\n');",undefined],
  ['C11',"await import('node:os');",'EDGE_REFUSED'],
  ['C12',"process.stdout.write('never');",'AUTH_HASH'],
]){
  const app=work+'/'+id;const bound=makeRole(seal,app,app+'/no-product',{roleId:id,layout:'harmless',case:{id}},capture,'harmless-control',Buffer.from(source));
  if(id==='C11')bound.role.edges[bound.role.entry]=[];
  if(id==='C12')bound.role.files[bound.role.entry].sha256='0'.repeat(64);
  if(negative){bound.bytes=Buffer.from(JSON.stringify(bound.role));fs.writeFileSync(bound.role.rolePath,bound.bytes);bound.env.SURFACE_ROLE_BYTES=String(bound.bytes.length);bound.env.SURFACE_ROLE_SHA256=hash(bound.bytes);}
  fs.appendFileSync(work+'/roles.log','harmless child '+id+' spawn requested\n');
  const child=await runDirect({id,node:seal.node,args:bound.args,cwd:app,env:bound.env,capture:capture+'/'+id,bodyDeadline:Date.now()+30000,finalDeadline:Date.now()+40000,timeoutMs:5000},ledger);
  if(!child.row.qualified)throw Error('HARMLESS_RETIREMENT_STOP');
  const stdout=Buffer.from(child.row.captures.find(row=>row.kind==='stdout').base64,'base64').toString();const stderr=Buffer.from(child.row.captures.find(row=>row.kind==='stderr').base64,'base64').toString();
  const trace=fs.readFileSync(bound.role.trace);const events=trace.toString().split('\n').filter(Boolean).map(line=>JSON.parse(line));
  results.push({id,pass:negative?child.row.status!==0&&stderr.includes(negative):child.row.status===0&&stdout==='HARMLESS\n'&&stderr==='',status:child.row.status,expectedRefusal:negative,permission:events.some(row=>row.event==='permission-admitted'),hooks:events.some(row=>row.event==='synchronous-hooks-installed'),trace:{bytes:trace.length,sha256:hash(trace)},lifecycle:child.row});
}
verifyPackage(admitted.sourceRoot,admitted.admitted.rows);
fs.writeFileSync(own+'/CONTROLS.json',JSON.stringify({results,passed:results.filter(row=>row.pass).length,total:12,actualAdmissionMembers:1010,managedChildren:ledger.starts,retired:ledger.active===0&&ledger.rows.every(row=>row.knownOutstanding===0),productEvaluations:0,Workers:0,tarBytes:admitted.admitted.tar.length},null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({passed:results.filter(row=>row.pass).length,total:12,children:ledger.starts,productEvaluations:0}));process.exitCode=results.some(row=>!row.pass)?1:0;
