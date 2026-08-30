import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {acquireCapture} from './capture-v1.mjs';
const home=path.dirname(fileURLToPath(import.meta.url));
function read(file,cap){const stat=fs.lstatSync(file);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>cap)throw Error('launcher input');return fs.readFileSync(file);}
const control=JSON.parse(read(path.join(home,'CONTROL-v2.json'),65536));
const seal=JSON.parse(read(path.join(home,'PRESEAL-v2.json'),2097152));
const start=performance.now();const root=path.join(home,'validation-v2/outer');fs.mkdirSync(root,{recursive:false});
const opened=acquireCapture([path.join(root,'owner.stdout'),path.join(root,'owner.stderr')]);
if(!opened.ok)throw opened.primary.value;
const result={role:'node-module-external-owner-v1',started:new Date().toISOString(),pid:process.pid,ownerPid:null,spawned:false,closed:false,code:null,signal:null,bytes:0,fault:null,cleanup:[],elapsedMs:null};
let child;let deadline;let kill;let primary;let timedOut=false;
function describe(value){return {present:true,isUndefined:value===undefined};}
function terminate(){if(result.closed)return;timedOut=true;try{if(child?.pid)process.kill(-child.pid,'SIGTERM');}catch(value){primary??={present:true,value};}kill??=setTimeout(()=>{try{if(child?.pid)process.kill(-child.pid,'SIGKILL');}catch(value){primary??={present:true,value};}},2000);}
try{
 for(const row of seal.files){const body=read(path.join(home,row.path),4194304);if(body.length!==row.bytes||createHash('sha256').update(body).digest('hex')!==row.sha256)throw Error('launcher preseal mismatch');}
 const input=path.join(home,'owner-v2.mjs');const permissionArgs=['--experimental-permission','--allow-child-process',...control.readRoots.map(value=>'--allow-fs-read='+value),'--allow-fs-write='+path.join(home,'validation-v2')];
 await new Promise((resolve,reject)=>{
  deadline=setTimeout(terminate,Math.max(1,control.outerWallMs-(performance.now()-start)));
  try{child=spawn(process.execPath,[...permissionArgs,input],{cwd:home,env:control.environment,stdio:['ignore','pipe','pipe'],detached:true});}catch(value){reject(value);return;}
  child.once('error',value=>{primary??={present:true,value};});
  child.once('close',(code,signal)=>{clearTimeout(deadline);clearTimeout(kill);result.closed=true;result.code=code;result.signal=signal;resolve();});
  try{result.ownerPid=child.pid??null;result.spawned=child.pid!==undefined;for(const [index,stream]of [child.stdout,child.stderr].entries()){stream.on('error',value=>{primary??={present:true,value};terminate();});stream.on('data',bytes=>{try{result.bytes+=bytes.length;if(result.bytes>control.outerCaptureBytes)throw Error('outer capture ceiling');opened.write(index,bytes);}catch(value){primary??={present:true,value};terminate();}});}}catch(value){primary??={present:true,value};terminate();}
 });
}catch(value){primary??={present:true,value};}
finally{
 clearTimeout(deadline);clearTimeout(kill);result.cleanup=opened.close().map(item=>describe(item.value));result.fault=primary?describe(primary.value):null;result.timedOut=timedOut;result.elapsedMs=performance.now()-start;
 const file=path.join(root,'RECEIPT.json');fs.writeFileSync(file,JSON.stringify(result)+'\n',{flag:'wx',mode:0o600});process.stdout.write(JSON.stringify(result)+'\n');process.exitCode=result.closed&&!result.timedOut&&!primary&&!result.cleanup.length&&result.signal===null&&result.code===0?0:1;
}
