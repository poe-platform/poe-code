import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {gzipSync,gunzipSync} from 'node:zlib';
import {spawn} from 'node:child_process';
const home=path.dirname(fileURLToPath(import.meta.url));
if(process.argv.length!==3||process.argv[2]!=='ACTIVATE-COMMITTED-a6d20781')throw Error('actual activation token');
const run=path.join(home,'actual-v1');fs.mkdirSync(run);
const stdout=fs.openSync(path.join(run,'stdout.raw'),'wx',0o600);let stderr;
try{stderr=fs.openSync(path.join(run,'stderr.raw'),'wx',0o600);}catch(error){fs.closeSync(stdout);throw error;}
const state={role:'independent-public-node-outer',start:new Date().toISOString(),spawned:false,closed:false,code:null,signal:null,signals:[],captureBytes:0,captureFailure:null,output:null,owner:null,cleanup:false,unsafe:false};
let child,timer,kill;
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
function bounded(file,max){const stat=fs.lstatSync(file);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>max)throw Error('bounded regular input '+file);return fs.readFileSync(file);}
function write(file,bytes){fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,bytes,{flag:'wx',mode:0o600});}
function hashFile(file,max){const stat=fs.lstatSync(file);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>max)throw Error('binary binding');const descriptor=fs.openSync(file,'r'),hash=createHash('sha256'),buffer=Buffer.alloc(65536);let total=0;try{for(;;){const count=fs.readSync(descriptor,buffer,0,buffer.length,null);if(!count)break;total+=count;hash.update(buffer.subarray(0,count));}}finally{fs.closeSync(descriptor);}if(total!==stat.size)throw Error('changing binary');return hash.digest('hex');}
try{
 for(let name=home;name!=='/';name=path.dirname(name))if(fs.lstatSync(name).isSymbolicLink())throw Error('scope symlink');
 const seal=JSON.parse(bounded(path.join(home,'ACTUAL-PRESEAL.json'),1048576));
 for(const row of seal.inputs){const bytes=bounded(path.join(home,row.path),16777216);if(bytes.length!==row.bytes||sha(bytes)!==row.sha256)throw Error('executable binding '+row.path);}
 if(process.execPath!==seal.node.path||hashFile(process.execPath,120000000)!==seal.node.sha256)throw Error('Node binding');
 const recipe=JSON.parse(gunzipSync(Buffer.from(bounded(path.join(home,'RECIPE-v2.json.gz.base64'),16777216).toString().trim(),'base64'),{maxOutputLength:33554432}));
 const mirror=path.join(run,'mirror');const names=new Set();
 for(const row of recipe){if(typeof row.path!=='string'||row.path.startsWith('/')||row.path.includes('\\')||row.path.split('/').some(part=>!part||part==='..'||part==='.'||part==='AGENTS.md')||names.has(row.path))throw Error('recipe path');names.add(row.path);const bytes=Buffer.from(row.body,'base64');if(bytes.length!==row.bytes||sha(bytes)!==row.sha256)throw Error('recipe bytes');write(path.join(mirror,row.path),bytes);}
 for(const name of ['tmp','home'])fs.mkdirSync(path.join(run,name));
 const own=path.join(mirror,'tests/integration/node-public-author-20260829');
 const tools=JSON.parse(bounded(path.join(own,'TOOLS.json'),1048576));const toolRoots=Object.values(tools.tools).map(tool=>tool.origin);
 const args=['--experimental-permission','--allow-fs-read='+run,...toolRoots.map(root=>'--allow-fs-read='+root),'--allow-fs-read='+process.execPath,'--allow-fs-write='+run,'--allow-child-process',path.join(own,'run-v3.mjs'),'--run'];
 state.args=args;
 await new Promise((resolve,reject)=>{
  try{child=spawn(process.execPath,args,{cwd:mirror,env:{PATH:path.dirname(process.execPath),HOME:path.join(run,'home'),TMPDIR:path.join(run,'tmp'),TZ:'UTC',LANG:'C.UTF-8',NO_COLOR:'1'},detached:true,stdio:['ignore','pipe','pipe']});}catch(error){reject(error);return;}
  child.once('spawn',()=>{state.spawned=true;state.pid=child.pid;});
  const stop=()=>{state.unsafe=true;state.signals.push('SIGTERM');try{process.kill(-child.pid,'SIGTERM');}catch{}kill=setTimeout(()=>{state.signals.push('SIGKILL');try{process.kill(-child.pid,'SIGKILL');}catch{}},1000);};
  child.once('error',error=>{state.captureFailure=error.message;state.unsafe=true;});
  for(const [stream,descriptor]of [[child.stdout,stdout],[child.stderr,stderr]]){stream.on('error',error=>{state.captureFailure=error.message;stop();});stream.on('data',bytes=>{try{state.captureBytes+=bytes.length;if(state.captureBytes>4194304)throw Error('outer capture cap');let offset=0;while(offset<bytes.length){const count=fs.writeSync(descriptor,bytes,offset,bytes.length-offset);if(count<=0)throw Error('outer short capture');offset+=count;}}catch(error){state.captureFailure=error.message;stop();}});}
  timer=setTimeout(stop,3600000);child.once('close',(code,signal)=>{clearTimeout(timer);clearTimeout(kill);state.closed=true;state.code=code;state.signal=signal;resolve();});
 });
 if(!state.closed||state.signal||state.captureFailure||state.signals.length)throw Error('unsafe outer retirement');
 const roots=fs.readdirSync(path.join(run,'tmp')).filter(name=>name.startsWith('node-public-independent-'));if(roots.length!==1)throw Error('owner output namespace');
 const output=path.join(run,'tmp',roots[0]);state.output=output;const receipt=JSON.parse(bounded(path.join(output,'RESULT.json'),33554432));state.owner={status:receipt.status,failures:receipt.failures,cleanup:receipt.cleanup,package:receipt.package,captureBytes:receipt.captureBytes,scratchWriteBytes:receipt.scratchWriteBytes,actualScratchBytes:receipt.actualScratchBytes};
 if(!receipt.cleanup?.allClosed||receipt.cleanup.signals.length||receipt.children.some(row=>row.alarm||row.captureErrorPresent||row.resourceClosureUnknown||row.spawnErrorPresent||!row.closed))throw Error('owner safety/capture/retirement STOP');
 const evidence=[];let evidenceBytes=0;for(const name of fs.readdirSync(output)){const file=path.join(output,name),stat=fs.lstatSync(file);if(stat.isSymbolicLink())throw Error('output symlink');if(!stat.isFile())continue;if(stat.size>33554432)throw Error('evidence file cap');const bytes=bounded(file,33554432);evidenceBytes+=bytes.length;if(evidenceBytes>134217728)throw Error('evidence total cap');evidence.push({path:name,bytes:bytes.length,sha256:sha(bytes),body:bytes.toString('base64')});}
 const archived=gzipSync(Buffer.from(JSON.stringify(evidence)));write(path.join(run,'EVIDENCE.json.gz.base64'),archived.toString('base64')+'\n');state.evidence={files:evidence.length,bytes:evidenceBytes,gzipBytes:archived.length,sha256:sha(archived)};
 write(path.join(run,'RESULT.json'),JSON.stringify(receipt,null,2)+'\n');
 for(const row of recipe){const bytes=bounded(path.join(mirror,row.path),16777216);if(bytes.length!==row.bytes||sha(bytes)!==row.sha256)throw Error('recipe postguard');}
 fs.rmSync(path.join(run,'tmp'),{recursive:true});fs.rmSync(mirror,{recursive:true});fs.rmSync(path.join(run,'home'),{recursive:true});state.cleanup=true;
}catch(error){state.error={name:error?.name??null,message:typeof error?.message==='string'?error.message:'unknown'};if(/safety|capture|integrity|retirement|symlink|binding|cap|postguard/u.test(state.error.message))state.unsafe=true;}
finally{clearTimeout(timer);clearTimeout(kill);fs.closeSync(stdout);fs.closeSync(stderr);state.end=new Date().toISOString();write(path.join(run,'TERMINAL.json'),JSON.stringify(state,null,2)+'\n');}
console.log(JSON.stringify({closed:state.closed,code:state.code,unsafe:state.unsafe,cleanup:state.cleanup,error:state.error??null,status:state.owner?.status,failures:state.owner?.failures.length,resources:state.owner?.cleanup,packageSha256:state.owner?.package?.sha256}));
process.exitCode=state.cleanup&&!state.unsafe&&state.owner?.status==='AUTHOR_SCOPED_PASS'?0:1;
