import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
import assert from 'node:assert/strict';
const base=path.dirname(new URL(import.meta.url).pathname),seal=JSON.parse(fs.readFileSync(base+'/PRESEAL.json'));
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
for(const item of seal.helpers)assert.equal(hash(fs.readFileSync(base+'/'+item.name)),item.sha256);
const root=base+'/capsule/tests/compatibility/bash-ere-native-reference-20260829';
const controls=JSON.parse(fs.readFileSync(root+'/preflight-v2/CONTROL-PRESEAL.json'));
const verify=()=>{for(const item of controls.files){const file=root+'/'+item.path,stat=fs.lstatSync(file);assert(stat.isFile()&&!stat.isSymbolicLink());assert.equal(stat.size,item.bytes);assert.equal(stat.mode&0o777,item.mode);assert.equal(hash(fs.readFileSync(file)),item.sha256);}};
verify();const records=[];
for(const [role,script,args,cwd] of [['author',root+'/preflight-v2/controls.mjs',[seal.controlPresealSha256],base+'/capsule'],['independent',base+'/independent-controls.mjs',[],base]]){
 assert(Date.now()+125000<Date.parse(seal.limits.deadline));
 const stdout=fs.openSync(base+'/'+role+'.stdout','wx',0o600),stderr=fs.openSync(base+'/'+role+'.stderr','wx',0o600),record={role,startedAt:new Date().toISOString(),spawn:false,exit:false,close:false,timeout:false};
 try{await new Promise((resolve,reject)=>{const child=spawn(seal.tool.path,['--experimental-vm-modules','--experimental-permission','--allow-fs-read='+base,'--allow-fs-read='+seal.tool.path,'--allow-fs-write='+base,script,...args],{cwd,env:{PATH:'/usr/bin:/bin',LANG:'C',LC_ALL:'C',TZ:'UTC'},stdio:['ignore',stdout,stderr]});record.pid=child.pid;child.on('spawn',()=>{record.spawn=true;});child.on('error',error=>{record.error=String(error);});child.on('exit',(code,signal)=>{record.exit=true;record.code=code;record.signal=signal;});const timer=setTimeout(()=>{record.timeout=true;child.kill('SIGTERM');setTimeout(()=>child.kill('SIGKILL'),1000).unref();},120000);child.on('close',()=>{clearTimeout(timer);record.close=true;resolve();});});}finally{for(const fd of [stdout,stderr]){fs.fsyncSync(fd);const stat=fs.fstatSync(fd);assert(stat.size<=2097152);fs.closeSync(fd);}record.finishedAt=new Date().toISOString();records.push(record);fs.writeFileSync(base+'/EXECUTION.json',JSON.stringify({records,native:0,fixtureWorkers:0,knownChildStarts:records.filter(item=>item.spawn).length},null,2)+'\n');}
 assert(record.spawn&&record.exit&&record.close&&!record.timeout&&!record.error&&record.signal===null,'RETIREMENT_OR_SAFETY_STOP');verify();if(record.code!==0)throw Error('CAPTURED_CONTROL_FAILURE:'+role);
}
console.log(JSON.stringify({roles:records.length,retired:records.every(item=>item.close),sourceIntegrity:true,native:0}));
