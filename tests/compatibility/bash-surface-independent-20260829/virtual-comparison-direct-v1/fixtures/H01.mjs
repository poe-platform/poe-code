import fs from 'node:fs';
import subprocess from 'node:child_process';
const role=JSON.parse(fs.readFileSync(process.env.SURFACE_ROLE));
const rows=[];
let owned;
try {
  if(process.getBuiltinModule('child_process')!==subprocess)throw Error('BUILTIN_IDENTITY');
  try {owned=subprocess.spawn(process.execPath,[role.extraChild],{env:{LC_ALL:'C',LANG:'C',TZ:'UTC',HOME:role.home,TMPDIR:role.home,PATH:role.home},shell:false,stdio:['ignore','pipe','pipe']});}
  catch(reason){if(reason?.code!=='ERR_ACCESS_DENIED'||reason?.permission!=='ChildProcess')throw reason;rows.push({api:'spawn',code:reason.code,permission:reason.permission});}
  if(owned){
    let close=false,exit=false,outEnd=false,errEnd=false;
    const ended=new Promise(resolve=>{owned.on('error',()=>{});owned.on('exit',()=>{exit=true;});owned.on('close',()=>{close=true;resolve();});owned.stdout.on('data',()=>{});owned.stderr.on('data',()=>{});owned.stdout.on('end',()=>{outEnd=true;});owned.stderr.on('end',()=>{errEnd=true;});});
    owned.kill('SIGTERM');await Promise.race([ended,new Promise(resolve=>setTimeout(resolve,2000))]);
    if(!close){owned.kill('SIGKILL');await Promise.race([ended,new Promise(resolve=>setTimeout(resolve,1000))]);}
    process.stdout.write(JSON.stringify({unexpectedAdmission:true,pid:owned.pid,exit,close,outEnd,errEnd})+'\n');throw Error('UNEXPECTED_CHILD_ADMISSION_STOP');
  }
  if(rows.length!==1)throw Error('DENIAL_NOT_OBSERVED');
  process.stdout.write(JSON.stringify({id:'H01',denials:rows,extraOwnedChildren:0,extraWorkers:0,publicSettlement:{execObserved:true,disposeSettled:true,disposeRejected:false},profile:role.profile})+'\n');
}catch(reason){process.stderr.write(JSON.stringify({name:reason?.name,code:reason?.code,message:reason?.message})+'\n');process.exitCode=1;}
