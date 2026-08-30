import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
const base=path.dirname(new URL(import.meta.url).pathname),seal=JSON.parse(fs.readFileSync(base+'/I04-v2-PRESEAL.json'));
for(const item of seal.files)assert.equal(createHash('sha256').update(fs.readFileSync(base+'/'+item.path)).digest('hex'),item.sha256);
assert(Date.now()+35000<Date.parse('2026-08-29T10:03:51.594Z'));
const stdout=fs.openSync(base+'/I04-v2.stdout','wx',0o600),stderr=fs.openSync(base+'/I04-v2.stderr','wx',0o600),record={startedAt:new Date().toISOString(),spawn:false,exit:false,close:false,timeout:false};
try{await new Promise(resolve=>{const child=spawn(seal.node,['--experimental-permission','--allow-fs-read='+base,base+'/I04-v2.mjs'],{env:{PATH:'/usr/bin:/bin',LANG:'C',LC_ALL:'C'},stdio:['ignore',stdout,stderr]});record.pid=child.pid;child.on('spawn',()=>{record.spawn=true;});child.on('error',error=>{record.error=String(error);});child.on('exit',(code,signal)=>Object.assign(record,{exit:true,code,signal}));const timer=setTimeout(()=>{record.timeout=true;child.kill('SIGTERM');setTimeout(()=>child.kill('SIGKILL'),1000).unref();},30000);child.on('close',()=>{clearTimeout(timer);record.close=true;resolve();});});}finally{for(const fd of [stdout,stderr]){fs.fsyncSync(fd);assert(fs.fstatSync(fd).size<2097152);fs.closeSync(fd);}record.finishedAt=new Date().toISOString();fs.writeFileSync(base+'/I04-v2-EXECUTION.json',JSON.stringify(record,null,2)+'\n',{flag:'wx'});}
assert(record.spawn&&record.exit&&record.close&&!record.timeout&&!record.error&&record.code===0&&record.signal===null);console.log(JSON.stringify(record));
