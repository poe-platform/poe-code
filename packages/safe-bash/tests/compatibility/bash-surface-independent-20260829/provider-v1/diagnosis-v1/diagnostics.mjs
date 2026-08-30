import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
const directory = path.dirname(fileURLToPath(import.meta.url));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const need = (value,message) => { if(!value)throw Error(message); };
const writeAll = (descriptor,bytes) => { let offset=0;while(offset<bytes.length){const count=fs.writeSync(descriptor,bytes,offset,bytes.length-offset);need(count>0,'SHORT_WRITE');offset+=count;} };
need(process.argv.length===4&&process.argv[2]==='--seal-sha256','EXACT_ARGUMENTS');
const root='/private/tmp/safe-bash-surface-provider-diagnosis-v1';
fs.mkdirSync(root,{mode:0o700});
const outer=fs.openSync(root+'/OUTER.jsonl','wx',0o600);
let totalBytes=0;
const publish=row=>{const bytes=Buffer.from(JSON.stringify({at:Date.now(),...row})+'\n');need(totalBytes+bytes.length<=1048576,'TOTAL_CAPTURE_LIMIT');writeAll(outer,bytes);totalBytes+=bytes.length;};
const observations=[];let failure,plan;
function groupPresent(pid){try{process.kill(-pid,0);return true;}catch(error){if(error.code==='ESRCH')return false;throw error;}}
function snapshot(base){const rows=[];function walk(dir){for(const name of fs.readdirSync(dir).sort()){const filename=path.join(dir,name),stat=fs.lstatSync(filename);const relative=path.relative(base,filename);if(stat.isSymbolicLink())rows.push({path:relative,type:'symlink',target:fs.readlinkSync(filename)});else if(stat.isDirectory()){rows.push({path:relative,type:'directory',mode:stat.mode&0o7777});walk(filename);}else{need(stat.isFile()&&stat.size<=1048576,'SNAPSHOT_ADMISSION');rows.push({path:relative,type:'file',mode:stat.mode&0o7777,bytes:stat.size,sha256:hash(fs.readFileSync(filename))});}}}walk(base);return rows;}
async function launch(request,deadline){
  const row={id:request.id,request,started:Date.now(),pid:null,spawnObserved:false,exitObserved:false,closeObserved:false,stdoutEOF:false,stderrEOF:false,eventEOF:false,status:null,signal:null,signalsSent:[],errors:[],captureComplete:true,groupPresent:null};
  const descriptors=new Map(),buffers={stdout:[],stderr:[],events:[]},sizes={stdout:0,stderr:0,events:0};
  let child,finished=false,activeTimer,termTimer,killTimer;
  let finish;const completion=new Promise(resolve=>{finish=resolve;});
  const signal=name=>{if(!child?.pid)return;row.signalsSent.push({name,at:Date.now()});try{process.kill(-child.pid,name);}catch(error){if(error.code!=='ESRCH')row.errors.push({phase:'signal',code:error.code});}};
  const stop=()=>{if(finished||termTimer||killTimer)return;signal('SIGTERM');termTimer=setTimeout(()=>{signal('SIGKILL');killTimer=setTimeout(()=>{if(!finished){row.errors.push({phase:'cleanup',code:'UNKNOWN_RETIREMENT'});finished=true;finish();}},plan.limits.killMs);},plan.limits.termMs);};
  const consume=name=>bytes=>{try{need(sizes[name]+bytes.length<=plan.limits.perStreamBytes&&totalBytes+bytes.length<=plan.limits.totalCaptureBytes,'CAPTURE_LIMIT');writeAll(descriptors.get(name),bytes);sizes[name]+=bytes.length;totalBytes+=bytes.length;buffers[name].push(Buffer.from(bytes));}catch(error){row.captureComplete=false;row.errors.push({phase:'capture',message:String(error)});stop();}};
  try{
    for(const name of ['stdout','stderr','events'])descriptors.set(name,fs.openSync(root+'/'+request.id+'.'+name,'wx',0o600));
    publish({event:'TARGET_ENROLLED',request});
    need(Date.now()+plan.limits.activeMs+plan.limits.termMs+plan.limits.killMs<deadline,'CLEANUP_WINDOW');
    child=spawn(request.executable,request.args,{cwd:request.cwd,env:request.env,shell:false,detached:true,stdio:['pipe','pipe','pipe','pipe']});row.pid=child.pid??null;
    child.on('spawn',()=>{row.spawnObserved=true;try{publish({event:'TARGET_SPAWN',id:request.id,pid:child.pid});}catch(error){row.captureComplete=false;row.errors.push({phase:'journal',message:String(error)});stop();}});
    child.on('error',error=>row.errors.push({phase:'spawn',code:error.code,message:error.message}));
    child.on('exit',(status,received)=>{row.exitObserved=true;row.status=status;row.signal=received;try{publish({event:'TARGET_EXIT',id:request.id,status,signal:received});}catch(error){row.captureComplete=false;row.errors.push({phase:'journal',message:String(error)});}});
    child.stdout.on('data',consume('stdout'));child.stderr.on('data',consume('stderr'));child.stdio[3].on('data',consume('events'));
    child.stdout.once('end',()=>{row.stdoutEOF=true;});child.stderr.once('end',()=>{row.stderrEOF=true;});child.stdio[3].once('end',()=>{row.eventEOF=true;});
    for(const stream of[child.stdout,child.stderr,child.stdio[3]])stream.on('error',error=>{row.captureComplete=false;row.errors.push({phase:'stream',message:String(error)});stop();});
    child.stdin.on('error',error=>{if(error.code!=='EPIPE'){row.errors.push({phase:'stdin',code:error.code});stop();}});
    child.once('close',(status,received)=>{row.closeObserved=true;row.status=status;row.signal=received;if(!finished){finished=true;finish();}});
    activeTimer=setTimeout(()=>{row.errors.push({phase:'active',code:'DEADLINE'});stop();},plan.limits.activeMs);
    child.stdin.end();await completion;
    row.groupPresent=row.pid?groupPresent(row.pid):null;
    if(row.groupPresent){row.errors.push({phase:'group',code:'UNKNOWN_DESCENDANT'});signal('SIGTERM');await new Promise(resolve=>setTimeout(resolve,plan.limits.termMs));if(groupPresent(row.pid)){signal('SIGKILL');await new Promise(resolve=>setTimeout(resolve,plan.limits.killMs));}row.groupPresent=groupPresent(row.pid);}
    row.stdoutBase64=Buffer.concat(buffers.stdout).toString('base64');row.stderrBase64=Buffer.concat(buffers.stderr).toString('base64');row.eventsBase64=Buffer.concat(buffers.events).toString('base64');row.bytes=sizes;
    row.knownRetired=row.exitObserved&&row.closeObserved&&row.stdoutEOF&&row.stderrEOF&&row.eventEOF&&row.groupPresent===false;
    row.expectedReadiness=row.status===request.expected.status&&row.signal===request.expected.signal&&row.stdoutBase64===request.expected.stdoutBase64&&row.stderrBase64===request.expected.stderrBase64;
    row.stop=!row.knownRetired||!row.captureComplete||row.errors.length>0||!row.expectedReadiness;
    row.finished=Date.now();return row;
  }finally{clearTimeout(activeTimer);clearTimeout(termTimer);clearTimeout(killTimer);for(const descriptor of descriptors.values())fs.closeSync(descriptor);row.captureDescriptorsClosed=true;}
}
try{
  publish({event:'OWNER_CAPTURE_STARTED',role:'DIAGNOSIS_ONLY_NO_NATIVE_OR_PRODUCT'});
  const sealRaw=fs.readFileSync(directory+'/PRESEAL.json');need(hash(sealRaw)===process.argv[3],'SEAL_DRIFT');const seal=JSON.parse(sealRaw);
  for(const file of seal.files){const filename=path.join(directory,file.path),stat=fs.lstatSync(filename);need(stat.isFile()&&!stat.isSymbolicLink()&&stat.size===file.bytes&&hash(fs.readFileSync(filename))===file.sha256,'SOURCE_DRIFT:'+file.path);}
  plan=JSON.parse(fs.readFileSync(directory+'/PLAN.json'));need(plan.root===root&&Date.now()<plan.phaseDeadline,'ROOT_OR_DEADLINE');
  for(const tool of plan.tools){const stat=fs.lstatSync(tool.path);need(stat.isFile()&&!stat.isSymbolicLink()&&stat.size===tool.bytes&&(stat.mode&0o7777)===tool.mode,'TOOL_METADATA');const digest=createHash('sha256');for await(const chunk of fs.createReadStream(tool.path,{highWaterMark:65536}))digest.update(chunk);need(digest.digest('hex')===tool.sha256,'TOOL_HASH');}
  need(hash(fs.readFileSync(plan.originalProfile.path))===plan.originalProfile.sha256,'ORIGINAL_PROFILE_HASH');
  need(JSON.stringify(snapshot(seal.originalRoot))===JSON.stringify(seal.originalSnapshot),'ORIGINAL_NAMESPACE_DRIFT');
  process.umask(0o22);const deadline=Math.min(plan.phaseDeadline,Date.now()+plan.limits.cohortMs);
  for(const request of plan.rows){
    const observation=await launch(request,deadline);observations.push(observation);publish({event:'DIAGNOSTIC_RESULT',observation});
    need(hash(fs.readFileSync(plan.originalProfile.path))===plan.originalProfile.sha256,'POST_PROFILE_DRIFT');
    need(JSON.stringify(snapshot(seal.originalRoot))===JSON.stringify(seal.originalSnapshot),'POST_NAMESPACE_DRIFT');
    if(observation.stop){failure='STOP_AFTER_'+request.id;break;}
  }
}catch(error){failure=String(error);publish({event:'HOLD_OR_STOP',message:failure});}
finally{fs.closeSync(outer);}
const result={role:'TWO_NEW_DIAGNOSTIC_IDENTITIES_NOT_F01_RESCORE',observations,failure,unrun:(plan?.rows??[]).filter(row=>!observations.some(item=>item.id===row.id)).map(row=>row.id),captureBytes:totalBytes,noNativeBash:true,noProduct:true,noNetworkCalls:true};
fs.writeFileSync(root+'/RESULTS.json',JSON.stringify(result,null,2)+'\n',{flag:'wx',mode:0o600});console.log(JSON.stringify({attempted:observations.length,ready:observations.filter(row=>row.expectedReadiness).length,failure,unrun:result.unrun,rows:observations.map(row=>({id:row.id,pid:row.pid,status:row.status,signal:row.signal,knownRetired:row.knownRetired,bytes:row.bytes})),captureBytes:totalBytes}));if(failure)process.exitCode=1;
