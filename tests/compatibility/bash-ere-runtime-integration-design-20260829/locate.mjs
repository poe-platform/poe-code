import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawnSync} from 'node:child_process';
const own=path.resolve('tests/compatibility/bash-ere-runtime-integration-design-20260829');
const hash=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const rows=[];
for(const commit of ['2660137c','a2249d46','e2b4823c','aa16808c','7cdb62ac','6c68be44','efcd8b49']){
 const stdout=fs.openSync(own+'/raw/'+commit+'.stdout','wx+',0o600),stderr=fs.openSync(own+'/raw/'+commit+'.stderr','wx+',0o600);let bytes,result;
 try{result=spawnSync('/usr/bin/git',['-c','core.fsmonitor=false','diff-tree','--no-commit-id','--name-only','-r','-z',commit],{cwd:process.cwd(),shell:false,stdio:['ignore',stdout,stderr],timeout:5000,killSignal:'SIGKILL'});fs.fsyncSync(stdout);fs.fsyncSync(stderr);const stat=fs.fstatSync(stdout),err=fs.fstatSync(stderr);if(!stat.isFile()||stat.size>262144||!err.isFile()||err.size>65536||result.error||result.status!==0||result.signal)throw Error('METADATA_STOP');bytes=Buffer.alloc(stat.size);let offset=0;while(offset<bytes.length){const count=fs.readSync(stdout,bytes,offset,bytes.length-offset,offset);if(!count)throw Error('SHORT_CAPTURE');offset+=count;}}finally{fs.closeSync(stdout);fs.closeSync(stderr);}
 const names=new TextDecoder('utf-8',{fatal:true}).decode(bytes).split('\0').filter(Boolean);if(names.length>256)throw Error('PATH_COUNT');const row={commit,pid:result.pid,status:result.status,retired:true,bytes:bytes.length,sha256:hash(bytes),paths:names};rows.push(row);console.log(JSON.stringify(row));
}
fs.writeFileSync(own+'/LOCATORS.json',JSON.stringify({role:'stored-commit changed-path metadata only; no target execution',rows},null,2)+'\n',{flag:'wx',mode:0o600});
