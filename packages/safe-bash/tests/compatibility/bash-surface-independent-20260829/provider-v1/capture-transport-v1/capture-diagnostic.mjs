import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
const directory=path.dirname(fileURLToPath(import.meta.url));
const root='/private/tmp/safe-bash-surface-provider-capture-diagnostic-v1';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const need=(value,message)=>{if(!value)throw Error(message);};
function writeAll(descriptor,bytes){let offset=0;while(offset<bytes.length){const count=fs.writeSync(descriptor,bytes,offset,bytes.length-offset);need(count>0,'SHORT_CAPTURE_WRITE');offset+=count;}}
need(process.argv.length===4&&process.argv[2]==='--seal-sha256','EXACT_ARGUMENTS');
need(Number.isSafeInteger(fs.constants.O_NOFOLLOW)&&fs.constants.O_NOFOLLOW>0,'NOFOLLOW_REQUIRED');
fs.mkdirSync(root,{mode:0o700});
need(fs.realpathSync(root)===root,'ROOT_ALIAS');
const rootStat=fs.lstatSync(root);need(rootStat.isDirectory()&&!rootStat.isSymbolicLink()&&(rootStat.mode&0o7777)===0o700&&rootStat.uid===process.getuid(),'OWNED_ROOT_IDENTITY');
const outer=fs.openSync(root+'/OUTER.jsonl',fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_NOFOLLOW,0o600);
const outputs=new Map();let captureBytes=0,failure,plan,receipt,seal,child,cohortDeadline;
const publish=row=>{const bytes=Buffer.from(JSON.stringify({at:Date.now(),...row})+'\n');need(captureBytes+bytes.length<=1048576,'TOTAL_CAPTURE_LIMIT');writeAll(outer,bytes);captureBytes+=bytes.length;};
function identity(descriptor,filename){const opened=fs.fstatSync(descriptor),linked=fs.lstatSync(filename);need(opened.isFile()&&linked.isFile()&&!linked.isSymbolicLink()&&opened.dev===linked.dev&&opened.ino===linked.ino&&opened.nlink===1&&linked.nlink===1&&(opened.mode&0o7777)===0o600,'OUTPUT_IDENTITY');return{path:filename,device:opened.dev,inode:opened.ino,mode:opened.mode&0o7777,links:opened.nlink,bytes:opened.size};}
function groupPresent(pid){try{process.kill(-pid,0);return true;}catch(error){if(error.code==='ESRCH')return false;throw error;}}
function snapshot(base){const rows=[];function walk(dir){for(const name of fs.readdirSync(dir).sort()){const filename=path.join(dir,name),stat=fs.lstatSync(filename);const relative=path.relative(base,filename);if(stat.isSymbolicLink())rows.push({path:relative,type:'symlink',target:fs.readlinkSync(filename)});else if(stat.isDirectory()){rows.push({path:relative,type:'directory',mode:stat.mode&0o7777});walk(filename);}else{need(stat.isFile()&&stat.size<=1048576,'SNAPSHOT_ADMISSION');rows.push({path:relative,type:'file',mode:stat.mode&0o7777,bytes:stat.size,sha256:hash(fs.readFileSync(filename))});}}}walk(base);return rows;}
async function launch(){
  const request=plan.request;
  const row={id:request.id,request,started:Date.now(),pid:null,spawnObserved:false,exitObserved:false,closeObserved:false,eventPipeEOF:false,stdinFinished:false,stdoutEOF:null,stderrEOF:null,outputKind:'REGULAR_FDS_NO_STREAM_EOF',status:null,signal:null,errors:[],signalsSent:[],groupPresent:null,regularFilesComplete:false};
  receipt=row;
  let finished=false,resolveFinish,activeTimer,termTimer,killTimer,sampler;
  const finish=new Promise(resolve=>{resolveFinish=resolve;});
  const send=signal=>{if(!child?.pid)return;row.signalsSent.push({signal,at:Date.now()});try{process.kill(-child.pid,signal);}catch(error){if(error.code!=='ESRCH')row.errors.push({phase:'signal',code:error.code});}};
  const stop=()=>{if(finished||termTimer||killTimer)return;send('SIGTERM');termTimer=setTimeout(()=>{send('SIGKILL');killTimer=setTimeout(()=>{if(!finished){row.errors.push({phase:'cleanup',code:'UNKNOWN_RETIREMENT'});finished=true;resolveFinish();}},plan.limits.killMs);},plan.limits.termMs);};
  const sample=()=>{try{for(const output of outputs.values()){const current=identity(output.descriptor,output.path);need(current.inode===output.initial.inode&&current.device===output.initial.device,'OUTPUT_REPLACED');need(current.bytes<=plan.limits.regularFileLogicalLimit,'REGULAR_FILE_LOGICAL_CAP');}}catch(error){row.errors.push({phase:'sample',message:String(error)});stop();}};
  try{
    const transfer=[{childFd:1,parentFd:outputs.get('stdout').descriptor,...outputs.get('stdout').initial},{childFd:2,parentFd:outputs.get('stderr').descriptor,...outputs.get('stderr').initial}];
    publish({event:'FD_TRANSFER_ENROLLED',request,transfer,stdin:'empty pipe',fd3:'unused event pipe'});
    need(Date.now()+plan.limits.activeMs+2*(plan.limits.termMs+plan.limits.killMs)<cohortDeadline,'CLEANUP_WINDOW');
    child=spawn(request.executable,request.args,{cwd:request.cwd,env:request.env,shell:false,detached:true,stdio:['pipe',outputs.get('stdout').descriptor,outputs.get('stderr').descriptor,'pipe']});row.pid=child.pid??null;
    child.on('spawn',()=>{row.spawnObserved=true;try{publish({event:'TARGET_SPAWN',id:row.id,pid:child.pid});}catch(error){row.errors.push({phase:'capture',message:String(error)});stop();}});
    child.on('error',error=>row.errors.push({phase:'spawn',code:error.code,message:error.message}));
    child.on('exit',(status,signal)=>{row.exitObserved=true;row.status=status;row.signal=signal;try{publish({event:'TARGET_EXIT',status,signal});}catch(error){row.errors.push({phase:'capture',message:String(error)});}});
    child.once('close',(status,signal)=>{row.closeObserved=true;row.status=status;row.signal=signal;if(!finished){finished=true;resolveFinish();}});
    child.stdin.once('finish',()=>{row.stdinFinished=true;});child.stdin.on('error',error=>{if(error.code!=='EPIPE'){row.errors.push({phase:'stdin',code:error.code});stop();}});
    child.stdio[3].once('end',()=>{row.eventPipeEOF=true;});child.stdio[3].on('error',error=>{row.errors.push({phase:'event-pipe',message:String(error)});stop();});
    child.stdio[3].on('data',bytes=>{row.errors.push({phase:'event-pipe',code:'UNEXPECTED_BYTES',base64:bytes.subarray(0,4096).toString('base64')});stop();});
    activeTimer=setTimeout(()=>{row.errors.push({phase:'active',code:'DEADLINE'});stop();},plan.limits.activeMs);
    sampler=setInterval(sample,plan.limits.regularFileSampleMs);child.stdin.end();await finish;
    row.groupPresent=row.pid?groupPresent(row.pid):null;
    if(row.groupPresent){row.errors.push({phase:'group',code:'UNKNOWN_DESCENDANT'});send('SIGTERM');await new Promise(resolve=>setTimeout(resolve,plan.limits.termMs));if(groupPresent(row.pid)){send('SIGKILL');await new Promise(resolve=>setTimeout(resolve,plan.limits.killMs));}row.groupPresent=groupPresent(row.pid);}
    row.knownRetired=row.exitObserved&&row.closeObserved&&row.eventPipeEOF&&row.groupPresent===false;
    sample();
    for(const[name,output]of outputs){
      const final=identity(output.descriptor,output.path);need(final.bytes<=plan.limits.regularFileLogicalLimit&&captureBytes+final.bytes<=plan.limits.totalCaptureBytes,'READBACK_CAPTURE_LIMIT');
      fs.fsyncSync(output.descriptor);const bytes=Buffer.alloc(final.bytes);let offset=0;while(offset<bytes.length){const count=fs.readSync(output.descriptor,bytes,offset,bytes.length-offset,offset);need(count>0,'READBACK_SHORT');offset+=count;}
      const after=identity(output.descriptor,output.path);need(after.inode===final.inode&&after.device===final.device&&after.bytes===final.bytes,'READBACK_IDENTITY_OR_SIZE_DRIFT');captureBytes+=bytes.length;
      row[name]={initial:output.initial,final:after,bytes:bytes.length,sha256:hash(bytes),base64:bytes.toString('base64'),completion:'OWNER_FD_READBACK_AFTER_CHILD_EXIT_CLOSE_NOT_STREAM_EOF'};
    }
    row.regularFilesComplete=row.knownRetired&&row.errors.length===0;
    row.expectedReadiness=row.status===request.expected.status&&row.signal===request.expected.signal&&row.stdout.base64===request.expected.stdoutBase64&&row.stderr.base64===request.expected.stderrBase64;
    row.finished=Date.now();return row;
  }finally{clearTimeout(activeTimer);clearTimeout(termTimer);clearTimeout(killTimer);clearInterval(sampler);}
}
try{
  publish({event:'OWNER_CAPTURE_STARTED',role:'SOLE_CAPTURE_TRANSPORT_DIAGNOSTIC'});
  for(const name of['stdout','stderr']){
    const filename=root+'/'+name;const descriptor=fs.openSync(filename,fs.constants.O_RDWR|fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_NOFOLLOW,0o600);
    const output={path:filename,descriptor};outputs.set(name,output);output.initial=identity(descriptor,filename);need(output.initial.bytes===0,'FRESH_EMPTY_OUTPUT');
  }
  publish({event:'REGULAR_OUTPUTS_PREOPENED',files:[...outputs.values()].map(output=>({fd:output.descriptor,...output.initial}))});
  const sealBytes=fs.readFileSync(directory+'/PRESEAL.json');need(hash(sealBytes)===process.argv[3],'SEAL_DRIFT');seal=JSON.parse(sealBytes);
  for(const file of seal.files){const filename=path.join(directory,file.path),stat=fs.lstatSync(filename);need(stat.isFile()&&!stat.isSymbolicLink()&&stat.size===file.bytes&&hash(fs.readFileSync(filename))===file.sha256,'SOURCE_DRIFT:'+file.path);}
  plan=JSON.parse(fs.readFileSync(directory+'/PLAN.json'));need(plan.root===root&&Date.now()<plan.phaseDeadline,'ROOT_OR_DEADLINE');
  cohortDeadline=Math.min(plan.phaseDeadline,Date.now()+plan.limits.cohortMs);
  const original=fs.readFileSync(plan.originalProfile.path);need(hash(original)===plan.originalProfile.sha256,'ORIGINAL_PROFILE_DRIFT');
  const profile=fs.readFileSync(directory+'/PROFILE.sb.data');need(hash(profile)===plan.profile.sha256&&profile.length===plan.profile.bytes,'PROFILE_DRIFT');
  need(profile.equals(Buffer.concat([original,Buffer.from(plan.profile.delta)])),'ONLY_APPROVED_PROFILE_DELTA');
  need(JSON.stringify(snapshot(seal.originalRoot))===JSON.stringify(seal.originalSnapshot),'HISTORICAL_NAMESPACE_DRIFT');
  for(const tool of plan.tools){const stat=fs.lstatSync(tool.path);need(stat.isFile()&&!stat.isSymbolicLink()&&stat.size===tool.bytes&&(stat.mode&0o7777)===tool.mode,'TOOL_METADATA_DRIFT');const digest=createHash('sha256');for await(const bytes of fs.createReadStream(tool.path,{highWaterMark:65536}))digest.update(bytes);need(digest.digest('hex')===tool.sha256,'TOOL_HASH_DRIFT');}
  fs.writeFileSync(plan.profile.path,profile,{flag:'wx',mode:0o400});process.umask(0o22);
  await launch();
  need(hash(fs.readFileSync(plan.profile.path))===plan.profile.sha256&&hash(fs.readFileSync(plan.originalProfile.path))===plan.originalProfile.sha256,'POST_PROFILE_DRIFT');
  need(JSON.stringify(snapshot(seal.originalRoot))===JSON.stringify(seal.originalSnapshot),'POST_HISTORICAL_NAMESPACE_DRIFT');
  if(!receipt.knownRetired||receipt.errors.length||!receipt.expectedReadiness)failure='SOLE_DIAGNOSTIC_STOP_OR_FAILURE';
}catch(error){failure=String(error);}
finally{
  let closed=true;
  for(const output of outputs.values())try{fs.closeSync(output.descriptor);}catch(error){closed=false;failure??=String(error);}
  if(receipt)receipt.ownerOutputDescriptorsClosed=closed;
  try{publish({event:'FINAL_RECEIPT',receipt:receipt??null,failure:failure??null});}finally{fs.closeSync(outer);}
}
const result={role:'NEW_D03_NOT_F01_OR_D02_RESCORE',receipt:receipt??null,failure:failure??null,captureBytes,soleTargetAttempted:child?1:0,retries:0,nativeBash:0,product:0,networkAPIProbe:0,qualification:'Regular FD completion, NOT streamed stdout/stderr EOF; no kernel-wide descendant or RSS claim.'};
fs.writeFileSync(root+'/RESULTS.json',JSON.stringify(result,null,2)+'\n',{flag:'wx',mode:0o600});
console.log(JSON.stringify({attempted:result.soleTargetAttempted,pid:receipt?.pid,status:receipt?.status,signal:receipt?.signal,stdoutBytes:receipt?.stdout?.bytes,stderrBytes:receipt?.stderr?.bytes,expectedReadiness:receipt?.expectedReadiness,knownRetired:receipt?.knownRetired,regularFilesComplete:receipt?.regularFilesComplete,ownerOutputDescriptorsClosed:receipt?.ownerOutputDescriptorsClosed,failure:result.failure,captureBytes}));
if(failure)process.exitCode=1;
