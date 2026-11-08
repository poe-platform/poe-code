import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
const home=path.dirname(fileURLToPath(import.meta.url));
const capsule=path.join(home,'capsule-v2');const out=path.join(capsule,'outer');
if(process.argv.length!==3||process.argv[2]!=='ACTIVATE-COMMITTED-a2f3983')throw Error('no actual activation token');
for(let current=home;current!=='/';current=path.dirname(current))if(fs.lstatSync(current).isSymbolicLink())throw Error('symlink scope');
fs.mkdirSync(out);const stdout=fs.openSync(path.join(out,'owner.stdout'),'wx');let stderr;
try{stderr=fs.openSync(path.join(out,'owner.stderr'),'wx');}catch(error){fs.closeSync(stdout);throw error;}
const state={role:'independent-outer-owner',start:new Date().toISOString(),spawned:false,closed:false,pid:null,status:null,signal:null,timeout:false,captureBytes:0,captureFault:null,ownerSummary:null,cleanup:false};
let child,timer,kill;
function sha(bytes){return createHash('sha256').update(bytes).digest('hex');}
function bounded(file,max){const stat=fs.lstatSync(file);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>max)throw Error('regular bounded input');return fs.readFileSync(file);}
function nodeHash(file){const stat=fs.lstatSync(file);if(!stat.isFile()||stat.size>120000000)throw Error('Node identity input');const fd=fs.openSync(file,'r'),hash=createHash('sha256'),buffer=Buffer.alloc(65536);let bytes=0;try{for(;;){const count=fs.readSync(fd,buffer,0,buffer.length,null);if(!count)break;bytes+=count;hash.update(buffer.subarray(0,count));}}finally{fs.closeSync(fd);}if(bytes!==stat.size)throw Error('Node changing input');return hash.digest('hex');}
try{
 const grant=JSON.parse(bounded(path.join(home,'ACTUAL-PRESEAL.json'),1048576));
 for(const item of grant.inputs){const bytes=bounded(path.join(home,item.path),4194304);if(bytes.length!==item.bytes||sha(bytes)!==item.sha256)throw Error('executable seal drift '+item.path);}
 const seal=JSON.parse(bounded(path.join(capsule,'PRESEAL-v5.json'),1048576));if(nodeHash(process.execPath)!==seal.nodeSha256)throw Error('Node binary mismatch');
 const config=JSON.parse(bounded(path.join(capsule,'CONTROL-v5.json'),65536));
 fs.mkdirSync(path.join(capsule,'validation-v2'),{recursive:true});
 const env={PATH:path.dirname(process.execPath),HOME:path.join(capsule,'validation-v2/home'),TMPDIR:path.join(capsule,'validation-v2/tmp'),TZ:'UTC',LANG:'C.UTF-8',NO_COLOR:'1'};
 const args=['--experimental-permission',...config.readRoots.map(root=>'--allow-fs-read='+root),'--allow-fs-write='+capsule,'--allow-child-process',path.join(capsule,'owner-v5.mjs')];
 state.args=args;
 await new Promise((resolve,reject)=>{
  try{child=spawn(process.execPath,args,{cwd:home,env,detached:true,stdio:['ignore','pipe','pipe']});}catch(error){reject(error);return;}
  child.once('spawn',()=>{state.spawned=true;state.pid=child.pid;});
  const stop=()=>{try{process.kill(-child.pid,'SIGTERM');}catch{}kill=setTimeout(()=>{try{process.kill(-child.pid,'SIGKILL');}catch{}},500);};
  child.once('error',error=>{state.captureFault=String(error);});
  for(const [stream,fd]of [[child.stdout,stdout],[child.stderr,stderr]]){stream.on('error',error=>{state.captureFault=String(error);stop();});stream.on('data',bytes=>{try{state.captureBytes+=bytes.length;if(state.captureBytes>4194304)throw Error('outer capture limit');let offset=0;while(offset<bytes.length){const written=fs.writeSync(fd,bytes,offset,bytes.length-offset);if(written<=0)throw Error('short capture');offset+=written;}}catch(error){state.captureFault=String(error);stop();}});}
  timer=setTimeout(()=>{state.timeout=true;stop();},config.outerWallMs);
  child.once('close',(code,signal)=>{clearTimeout(timer);clearTimeout(kill);state.closed=true;state.status=code;state.signal=signal;resolve();});
 });
 if(state.timeout||state.captureFault||!state.closed||state.signal)throw Error('unsafe outer retirement/capture');
 const summaryPath=path.join(capsule,'validation-v2/evidence/r1-SUMMARY.json');state.ownerSummary=JSON.parse(bounded(summaryPath,1048576));state.cleanup=state.ownerSummary.cleanup===true;
}catch(error){state.failure={name:error?.name??null,message:typeof error?.message==='string'?error.message:null};}
finally{clearTimeout(timer);clearTimeout(kill);fs.closeSync(stdout);fs.closeSync(stderr);state.end=new Date().toISOString();fs.writeFileSync(path.join(out,'RECEIPT.json'),JSON.stringify(state,null,2)+'\n',{flag:'wx'});}
console.log(JSON.stringify({closed:state.closed,status:state.status,unsafe:state.timeout||Boolean(state.captureFault)||state.signal!==null,cleanup:state.cleanup,summary:state.ownerSummary,failure:state.failure??null}));
process.exitCode=state.closed&&state.status===0&&state.cleanup&&!state.captureFault&&!state.timeout?0:1;
