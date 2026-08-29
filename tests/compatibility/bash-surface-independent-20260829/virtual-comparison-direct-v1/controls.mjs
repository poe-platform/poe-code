import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {readPinned,pinExecutable,hash,Primary,publish,errorRecord} from './auth.mjs';
import {PROFILE,validateRole,caseArguments,validateArguments,completion} from './profile.mjs';
import {runDirect,qualifyDirect} from './direct-child.mjs';
const packet=path.dirname(fileURLToPath(import.meta.url));
const [sealPath,sealSha,work]=process.argv.slice(2);
const sealStat=fs.lstatSync(sealPath);
if(!sealStat.isFile()||sealStat.isSymbolicLink()||sealStat.size>2097152)throw Error('SEAL_TYPE');
const seal=JSON.parse(readPinned(sealPath,{bytes:sealStat.size,sha256:sealSha},2097152));
const finalDeadline=seal.phaseDeadline,bodyDeadline=finalDeadline-60000;
if(seal.profile!==PROFILE||seal.productCalls!==0||Date.now()>=bodyDeadline)throw Error('CONTROL_AUTHORITY');
for(const [name,pin]of Object.entries(seal.files))readPinned(path.join(packet,name),pin);
pinExecutable(seal.node);
const data=[],actual=[];
const ledger={starts:0,maximum:4,active:0,captureBytes:0,captureMaximum:8388608,rows:[],stopped:false};
const record={profile:PROFILE,kind:'DATA_AND_HARMLESS_ONLY',data,actual,ledger,primaryPresent:false,productCalls:0,loaderThreads:0,extraOwnedChildren:'UNQUALIFIED_UNTIL_RECEIPTS',extraWorkers:'UNQUALIFIED_UNTIL_RECEIPTS'};
function test(id,body){try{body();data.push({id,pass:true});}catch(reason){data.push({id,pass:false,error:errorRecord(reason)});}}
const baseRole={profile:PROFILE,kind:'harmless-control',id:'DATA',app:packet,entry:path.join(packet,'fixtures/H01.mjs'),guard:path.join(packet,'guard.mjs'),trace:path.join(work,'trace'),rolePath:path.join(work,'role'),readFiles:[path.join(work,'trace'),path.join(work,'role')],files:{[path.join(packet,'fixtures/H01.mjs')]:seal.files['fixtures/H01.mjs']},edges:{},builtins:[],childProcessPermission:0,workerPermission:0,loaderThreads:0,loaderMode:'synchronous-registerHooks'};
try{
  test('D01',()=>{const pin=seal.files['fixtures/loaded.mjs'],filename=path.join(packet,'fixtures/loaded.mjs');assert.equal(hash(readPinned(filename,pin)),pin.sha256);assert.throws(()=>readPinned(filename,{...pin,bytes:pin.bytes+1}),/AUTH_TYPE_SIZE/);assert.throws(()=>readPinned(filename,{...pin,sha256:'0'.repeat(64)}),/AUTH_HASH/);});
  test('D02',()=>{assert.equal(validateRole(baseRole),baseRole);assert.throws(()=>validateRole({...baseRole,workerPermission:1}),/ROLE_AUTHORITY/);assert.throws(()=>validateArguments(baseRole,[...caseArguments(baseRole),'--allow-child-process'],{}),/CHILD_ARGUMENT_AUTHORITY/);assert.throws(()=>validateArguments(baseRole,caseArguments(baseRole),{NODE_OPTIONS:''}),/CHILD_ARGUMENT_AUTHORITY/);});
  test('D03',()=>{const life={exit:true,close:true,stdoutEOF:true,stderrEOF:true,capturesQualified:true,forced:false,primaryPresent:false};const receipt={profile:PROFILE,publicSettlement:{execObserved:true,disposeSettled:true,disposeRejected:false}};assert.equal(completion(receipt,life),true);assert.equal(completion({...receipt,publicSettlement:{...receipt.publicSettlement,disposeSettled:false}},life),false);assert.equal(completion({...receipt,publicSettlement:{...receipt.publicSettlement,disposeRejected:true}},life),false);assert.equal(completion(undefined,life),false);});
  test('D04',()=>{for(const reason of [false,0,undefined]){const primary=new Primary();primary.fail(reason);primary.fail(Error('secondary'));assert.equal(primary.present,true);assert.equal(primary.reason,reason);assert.equal(primary.secondary.length,1);}});
  test('D05',()=>{for(const failed of ['fsyncSync','closeSync']){const original=Error(failed),operations={openSync(){return 8;},writeFileSync(){},fstatSync(){return {size:1};},readSync(descriptor,bytes){bytes[0]=120;return 1;},fsyncSync(){if(failed==='fsyncSync')throw original;},closeSync(){if(failed==='closeSync')throw original;}};assert.throws(()=>publish('DATA',Buffer.from('x'),Date.now()+1000,operations),reason=>reason===original);}let writes=0;assert.throws(()=>publish('DATA',Buffer.from('x'),Date.now()-1,{openSync(){writes++;}}),/FINAL_DEADLINE/);assert.equal(writes,0);});
  test('D06',()=>{const good={primaryPresent:false,forced:false,exit:true,close:true,stdoutEOF:true,stderrEOF:true,capturesQualified:true,knownOutstanding:0};assert.equal(qualifyDirect(good),true);for(const key of ['exit','close','stdoutEOF','stderrEOF','capturesQualified'])assert.equal(Boolean(qualifyDirect({...good,[key]:false})),false);assert.equal(Boolean(qualifyDirect({...good,knownOutstanding:1})),false);assert.equal(Boolean(qualifyDirect({...good,forced:true})),false);});
  publish(path.join(work,'DATA-RESULT.json'),Buffer.from(JSON.stringify(data,null,2)+'\n'),finalDeadline);
  if(data.some(row=>!row.pass))throw Error('DATA_QUALIFICATION_FAILED');
  for(const id of ['H01','H02','H03','H04']){
    if(ledger.stopped||Date.now()>=bodyDeadline)throw Error('CONTROL_STOP');
    const rolePath=path.join(work,id+'.role.json'),trace=path.join(work,id+'.trace');
    fs.writeFileSync(trace,'',{flag:'wx',mode:384});
    const files={};for(const [name,pin]of Object.entries(seal.files))if(name.endsWith('.mjs'))files[path.join(packet,name)]=pin;
    files[path.join(packet,'fixtures/wrong.mjs')]={...seal.files['fixtures/wrong.mjs'],sha256:'0'.repeat(64)};
    const edges={};
    edges[path.join(packet,'fixtures/H01.mjs')]=['node:fs','node:child_process'];
    edges[path.join(packet,'fixtures/H02.mjs')]=['node:fs','node:worker_threads'];
    edges[path.join(packet,'fixtures/H03.mjs')]=['node:fs','./loaded.mjs','./wrong.mjs'];
    edges[path.join(packet,'fixtures/H04.mjs')]=['node:fs'];
    edges[path.join(packet,'fixtures/loaded.mjs')]=[];
    const role={...baseRole,id,entry:path.join(packet,'fixtures',id+'.mjs'),rolePath,trace,readFiles:[rolePath,trace],files,edges,builtins:['node:fs','node:child_process','node:worker_threads'],nodePath:seal.node.path,extraChild:path.join(packet,'fixtures/extra-child.mjs'),extraWorker:path.join(packet,'fixtures/extra-worker.mjs'),home:work};
    const roleBytes=Buffer.from(JSON.stringify(role)+'\n');publish(rolePath,roleBytes,finalDeadline);
    const env={PATH:work,HOME:work,TMPDIR:work,LC_ALL:'C',LANG:'C',TZ:'UTC',SURFACE_ROLE:rolePath,SURFACE_ROLE_BYTES:String(roleBytes.length),SURFACE_ROLE_SHA256:hash(roleBytes)};
    const args=caseArguments(role);validateArguments(role,args,env);
    const {row}=await runDirect({id,node:seal.node,args,cwd:work,env,capture:path.join(work,id),bodyDeadline,finalDeadline,timeoutMs:3000},ledger);
    const traceStat=fs.lstatSync(trace);if(!traceStat.isFile()||traceStat.size>524288)throw Error('TRACE_TYPE_SIZE');const traceBytes=fs.readFileSync(trace);ledger.captureBytes+=traceBytes.length;if(ledger.captureBytes>ledger.captureMaximum)throw Error('TRACE_CAPTURE_LIMIT');
    const traceRows=traceBytes.toString().trim().split('\n').filter(Boolean).map(line=>JSON.parse(line));
    const entry={id,lifecycle:row,trace:{bytes:traceBytes.length,sha256:hash(traceBytes),base64:traceBytes.toString('base64')},traceRows};actual.push(entry);
    publish(path.join(work,id+'.record.json'),Buffer.from(JSON.stringify(entry,null,2)+'\n'),finalDeadline);
    let observation;
    try { observation=JSON.parse(Buffer.from(row.captures.find(value=>value.kind==='stdout').base64,'base64')); } catch(reason) { entry.observationParseError=errorRecord(reason); }
    entry.observation=observation;
    if(!row.qualified||row.status!==0)throw Error('HARMLESS_CHILD_STOP:'+id);
    if(observation.unexpectedAdmission||observation.extraOwnedChildren!==0||observation.extraWorkers!==0)throw Error('UNEXPECTED_ADMISSION_STOP');
    if(!completion(observation,row)||observation.id!==id||traceRows.filter(value=>value.event==='permission-admitted').length!==1||traceRows.filter(value=>value.event==='synchronous-hooks-installed').length!==1)throw Error('CONTROL_RECEIPT');
    entry.pass=true;
  }
}catch(reason){record.primaryPresent=true;record.primary=errorRecord(reason);ledger.stopped=true;process.exitCode=1;}
record.unrun=['H01','H02','H03','H04'].filter(id=>!actual.some(row=>row.id===id));
if(actual.length===4&&actual.every(row=>row.pass)){record.extraOwnedChildren=0;record.extraWorkers=0;}
record.finished=Date.now();record.qualification='Harmless controls only. Direct process settlement; no group probes, OS containment, universal descendant/thread census or product cleanup proof.';
publish(path.join(work,'CONTROL-RESULT.json'),Buffer.from(JSON.stringify(record,null,2)+'\n'),finalDeadline);
process.stdout.write(JSON.stringify({data:data.filter(row=>row.pass).length,actual:actual.filter(row=>row.pass).length,unrun:record.unrun,primaryPresent:record.primaryPresent,primary:record.primary})+'\n');
