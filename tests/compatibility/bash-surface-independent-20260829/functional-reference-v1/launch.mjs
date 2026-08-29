import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
import process from 'node:process';
const directory=path.dirname(fileURLToPath(import.meta.url));
const runRoot='/private/tmp/safe-bash-surface-functional-v1-20260829-01';
const started=Date.now();
fs.mkdirSync(runRoot,{mode:0o700});
const journal=fs.openSync(path.join(runRoot,'OUTER.jsonl'),'wx',0o600);
let journalBytes=0;
function record(value){const bytes=Buffer.from(JSON.stringify(value)+'\n');if(journalBytes+bytes.length>1048576)throw Error('JOURNAL_CAP');fs.writeFileSync(journal,bytes);journalBytes+=bytes.length;}
record({event:'RAW_START',started,profile:'FUNCTIONAL_ONLY_NO_OS_FENCE',pid:process.pid});
const requireValue=(value,message)=>{if(!value)throw Error(message);};
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
function regular(filename,maximum=1048576){const descriptor=fs.openSync(filename,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);try{const before=fs.fstatSync(descriptor);requireValue(before.isFile()&&before.nlink===1&&before.size<=maximum,'REGULAR_INPUT');const bytes=fs.readFileSync(descriptor);const after=fs.fstatSync(descriptor);requireValue(before.ino===after.ino&&before.size===after.size&&before.mtimeMs===after.mtimeMs,'INPUT_RACE');return bytes;}finally{fs.closeSync(descriptor);}}
function authenticateFile(filename,pin){const descriptor=fs.openSync(filename,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);try{const before=fs.fstatSync(descriptor);requireValue(before.isFile()&&before.size===pin.bytes,'SIZE_DRIFT');if(pin.mode!==undefined)requireValue((before.mode&0o777)===pin.mode,'MODE_DRIFT');const digest=createHash('sha256'),buffer=Buffer.alloc(1048576);let total=0,count;while((count=fs.readSync(descriptor,buffer,0,buffer.length,null))>0){total+=count;requireValue(total<=pin.bytes,'GROWING_INPUT');digest.update(buffer.subarray(0,count));}requireValue(total===pin.bytes&&digest.digest('hex')===pin.sha256,'HASH_DRIFT');const after=fs.fstatSync(descriptor);requireValue(before.ino===after.ino&&before.size===after.size&&before.mtimeMs===after.mtimeMs,'AUTH_RACE');}finally{fs.closeSync(descriptor);}}
let completed=0,ownedStarts=0,reservedInternal=0,halted=false,captureBytes=0;
const observations=[];
try{
 requireValue(process.argv.length===4&&process.argv[2]==='--grant'&&process.argv[3]===path.join(directory,'GO.json'),'EXACT_ARGUMENTS');
 requireValue(process.execArgv.length===0&&!process.env.NODE_OPTIONS,'CONTROLLER_PRELOAD_REFUSED');
 const sealRaw=regular(path.join(directory,'PRESEAL.json')),seal=JSON.parse(sealRaw);
 const grant=JSON.parse(regular(path.join(directory,'GO.json')));
 requireValue(grant.decision==='GO'&&grant.profile==='functional-bash32-v1'&&grant.presealSha256===hash(sealRaw)&&grant.independentReviewAccepted===true&&grant.toolApprovalRequired===true,'FRESH_GRANT_REQUIRED');
 requireValue(Number.isSafeInteger(grant.deadlineEpochMs)&&grant.deadlineEpochMs>Date.now(),'GRANT_DEADLINE');
 for(const item of seal.files)authenticateFile(path.join(directory,item.path),item);
 const protocol=JSON.parse(regular(path.join(directory,'PROTOCOL.json'))),audit=JSON.parse(regular(path.join(directory,'AUDIT.json'))),requests=JSON.parse(regular(path.join(directory,'REQUESTS.json')));
 requireValue(protocol.root===runRoot&&requests.length===37&&JSON.stringify(requests.map(row=>row.id))===JSON.stringify(protocol.eligible),'EXACT_MEMBERSHIP');
 requireValue(JSON.stringify(grant.limits)===JSON.stringify(protocol.limits),'LIMIT_DRIFT');
 requireValue(process.execPath===protocol.node.path,'CONTROLLER_IDENTITY');authenticateFile(protocol.node.path,protocol.node);authenticateFile(protocol.binary.path,protocol.binary);const tools=JSON.parse(regular(path.join(directory,'TOOLS.json')));authenticateFile(tools.environmentLauncher.path,tools.environmentLauncher);
 const deadline=Math.min(grant.deadlineEpochMs,started+protocol.limits.totalMs);
 requireValue(Date.now()-started<=protocol.limits.setupMs,'SETUP_DEADLINE');
 const {observeOwnedGroup,signalOwnedGroup,binding}=await import('./group-observer.mjs');
 record({event:'ADMITTED',binding,deadline,requests:requests.length,internalStarts:'SOURCE_BOUND_NOT_OBSERVED',noOsFence:true});
 process.umask(protocol.umask);
 const snapshot=caseRoot=>{const result=[];let total=0;function walk(absolute,relative){for(const name of fs.readdirSync(absolute).sort()){const filename=path.join(absolute,name),rel=relative?relative+'/'+name:name,stat=fs.lstatSync(filename);requireValue(result.length<protocol.limits.snapshotEntries,'SNAPSHOT_ENTRIES');if(stat.isDirectory()){result.push({path:rel,type:'directory',mode:stat.mode&0o777});walk(filename,rel);}else{requireValue(stat.isFile()&&!stat.isSymbolicLink(),'UNEXPECTED_ENTRY_TYPE');const bytes=regular(filename,protocol.limits.snapshotFileBytes);total+=bytes.length;requireValue(total<=protocol.limits.snapshotBytes,'SNAPSHOT_BYTES');result.push({path:rel,type:'file',mode:stat.mode&0o777,base64:bytes.toString('base64')});}}}walk(caseRoot,'');return result;};
 for(const request of requests){
  requireValue(!halted&&Date.now()+protocol.limits.perCaseMs+protocol.limits.termMs+protocol.limits.killMs+protocol.limits.finalizationMs<=deadline,'ADMISSION_DEADLINE');
  const literal=audit.cases.find(row=>row.id===request.id);requireValue(literal?.disposition==='PROPOSED_UNRUN'&&request.argv[3]===literal.program&&hash(Buffer.from(literal.program))===request.programSha256,'LITERAL_BINDING');
  requireValue(request.executable==='/bin/bash'&&request.argv.length===5&&request.argv[0]==='--noprofile'&&request.argv[1]==='--norc'&&request.argv[2]==='-c'&&request.argv[4]==='surface-case','ARGV_BINDING');
  requireValue(Buffer.byteLength(literal.program)<=protocol.limits.programBytes&&Buffer.from(request.stdinBase64,'base64').length<=protocol.limits.stdinBytes,'INPUT_CAP');
  const caseRoot=path.join(runRoot,request.id);fs.mkdirSync(caseRoot,{mode:0o700});for(const name of ['work','home','tmp','empty-path'])fs.mkdirSync(path.join(caseRoot,name),{mode:0o700});
  for(const fixture of audit.fixtures){requireValue(['a.txt','b.txt','.hidden','source-fixture'].includes(fixture.path),'FIXTURE_NAME');const bytes=Buffer.from(fixture.base64,'base64');requireValue(hash(bytes)===fixture.sha256&&bytes.length===fixture.bytes,'FIXTURE_BYTES');fs.writeFileSync(path.join(caseRoot,'work',fixture.path),bytes,{flag:'wx',mode:fixture.mode});}
  requireValue(request.cwd===path.join(caseRoot,'work')&&JSON.stringify(request.environment)===JSON.stringify({LC_ALL:'C',LANG:'C',TZ:'UTC',HOME:path.join(caseRoot,'home'),TMPDIR:path.join(caseRoot,'tmp'),PATH:path.join(caseRoot,'empty-path')}),'ENVIRONMENT_BINDING');
  const before=snapshot(caseRoot),stdoutPath=path.join(runRoot,request.id+'.stdout'),stderrPath=path.join(runRoot,request.id+'.stderr');
  const stdout=fs.openSync(stdoutPath,'wx',0o600),stderr=fs.openSync(stderrPath,'wx',0o600);
  const row={id:request.id,request,started:Date.now(),exit:false,close:false,stdinFinished:false,status:null,signal:null,errors:[],signals:[],regularCaptureCompletion:false,streamEOF:null,group:{state:'unknown',error:{kind:'NOT_OBSERVED'}},internalStartsObserved:null,sourceInternalReservation:request.extraProcessReservation};
  let child,settle,finished=false;const closed=new Promise(resolve=>{settle=resolve;});
  const finish=value=>{if(!finished){finished=true;settle(value);}};
  const stop=reason=>{if(!row.stop){row.stop=reason;halted=true;if(child?.pid)row.signals.push({signal:'SIGTERM',...signalOwnedGroup(child.pid,'SIGTERM')});}};
  ownedStarts++;reservedInternal+=request.extraProcessReservation;requireValue(ownedStarts<=37&&reservedInternal<=13,'PROCESS_RESERVATION');record({event:'ENROLLED',id:row.id,ownedStarts,reservedInternal,request});
  let termTimer,killTimer,finalTimer,poll;
  try{
   child=spawn(request.executable,request.argv,{cwd:request.cwd,env:request.environment,detached:true,shell:false,stdio:['pipe',stdout,stderr]});
   child.on('error',error=>{row.errors.push({phase:'child',name:error.name,code:error.code??null});stop('CHILD_ERROR');});
   child.on('exit',(status,signal)=>{row.exit=true;row.status=status;row.signal=signal;});
   child.on('close',()=>{row.close=true;finish(true);});
   child.stdin.on('error',error=>{if(error.code==='EPIPE'){row.stdinEpipe=true;return;}row.errors.push({phase:'stdin',name:error.name,code:error.code??null});stop('STDIN_ERROR');});
   child.stdin.on('finish',()=>{row.stdinFinished=true;});row.pid=child.pid;
   termTimer=setTimeout(()=>stop('CASE_DEADLINE'),protocol.limits.perCaseMs);
   killTimer=setTimeout(()=>{halted=true;row.stop??='CASE_DEADLINE';if(child.pid)row.signals.push({signal:'SIGKILL',...signalOwnedGroup(child.pid,'SIGKILL')});},protocol.limits.perCaseMs+protocol.limits.termMs);
   finalTimer=setTimeout(()=>{row.stop??='UNKNOWN_RETIREMENT';halted=true;finish(false);},protocol.limits.perCaseMs+protocol.limits.termMs+protocol.limits.killMs);
   poll=setInterval(()=>{try{if(fs.fstatSync(stdout).size>protocol.limits.perStreamBytes||fs.fstatSync(stderr).size>protocol.limits.perStreamBytes)stop('CAPTURE_OVERFLOW');}catch(error){row.errors.push({phase:'capture-monitor',name:error.name,code:error.code??null});stop('CAPTURE_ERROR');}},10);
   child.stdin.end(Buffer.from(request.stdinBase64,'base64'));const knownClose=await closed;
   row.group=child.pid?observeOwnedGroup(child.pid):{state:'unknown',error:{kind:'NO_PID'}};
   if(!knownClose||!row.exit||!row.close||row.group.state!=='absent'){halted=true;row.stop??='UNKNOWN_RETIREMENT';if(row.group.state==='present')row.signals.push({signal:'SIGKILL',...signalOwnedGroup(child.pid,'SIGKILL')});}
   if(row.signal!==null){halted=true;row.stop??='UNEXPECTED_SIGNAL';}
   row.finished=Date.now();
  }catch(error){halted=true;row.errors.push({phase:'launch-or-observe',name:error.name,code:error.code??null});row.stop??='LAUNCH_OR_OBSERVER_ERROR';if(child?.pid&&!row.close)row.signals.push({signal:'SIGKILL',...signalOwnedGroup(child.pid,'SIGKILL')});}
  finally{clearTimeout(termTimer);clearTimeout(killTimer);clearTimeout(finalTimer);clearInterval(poll);if(child&&!row.close){child.stdin.destroy();child.unref();}for(const descriptor of [stdout,stderr]){try{fs.fsyncSync(descriptor);}catch(error){halted=true;row.errors.push({phase:'fsync',name:error.name,code:error.code??null});}finally{fs.closeSync(descriptor);}}}
  record({event:'TARGET_TERMINAL_BEFORE_CAPTURE_AND_SNAPSHOT',row});
  for(const [name,filename] of [['stdout',stdoutPath],['stderr',stderrPath]]){const stat=fs.lstatSync(filename);row[name+'Bytes']=stat.size;if(stat.size>protocol.limits.perStreamBytes){halted=true;row.stop??='CAPTURE_OVERFLOW';row[name+'Capture']='OVERSIZE_RETAINED_NOT_READ';}else{const bytes=regular(filename,protocol.limits.perStreamBytes);captureBytes+=bytes.length;row[name+'Base64']=bytes.toString('base64');row[name+'Sha256']=hash(bytes);}}
  row.regularCaptureCompletion=row.exit&&row.close&&row.group.state==='absent'&&!row.stop;
  requireValue(captureBytes<=protocol.limits.totalCaptureBytes,'TOTAL_CAPTURE_CAP');
  if(row.regularCaptureCompletion){row.filesBefore=before;row.filesAfter=snapshot(caseRoot);const original=new Map(before.map(item=>[item.path,item]));for(const item of row.filesAfter){const previous=original.get(item.path);if(previous){requireValue(JSON.stringify(item)===JSON.stringify(previous),'UNEXPECTED_FIXTURE_MUTATION');original.delete(item.path);}else requireValue(['B23','B25'].includes(row.id)&&item.path==='work/out'&&item.type==='file'&&Buffer.from(item.base64,'base64').length<=2,'UNEXPECTED_FILE_EFFECT');}requireValue(original.size===0,'MISSING_FIXTURE');completed++;}
  observations.push(row);record({event:halted?'STOP':'OBSERVED',id:row.id,status:row.status,signal:row.signal,group:row.group,completed});fs.writeFileSync(path.join(runRoot,row.id+'.json'),JSON.stringify(row,null,2)+'\n',{flag:'wx',mode:0o600});
  if(halted)break;
 }
 record({event:'FINAL',completed,ownedStarts,reservedInternal,captureBytes,halted,notObserved:protocol.eligible.slice(ownedStarts),excluded:protocol.unqualified,groupCensus:'NOT_CLAIMED'});
 fs.writeFileSync(path.join(runRoot,'RESULTS.json'),JSON.stringify({profile:protocol.profile,completed,ownedStarts,reservedInternal,captureBytes,halted,observations},null,2)+'\n',{flag:'wx',mode:0o600});
 process.exitCode=halted?1:0;
}catch(error){record({event:'HOLD_OR_STOP',message:String(error),completed,ownedStarts,halted:true});process.exitCode=1;}
finally{fs.fsyncSync(journal);fs.closeSync(journal);}
