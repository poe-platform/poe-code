import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import {fileURLToPath} from 'node:url';
import {Storage} from './storage.mjs';
import {ManagedLedger,deadlineAdmission,creditObservation} from './state.mjs';
import {admit,small,pinned,hash} from './admission.mjs';
import {runManaged} from './lifecycle.mjs';
import {finalizeCaptures} from './capture.mjs';
const directory=path.dirname(fileURLToPath(import.meta.url));
const root='/private/tmp/safe-bash-surface-functional-v3-20260829-01';
const started=Date.now();
const ledger=new ManagedLedger(80,6);
const storage=new Storage(root,{deadline:started+600000});
const abort=new AbortController();
const callerSignal=()=>abort.abort('OWNER_SIGNAL');
process.on('SIGTERM',callerSignal);process.on('SIGINT',callerSignal);
let completed=0,halted=false,outerHandles=[],finalizedOuter=false,publicationFailure=null;
const rows=[];
const assert=(value,message)=>{if(!value)throw Error(message);};
function snapshot(caseRoot){const result=[];let total=0;function walk(absolute,relative){for(const name of fs.readdirSync(absolute).sort()){const filename=path.join(absolute,name),stat=fs.lstatSync(filename),rel=relative?relative+'/'+name:name;assert(result.length<32&&!stat.isSymbolicLink(),'SNAPSHOT_ENTRY');if(stat.isDirectory()){result.push({path:rel,type:'directory',mode:stat.mode&511});walk(filename,rel);}else{assert(stat.isFile()&&stat.nlink===1&&stat.size<=65536,'SNAPSHOT_FILE');const bytes=fs.readFileSync(filename);total+=bytes.length;assert(total<=262144,'SNAPSHOT_BYTES');result.push({path:rel,type:'file',mode:stat.mode&511,base64:bytes.toString('base64')});}}}walk(caseRoot,'');return result;}
try{
 assert(process.argv.length===6&&process.argv[2]==='--grant'&&process.argv[4]==='--grant-sha256','EXACT_ARGUMENTS');
 const provision=JSON.parse(fs.readFileSync(directory+'/PREPROVISION.json'));
 for(const parent of provision.parents){const stat=fs.lstatSync(parent.path,{bigint:true});assert(stat.isDirectory()&&String(stat.dev)===parent.device&&String(stat.ino)===parent.inode&&Number(stat.mode&511n)===parent.mode,'PREPROVISION_DRIFT');}
 for(const [name,fd] of [['stdout',1],['stderr',2]]){const filename=root+'/outer/bootstrap.'+name,stat=fs.fstatSync(fd),named=fs.lstatSync(filename);assert(stat.isFile()&&named.isFile()&&!named.isSymbolicLink()&&stat.ino===named.ino&&stat.dev===named.dev&&stat.nlink===1&&(stat.mode&511)===384,'OUTER_FD_BINDING');outerHandles.push({name,fd,ino:stat.ino,path:filename});}
 storage.record({event:'RAW_START_BEFORE_ADMISSION',pid:process.pid,started,externalCapture:'pre-opened regular descriptors before Node module loading'});
 const accepted=admit(directory,process.argv[3],process.argv[5]);
 const protocol=JSON.parse(small(directory+'/PROTOCOL.json',accepted.seal.files.find(row=>row.path==='PROTOCOL.json')));
 storage.deadline=Math.min(accepted.grant.deadlineEpochMs,started+protocol.limits.totalMs);assert(JSON.stringify(accepted.grant.limits)===JSON.stringify(protocol.limits),'GRANT_LIMITS');
 const tools=JSON.parse(small(directory+'/TOOLS.json',accepted.seal.files.find(row=>row.path==='TOOLS.json')));for(const tool of [...tools.toolPins,tools.environmentLauncher])pinned(tool.path,tool);
 assert(process.execPath===tools.toolPins.find(row=>row.path.includes('/node/')).path&&process.execArgv.length===0&&!process.env.NODE_OPTIONS,'OWNER_IDENTITY');
 assert(Date.now()-started<=60000,'SETUP_DEADLINE');
 const audit=JSON.parse(small(directory+'/AUDIT.json',accepted.seal.files.find(row=>row.path==='AUDIT.json')));
 const expectedIds=audit.cases.filter(row=>!['B26','B27','B28'].includes(row.id)).map(row=>row.id);
 assert(JSON.stringify(expectedIds)===JSON.stringify(accepted.requests.map(row=>row.id))&&expectedIds.length===37,'EXACT37');
 process.umask(18);
 for(const request of accepted.requests){
  assert(!abort.signal.aborted&&deadlineAdmission(Date.now(),storage.deadline),'ADMISSION_DEADLINE');
  const literal=audit.cases.find(row=>row.id===request.id),caseRoot=root+'/cases/'+request.id,captureRoot=root+'/captures/'+request.id;
  assert(JSON.stringify(request.argv)===JSON.stringify(['--noprofile','--norc','-c',literal.program,'surface-case'])&&hash(Buffer.from(literal.program))===literal.programSha256&&request.executable==='/bin/bash','LITERAL_BINDING');
  assert(request.stdinBase64===literal.stdinBase64,'STDIN_BINDING');
  assert(request.cwd===caseRoot+'/work','REQUEST_NAMESPACE_BINDING');
  const env={LC_ALL:'C',LANG:'C',TZ:'UTC',HOME:caseRoot+'/home',TMPDIR:caseRoot+'/tmp',PATH:caseRoot+'/empty-path'};
  assert(JSON.stringify(request.environment)===JSON.stringify(env),'ENVIRONMENT_BINDING');
  fs.mkdirSync(caseRoot,{mode:448});fs.mkdirSync(captureRoot,{mode:448});for(const name of ['work','home','tmp','empty-path'])fs.mkdirSync(caseRoot+'/'+name,{mode:448});
  for(const fixture of audit.fixtures){assert(['a.txt','b.txt','.hidden','source-fixture'].includes(fixture.path),'FIXTURE_PATH');const bytes=Buffer.from(fixture.base64,'base64');assert(hash(bytes)===fixture.sha256&&bytes.length===fixture.bytes,'FIXTURE_BYTES');storage.write(caseRoot+'/work/'+fixture.path,bytes);}
  assert(fs.readdirSync(caseRoot+'/empty-path').length===0,'EMPTY_PATH');const before=snapshot(caseRoot);
  ledger.sourceForkReservations+=request.extraProcessReservation;assert(ledger.sourceForkReservations<=13,'SOURCE_RESERVATION_DRIFT');
  const row=await runManaged({id:request.id,role:'case',executable:'/bin/bash',args:request.argv,env,cwd:caseRoot+'/work',stdin:Buffer.from(request.stdinBase64,'base64'),captureRoot},{storage,ledger,signal:abort.signal});
  rows.push({id:row.id,status:row.status,stop:row.stop,retired:row.retired});
  if(row.stop||row.errors.length||!row.regularCaptureCompletion){halted=true;break;}
  row.filesBefore=before;row.filesAfter=snapshot(caseRoot);const expected=new Map(before.map(item=>[item.path,item]));for(const item of row.filesAfter){const prior=expected.get(item.path);if(prior){assert(JSON.stringify(item)===JSON.stringify(prior),'FIXTURE_MUTATION');expected.delete(item.path);}else assert(['B23','B25'].includes(row.id)&&item.path==='work/out'&&item.type==='file'&&Buffer.from(item.base64,'base64').length<=2,'UNEXPECTED_EFFECT');}assert(expected.size===0,'FIXTURE_DELETION');row.filesVerified=true;
  storage.checkTime();storage.scan();storage.write(root+'/'+row.id+'.json',JSON.stringify(row)+'\n');row.receiptPublished=true;
  completed=creditObservation(row,storage,completed);
 }
 storage.checkTime();storage.scan();
 const outer=finalizeCaptures(outerHandles);finalizedOuter=true;assert(outer.success,'OUTER_CAPTURE_FINALIZATION');
 storage.checkTime();storage.write(root+'/RESULTS.json',JSON.stringify({schema:'functional-native-observations-v3',completed,halted,rows,ledger,outer:outer.captures,sourceForkCounts:'PLANNED_NOT_OBSERVED',osContainment:false,version:'Bash3.2.57',notStarted:expectedIds.slice(rows.length),deadline:storage.deadline})+'\n');storage.checkTime();storage.scan();
 process.exitCode=halted?1:0;
}catch(error){halted=true;try{storage.terminal({event:'HOLD_OR_STOP',message:String(error.message??error).slice(0,512),completed,ledger,at:Date.now()});}catch(secondary){publicationFailure={primary:error,secondary,terminal:storage.terminalState,late:Date.now()>storage.deadline};}
 process.exitCode=1;
}finally{process.removeListener('SIGTERM',callerSignal);process.removeListener('SIGINT',callerSignal);if(!finalizedOuter&&outerHandles.length){const result=finalizeCaptures(outerHandles);if(!result.success)process.exitCode=1;}}
