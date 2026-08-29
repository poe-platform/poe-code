import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import {fileURLToPath} from 'node:url';
import {Storage} from './storage.mjs';
import {ManagedLedger,deadlineAdmission,creditObservation} from './state.mjs';
import {admit,small,pinned,hash,validateOuter,validateProvision,validateCohort} from './admission.mjs';
import {runManaged} from './lifecycle.mjs';
import {finalizeCaptures} from './capture.mjs';
import {encodeObservation,validateEffects} from './observation.mjs';
const directory=path.dirname(fileURLToPath(import.meta.url));
const root='/private/tmp/safe-bash-pipestatus-typed-observations-20260829-v1';
const started=Date.now();
const ledger=new ManagedLedger(7,2);
const storage=new Storage(root,{deadline:started+600000});
const abort=new AbortController();
const callerSignal=()=>abort.abort('OWNER_SIGNAL');
process.on('SIGTERM',callerSignal);process.on('SIGINT',callerSignal);
let completed=0,halted=false,outerHandles=[],finalizedOuter=false,publicationFailure=null;
const rows=[];
const assert=(value,message)=>{if(!value)throw Error(message);};
function snapshot(caseRoot){const result=[];let total=0;function walk(absolute,relative){for(const name of fs.readdirSync(absolute).sort()){const filename=path.join(absolute,name),stat=fs.lstatSync(filename),rel=relative?relative+'/'+name:name;assert(result.length<32&&!stat.isSymbolicLink(),'SNAPSHOT_ENTRY');if(stat.isDirectory()){result.push({path:rel,type:'directory',mode:stat.mode&511});walk(filename,rel);}else{assert(stat.isFile()&&stat.nlink===1&&stat.uid===process.getuid()&&stat.size<=65536,'SNAPSHOT_FILE');const bytes=fs.readFileSync(filename);total+=bytes.length;assert(total<=262144,'SNAPSHOT_BYTES');result.push({path:rel,type:'file',mode:stat.mode&511,base64:bytes.toString('base64')});}}}walk(caseRoot,'');return result;}
try{
 assert(process.argv.length===6&&process.argv[2]==='--grant'&&process.argv[4]==='--grant-sha256','EXACT_ARGUMENTS');
 for(const [name,fd] of [['stdout',1],['stderr',2]])outerHandles.push(validateOuter(root,name,fd));
 const accepted=admit(directory,process.argv[3],process.argv[5]);
 storage.deadline=Math.min(accepted.grant.deadlineEpochMs,started+600000);storage.checkTime();
 validateProvision(accepted.provision,root);
 storage.record({event:'AUTHENTICATED_START',pid:process.pid,started,externalCapture:'pre-opened regular descriptors before Node module loading'});
 const protocol=JSON.parse(small(directory+'/PROTOCOL.json',accepted.seal.files.find(row=>row.path==='PROTOCOL.json')));
 storage.deadline=Math.min(accepted.grant.deadlineEpochMs,started+protocol.limits.totalMs);assert(JSON.stringify(accepted.grant.limits)===JSON.stringify(protocol.limits),'GRANT_LIMITS');
 const tools=JSON.parse(small(directory+'/TOOLS.json',accepted.seal.files.find(row=>row.path==='TOOLS.json')));for(const tool of [...tools.toolPins,tools.environmentLauncher])pinned(tool.path,tool);
 assert(process.execPath===tools.toolPins.find(row=>row.path.includes('/node/')).path&&process.execArgv.length===0&&!process.env.NODE_OPTIONS,'OWNER_IDENTITY');
 assert(Date.now()-started<=60000,'SETUP_DEADLINE');
 const audit=JSON.parse(small(directory+'/COHORT.json',accepted.seal.files.find(row=>row.path==='COHORT.json')));
 validateCohort(audit,accepted.requests,root);
 for(const literal of audit.cases){const relative='programs/'+literal.id+'.bash.data';assert(small(directory+'/'+relative,accepted.seal.files.find(item=>item.path===relative)).equals(Buffer.from(literal.program)),'PROGRAM_FILE_BINDING');}
 const expectedIds=audit.cases.map(row=>row.id);
 assert(JSON.stringify(expectedIds)===JSON.stringify(accepted.requests.map(row=>row.id))&&expectedIds.length===6,'EXACT6');
 process.umask(18);
 for(const request of accepted.requests){
  assert(!abort.signal.aborted&&deadlineAdmission(Date.now(),storage.deadline),'ADMISSION_DEADLINE');
  const literal=audit.cases.find(row=>row.id===request.id),caseRoot=root+'/cases/'+request.id,captureRoot=root+'/captures/'+request.id;
  assert(JSON.stringify(request.argv)===JSON.stringify(['--noprofile','--norc','-c',literal.program,'pipestatus-typed-case'])&&hash(Buffer.from(literal.program))===literal.programSha256&&request.executable==='/bin/bash','LITERAL_BINDING');
  assert(request.stdinBase64===literal.stdinBase64,'STDIN_BINDING');
  assert(request.cwd===caseRoot+'/work','REQUEST_NAMESPACE_BINDING');
  const env={LC_ALL:'C',LANG:'C',TZ:'UTC',HOME:caseRoot+'/home',TMPDIR:caseRoot+'/tmp',PATH:caseRoot+'/empty-path'};
  assert(JSON.stringify(request.environment)===JSON.stringify(env),'ENVIRONMENT_BINDING');
  fs.mkdirSync(caseRoot,{mode:448});fs.mkdirSync(captureRoot,{mode:448});for(const name of ['work','home','tmp','empty-path'])fs.mkdirSync(caseRoot+'/'+name,{mode:448});
  assert(Array.isArray(audit.fixtures)&&audit.fixtures.length===0,'NO_FIXTURES');
  assert(fs.readdirSync(caseRoot+'/empty-path').length===0,'EMPTY_PATH');const before=snapshot(caseRoot);
  ledger.sourceForkReservations+=request.extraProcessReservation;assert(Number.isSafeInteger(request.extraProcessReservation)&&request.extraProcessReservation>=0&&ledger.sourceForkReservations<=4,'SOURCE_RESERVATION_DRIFT');
  const row=await runManaged({id:request.id,role:'case',executable:'/bin/bash',args:request.argv,env,cwd:caseRoot+'/work',stdin:Buffer.from(request.stdinBase64,'base64'),captureRoot},{storage,ledger,signal:abort.signal});
  rows.push({id:row.id,status:row.status,stop:row.stop,retired:row.retired});
  if(row.stop||row.errors.length||!row.regularCaptureCompletion){halted=true;break;}
  row.filesBefore=before;row.filesAfter=snapshot(caseRoot);validateEffects(request.id,before,row.filesAfter);row.filesVerified=true;const framed=encodeObservation(row);storage.write(root+'/'+row.id+'.observation.nul',framed);row.observation={format:'FNPIPEOBS1',bytes:framed.length,sha256:hash(framed)};
  storage.checkTime();storage.scan();storage.write(root+'/'+row.id+'.json',JSON.stringify(row)+'\n');row.receiptPublished=true;
  completed=creditObservation(row,storage,completed);
 }
 storage.checkTime();storage.scan();
 const outer=finalizeCaptures(outerHandles);finalizedOuter=true;assert(outer.success,'OUTER_CAPTURE_FINALIZATION');
 storage.checkTime();storage.write(root+'/RESULTS.json',JSON.stringify({schema:'pipestatus-typed-native-observations-v1',completed,halted,rows,ledger,outer:outer.captures,sourceForkCounts:'PLANNED_NOT_OBSERVED',osContainment:false,version:'Bash3.2.57',notStarted:expectedIds.slice(rows.length),deadline:storage.deadline})+'\n');storage.checkTime();storage.scan();
 process.exitCode=halted?1:0;
}catch(error){halted=true;try{storage.terminal({event:'HOLD_OR_STOP',message:String(error.message??error).slice(0,512),completed,ledger,at:Date.now()});}catch(secondary){publicationFailure={primary:error,secondary,terminal:storage.terminalState,late:Date.now()>storage.deadline};}
 process.exitCode=1;
}finally{process.removeListener('SIGTERM',callerSignal);process.removeListener('SIGINT',callerSignal);if(!finalizedOuter&&outerHandles.length){const result=finalizeCaptures(outerHandles);if(!result.success)process.exitCode=1;}}
