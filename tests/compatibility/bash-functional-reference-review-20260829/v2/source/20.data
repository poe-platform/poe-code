import fs from 'node:fs';
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
export const root='/Users/kjopek/Workspace/safe-bash';
export const scope='tests/compatibility/bash-surface-independent-20260829/functional-reference-v2';
export const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
export async function child(capture,label,executable,args,input=''){
 const events=fs.openSync(capture+'/EVENTS.jsonl','a',0o600);const state=JSON.parse(fs.readFileSync(capture+'/STATE.json'));
 if(state.halted||state.active||state.children.length>=64||Date.now()>=state.deadline){fs.closeSync(events);throw Error('PHASE_STOP');}
 if(!['apply_patch','/usr/bin/git'].includes(executable)&&!(executable==='/Users/kjopek/.nvm/versions/node/v22.22.2/bin/node'&&JSON.stringify(args)===JSON.stringify([root+'/'+scope+'/control-owner.mjs','--capture','/tmp/bash-functional-launcher-v2-prep-JKgaZw/controls']))){fs.closeSync(events);throw Error('EXECUTABLE_REFUSED');}
 const number=state.children.length+1,prefix=String(number).padStart(3,'0')+'-'+label;const out=fs.openSync(capture+'/'+prefix+'.stdout','wx',0o600),err=fs.openSync(capture+'/'+prefix+'.stderr','wx',0o600);
 fs.writeFileSync(capture+'/'+prefix+'.stdin',input,{flag:'wx',mode:0o600});
 const row={number,label,executable,args,started:Date.now(),exit:false,close:false,stdoutEOF:false,stderrEOF:false,bytes:0,errors:[]};state.children.push(row);state.active=1;
 const save=()=>fs.writeFileSync(capture+'/STATE.json',JSON.stringify(state,null,2)+'\n');save();fs.writeFileSync(events,JSON.stringify({event:'ENROLLED',row})+'\n');
 const env={PATH:'/usr/bin:/bin',HOME:capture,LC_ALL:'C',LANG:'C',TZ:'UTC',GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null',GIT_OPTIONAL_LOCKS:'0',GIT_ATTR_NOSYSTEM:'1'};
 const proc=spawn(executable,args,{cwd:root,shell:false,...(executable==='apply_patch'?{}:{env}),stdio:['pipe','pipe','pipe']});
 let settle;const retired=new Promise(resolve=>{settle=resolve;});proc.on('error',error=>{row.errors.push({code:error.code??'UNKNOWN',name:error.name});});proc.on('exit',(status,signal)=>{row.exit=true;row.status=status;row.signal=signal;});proc.on('close',()=>{row.close=true;settle(true);});
 const consume=fd=>bytes=>{if(state.captureBytes+bytes.length>state.limits.captureBytes){state.halted=true;row.errors.push({code:'CAPTURE_LIMIT'});return;}try{fs.writeFileSync(fd,bytes);state.captureBytes+=bytes.length;row.bytes+=bytes.length;}catch{state.halted=true;row.errors.push({code:'CAPTURE_ERROR'});}};
 proc.stdout.on('data',consume(out));proc.stderr.on('data',consume(err));proc.stdout.on('end',()=>{row.stdoutEOF=true;});proc.stderr.on('end',()=>{row.stderrEOF=true;});proc.stdin.on('error',error=>row.errors.push({code:error.code??'STDIN_ERROR'}));row.pid=proc.pid;save();proc.stdin.end(input);
 const timer=setTimeout(()=>{state.halted=true;row.errors.push({code:'UNKNOWN_RETIREMENT_NO_SIGNAL_AUTHORITY'});save();settle(false);},Math.min(30000,state.deadline-Date.now()));const closed=await retired;clearTimeout(timer);
 if(!closed){fs.writeFileSync(events,JSON.stringify({event:'STOP',row})+'\n');fs.closeSync(events);throw Error('UNKNOWN_RETIREMENT_STOP');}
 fs.closeSync(out);fs.closeSync(err);row.finished=Date.now();state.active=0;if(!row.exit||!row.stdoutEOF||!row.stderrEOF||row.errors.length)state.halted=true;save();fs.writeFileSync(events,JSON.stringify({event:'RETIRED',row})+'\n');fs.closeSync(events);
 if(state.halted)throw Error('PUBLICATION_STOP');return {row,stdout:fs.readFileSync(capture+'/'+prefix+'.stdout'),stderr:fs.readFileSync(capture+'/'+prefix+'.stderr')};
}
export const git=(capture,label,args,input='')=>child(capture,label,'/usr/bin/git',['-c','core.hooksPath=/dev/null','-c','commit.gpgsign=false','-c','maintenance.auto=false','-c','gc.auto=0','-c','core.fsmonitor=false',...args],input);
export async function patch(capture,files){const text='*** Begin Patch\n'+[...files].map(([name,value])=>'*** Add File: '+scope+'/'+name+'\n'+value.replace(/\n$/,'').split('\n').map(line=>'+'+line).join('\n')+'\n').join('')+'*** End Patch\n';const result=await child(capture,'apply-owned','apply_patch',[],text);if(result.row.status!==0)throw Error('PATCH_FAILED');}
