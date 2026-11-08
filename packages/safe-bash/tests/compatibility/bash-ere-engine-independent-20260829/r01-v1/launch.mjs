import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawn,spawnSync} from 'node:child_process';
const own=path.dirname(new URL(import.meta.url).pathname),repo=path.resolve(own,'../../../..');
const commit=process.argv[2];
if(!/^[a-f0-9]{40}$/.test(commit??''))throw new Error('explicit preseal commit required');
const opened=Date.now(),fullDeadline=opened+35*60000,output=path.join(own,'ACTUAL-LAUNCH');fs.mkdirSync(output);
const events=fs.openSync(path.join(output,'events.jsonl'),'wx',0o600);
const emit=value=>{if(Date.now()>fullDeadline)throw new Error('inclusive publication deadline');fs.writeSync(events,JSON.stringify({at:new Date().toISOString(),...value})+'\n');fs.fsyncSync(events);};
const digest=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
function bounded(file,max=1048576){const stat=fs.lstatSync(file);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>max)throw new Error('launch regular size');return fs.readFileSync(file);}
let childProcess,retired=false;
try{
 emit({event:'start',pid:process.pid,commit,opened,fullDeadline,role:'independent-outer-admission'});
 const gitOut=fs.openSync(path.join(output,'preseal.stdout'),'wx',0o600),gitErr=fs.openSync(path.join(output,'preseal.stderr'),'wx',0o600);let git;
 try{git=spawnSync('/usr/bin/git',['-c','core.fsmonitor=false','cat-file','blob',`${commit}:tests/compatibility/bash-ere-engine-independent-20260829/r01-v1/FINAL-PRESEAL.json`],{cwd:repo,stdio:['ignore',gitOut,gitErr],timeout:10000});}finally{fs.closeSync(gitOut);fs.closeSync(gitErr);}
 emit({event:'metadata-retired',pid:git.pid,status:git.status,signal:git.signal});if(git.status!==0||git.signal||git.error)throw new Error('preseal stored blob');
 const authority=bounded(path.join(output,'preseal.stdout')),actual=bounded(path.join(own,'FINAL-PRESEAL.json'));if(!authority.equals(actual))throw new Error('committed preseal mismatch');const preseal=JSON.parse(authority.toString('utf8'));
 for(const row of [preseal.runner,preseal.seal,preseal.novel]){const bytes=bounded(row.path);if(bytes.length!==row.size||digest(bytes)!==row.sha256||(fs.lstatSync(row.path).mode&511)!==row.mode)throw new Error('launch executable or fixture identity');}
 if(process.execPath!==preseal.node.path)throw new Error('launch Node path');
 const digestNode=crypto.createHash('sha256'),descriptor=fs.openSync(process.execPath,'r'),buffer=Buffer.alloc(65536);let nodeSize=0;
 try{let length;while((length=fs.readSync(descriptor,buffer,0,buffer.length,null))){nodeSize+=length;digestNode.update(buffer.subarray(0,length));if(nodeSize>134217728)throw new Error('Node size');}}finally{fs.closeSync(descriptor);}
 if(nodeSize!==preseal.node.size||digestNode.digest('hex')!==preseal.node.sha256)throw new Error('Node hash');
 const stdout=fs.openSync(path.join(output,'coordinator.stdout'),'wx',0o600),stderr=fs.openSync(path.join(output,'coordinator.stderr'),'wx',0o600);let forced=false;let failure;
 childProcess=spawn(process.execPath,preseal.argv,{cwd:preseal.launchCwd,env:{PATH:'/usr/bin:/bin',LANG:'C',LC_ALL:'C',HOME:output,TMPDIR:output},stdio:['ignore',stdout,stderr]});
 const close=new Promise(resolve=>{childProcess.once('error',error=>{failure=error;});childProcess.once('close',(code,signal)=>{retired=true;resolve({code,signal});});});
 const timeout=setTimeout(()=>{forced=true;childProcess.kill('SIGKILL');},31*60000);
 let outcome;try{outcome=await close;}finally{clearTimeout(timeout);fs.fsyncSync(stdout);fs.fsyncSync(stderr);fs.closeSync(stdout);fs.closeSync(stderr);}
 emit({event:'coordinator-retired',pid:childProcess.pid,...outcome,forced,elapsedMs:Date.now()-opened});if(forced||failure||outcome.signal)throw failure??new Error('SAFETY coordinator retirement');
 const sourceResult=path.join(preseal.launchCwd,'ACTUAL-01/RESULT.json'),bytes=bounded(sourceResult,16777216),result=JSON.parse(bytes.toString('utf8'));
 if(result.active!==0||result.children!==33||result.receipts.some(row=>!row.closed||row.signal))throw new Error('SAFETY owned child accounting');
 const totalCapture=result.captureBytes+fs.statSync(path.join(output,'coordinator.stdout')).size+fs.statSync(path.join(output,'coordinator.stderr')).size;if(totalCapture>128*1024*1024)throw new Error('combined capture');
 emit({event:'complete',sourceResult,resultSha256:digest(bytes),resultBytes:bytes.length,childCount:result.children,knownExecutionStarts:36,peakKnown:3,totalCapture,workBytes:result.workBytes,coordinatorExit:outcome.code,elapsedMs:Date.now()-opened});
 console.log(JSON.stringify({sourceResult,resultSha256:digest(bytes),code:outcome.code,knownExecutionStarts:36,childCount:result.children,totalCapture,elapsedMs:Date.now()-opened}));process.exitCode=outcome.code??1;
}catch(error){emit({event:'HOLD',reason:String(error?.stack??error),retired,elapsedMs:Date.now()-opened});console.error(String(error?.stack??error));process.exitCode=1;}finally{fs.fsyncSync(events);fs.closeSync(events);}
