import fs from 'node:fs';
import process from 'node:process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {completion,cleanupTimes,deadlineAdmission,ManagedLedger} from './state.mjs';
import {Storage} from './storage.mjs';
import {finalizeCaptures} from './capture.mjs';
import {classifyGroup} from './observer-state.mjs';
import {small,pinned,validateReview,hash} from './admission.mjs';
import {runManaged} from './lifecycle.mjs';
const directory=path.dirname(fileURLToPath(import.meta.url));
const capture='/private/tmp/bash-functional-launcher-v2-prep-JKgaZw/controls';
const results=[];const started=Date.now();
const assert=(value,message)=>{if(!value)throw Error(message);};
const reject=callback=>{let rejected=false;try{callback();}catch{rejected=true;}assert(rejected,'EXPECTED_REJECTION');};
const write=value=>fs.writeFileSync(capture+'/OWNER-RESULT.json',JSON.stringify(value,null,2)+'\n',{flag:'wx',mode:0o600});
const good=()=>({exit:true,close:true,group:{state:'absent'},signal:null,stop:null,errors:[],capture:[{flush:true,size:true,hash:true,close:true},{flush:true,size:true,hash:true,close:true}],filesVerified:true,receiptPublished:true});
try{
 assert(process.argv.length===4&&process.argv[2]==='--capture'&&process.argv[3]==='/tmp/bash-functional-launcher-v2-prep-JKgaZw/controls'&&fs.realpathSync(process.argv[3])===capture,'CONTROL_ARGUMENTS');
 const sealRaw=fs.readFileSync(directory+'/CONTROL-PRESEAL.json'),seal=JSON.parse(sealRaw);for(const row of seal.files)pinned(directory+'/'+row.path,row,{maximum:1048576});
 const node={path:'/Users/kjopek/.nvm/versions/node/v22.22.2/bin/node',bytes:112989184,mode:493,sha256:'5c899797c4eb8f1db5563eea56538342ddb3e9276ee1b04a5a1f0f1023d2b011'};pinned(node.path,node);assert(process.execPath===node.path&&process.execArgv.length===0,'NODE_OWNER_IDENTITY');
 const plan=JSON.parse(fs.readFileSync(directory+'/CONTROLS.json'));
 function fakeOperations(fail){const closed=[],calls=[];return {closed,calls,fsyncSync(fd){calls.push(['flush',fd]);if(fail==='flush'&&fd===11)throw Object.assign(Error('injected EIO'),{code:'EIO'});},fstatSync(fd){return {isFile:()=>true,ino:fd,nlink:1,size:1,mtimeMs:1};},readSync(fd,buffer){buffer[0]=65;return 1;},closeSync(fd){calls.push(['close',fd]);if(fail==='close'&&fd===11&&!closed.includes('failed')){closed.push('failed');throw Object.assign(Error('injected close'),{code:'EIO'});}closed.push(fd);}};}
 for(const item of plan.identities.slice(0,10)){
  let detail={};
  if(item.id==='C01'||item.id==='C02'){const ops=fakeOperations(item.id==='C01'?'flush':'close');const result=finalizeCaptures([{name:'stdout',fd:11,ino:11},{name:'stderr',fd:12,ino:12}],65536,ops);const row={...good(),capture:result.captures,errors:result.errors};assert(!completion(row)&&!result.success&&ops.closed.includes(11)&&ops.closed.includes(12),'CAPTURE_FAULT_CONTROL');detail={result,closed:ops.closed};}
  if(item.id==='C03'||item.id==='C04'){const dataRoot=capture+'/synthetic';const receipt={schema:'functional-reference-independent-acceptance-v2',decision:'ACCEPT',profile:'functional-reference-v2',presealSha256:'a'.repeat(64),requestsSha256:'b'.repeat(64),reviewer:'SYNTHETIC-NOT-ROOT',reviewCommit:'c'.repeat(40)};const expected={presealSha256:'a'.repeat(64),requestsSha256:'b'.repeat(64)};if(item.id==='C03'){reject(()=>validateReview({...receipt,presealSha256:'d'.repeat(64)},expected));reject(()=>validateReview(null,expected));const filename=dataRoot+'/wrong-mode.json',bytes=Buffer.from('{}');fs.writeFileSync(filename,bytes,{flag:'wx',mode:0o644});reject(()=>small(filename,{bytes:2,mode:384,sha256:hash(bytes)}));reject(()=>small(dataRoot+'/missing.json',{bytes:2,mode:384,sha256:hash(bytes)}));fs.chmodSync(filename,0o600);reject(()=>small(filename,{bytes:2,mode:384,sha256:'e'.repeat(64)}));reject(()=>small(dataRoot+'/../synthetic/wrong-mode.json',{bytes:2,mode:384,sha256:hash(bytes)}));detail={negativeVariants:6};}else{const filename=dataRoot+'/valid-synthetic-review.json',bytes=Buffer.from(JSON.stringify(receipt));fs.writeFileSync(filename,bytes,{flag:'wx',mode:0o600});assert(validateReview(JSON.parse(small(filename,{bytes:bytes.length,mode:384,sha256:hash(bytes)})),expected),'POSITIVE_REVIEW');detail={authority:'SYNTHETIC_ONLY'};}}
  if(item.id==='C05'){const ledger=new ManagedLedger(3,2);ledger.enter('control');reject(()=>ledger.enter('control'));ledger.retire();ledger.enter('control');ledger.retire();reject(()=>ledger.enter('control'));assert(ledger.starts===3&&ledger.sourceForkReservations===0,'LEDGER');detail={ledger};}
  if(item.id==='C06'){const budget=new Storage(capture+'/synthetic',{capture:100,work:1000,emergency:10});budget.scan=()=>({bytes:80});reject(()=>budget.admit(11));budget.admit(10);const work=new Storage(capture+'/synthetic',{capture:1000,work:100,emergency:10});work.scan=()=>({bytes:80});reject(()=>work.admit(11));const observed=new Storage(capture+'/synthetic',{capture:1,work:100000});reject(()=>observed.scan());detail={beforeWriteCapture:true,beforeWriteWork:true,observedOvershoot:true};}
  if(item.id==='C07'){assert(deadlineAdmission(0,66000)&&!deadlineAdmission(1,66000),'TAIL');const budget=new Storage(capture+'/synthetic',{deadline:0});reject(()=>budget.checkTime());detail={tail:60000};}
  if(item.id==='C08'){const unknown=classifyGroup(true,Object.assign(Error('permission'),{code:'EPERM'}));assert(unknown.state==='unknown'&&!completion({...good(),group:unknown}),'UNKNOWN_NOT_ABSENT');detail={unknown};}
  if(item.id==='C09'){const schedule=cleanupTimes(123);assert(schedule.termAt===123&&schedule.killAt===2123&&schedule.endAt===3123,'CLEANUP_ORIGIN');detail={schedule};}
  if(item.id==='C10'){assert(completion(good()),'VALID_COMPLETION');for(const key of ['filesVerified','receiptPublished'])assert(!completion({...good(),[key]:false}),'PUBLICATION_PREREQUISITE');assert(!completion({...good(),errors:[{code:'EIO'}]})&&!completion({...good(),capture:[]}), 'ERROR_OR_MISSING_CAPTURE');for(const field of ['flush','size','hash','close']){const row=good();row.capture[0][field]=false;assert(!completion(row),'CAPTURE_PREREQUISITE');}detail={valid:1,negativeVariants:8};}
  results.push({id:item.id,kind:item.kind,matched:true,detail});
 }
 const storage=new Storage(capture,{deadline:Math.min(started+30000,seal.preparationDeadline)}),ledger=new ManagedLedger(3,2);
 for(const [index,item] of plan.identities.slice(10).entries()){
  const location=capture+'/'+(index===0?'delayed':'kill');const row=await runManaged({id:item.id,role:'control',executable:node.path,args:['-e',item.program],env:{LC_ALL:'C',LANG:'C',TZ:'UTC',HOME:location+'/home',TMPDIR:location+'/tmp',PATH:location+'/empty-path'},cwd:location,captureRoot:location,stdin:Buffer.alloc(0)},{storage,ledger,perCaseMs:3000,termMs:2000,killMs:1000});
  const stdout=row.capture.find(value=>value.name==='stdout'),stderr=row.capture.find(value=>value.name==='stderr');
  assert(row.retired&&row.exit&&row.close&&row.group.state==='absent'&&row.regularCaptureCompletion&&row.errors.length===0,'ACTUAL_RESOURCE_STOP');assert(row.stop==='CASE_DEADLINE'&&!completion(row),'NO_FALSE_OBSERVATION_CREDIT');assert(Buffer.from(stdout.base64,'base64').toString()===item.expectedStdout&&stderr.bytes===0,'LITERAL_CAPTURE');
  const term=row.signals.find(value=>value.signal==='SIGTERM'),kill=row.signals.find(value=>value.signal==='SIGKILL');assert(term?.sent,'TERM_SENT');if(index===0){assert(row.status===0&&row.signal===null&&!kill&&row.finished-term.at>=100,'DELAYED_RETIREMENT');}else{assert(kill?.sent&&kill.at-term.at>=2000&&row.signal==='SIGKILL'&&row.groupObservations.some(value=>value.afterKill&&value.state==='absent'),'KILL_RETIREMENT');}
  results.push({id:item.id,kind:item.kind,matched:true,row});
 }
 assert(ledger.starts===3&&ledger.confirmedStarts===3&&ledger.active===1&&ledger.activeConfirmed===1,'KNOWN_OWNER_AND_TWO_CHILDREN');write({schema:'launcher-v2-control-results',status:'COMPLETE',sourceSealSha256:hash(sealRaw),results,synthetic:10,actualLiteralFixtures:2,knownNodeStartsIncludingOwner:3,ledger,nativeBash:0,product:0,finished:Date.now()});process.stdout.write(JSON.stringify({status:'COMPLETE',controls:results.length,synthetic:10,literalFixtures:2})+'\n');
}catch(error){write({schema:'launcher-v2-control-results',status:'STOP',results,error:{name:error.name,message:String(error.message).slice(0,512)},finished:Date.now()});process.stdout.write(JSON.stringify({status:'STOP',completedControls:results.length,message:String(error.message).slice(0,256)})+'\n');process.exitCode=1;}
