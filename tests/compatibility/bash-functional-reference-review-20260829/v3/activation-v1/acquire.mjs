import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
const root=path.dirname(new URL(import.meta.url).pathname);
const capture=fs.openSync(root+'/ACQUIRE.capture.data','wx',0o600);
const log=row=>fs.writeSync(capture,JSON.stringify(row)+'\n');
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const assert=(value,message)=>{if(!value)throw Error(message);};let starts=0;
try{
 log({event:'START',at:new Date().toISOString(),expiry:'2026-08-29T09:03:39.808Z'});
 const base='tests/compatibility/bash-surface-independent-20260829/functional-reference-v3';
 for(const [label,commit]of [['binding','918cd1d414508364b676f8bd2e1a78c34ee9e060'],['publication','d808acf7f67551807654e4089b366789190be07d']]){
  const destination=root+'/'+label;fs.mkdirSync(destination);
  const git=(args,input)=>{starts++;log({event:'ENROLLED',starts,args});const result=spawnSync('/usr/bin/git',args,{input,cwd:'/Users/kjopek/Workspace/safe-bash',env:{PATH:'/usr/bin:/bin',HOME:destination,GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null',GIT_OPTIONAL_LOCKS:'0'},timeout:30000,maxBuffer:8*1024*1024});fs.writeFileSync(root+`/${starts}.stderr.data`,result.stderr??Buffer.alloc(0),{flag:'wx',mode:0o600});log({event:'RETIRED',starts,status:result.status,signal:result.signal,error:result.error?.message,stdoutBytes:result.stdout?.length});assert(!result.error&&!result.signal&&result.status===0,'METADATA_STOP');return result.stdout;};
  const listing=git(['ls-tree','-r','-z',commit,'--',base+'/activation-v1',base+'/GO.json',base+'/REVIEW-ACCEPTANCE.json',base+'/APPROVAL-REQUEST.json']);fs.writeFileSync(destination+'/inventory.data',listing,{flag:'wx',mode:0o600});
  const rows=listing.toString('utf8').split('\0').filter(Boolean).map(line=>{const match=/^(100644|100755) blob ([0-9a-f]{40})\t(.+)$/.exec(line);assert(match&&!match[3].split('/').includes('AGENTS.md'),'PATH_ROLE');return {mode:match[1],blob:match[2],path:match[3]};});assert(rows.length>0&&rows.length<=100,'COUNT');
  const batch=git(['cat-file','--batch'],Buffer.from(rows.map(row=>row.blob).join('\n')+'\n'));let offset=0;
  for(const[index,row]of rows.entries()){const end=batch.indexOf(10,offset),header=batch.subarray(offset,end).toString('ascii').split(' '),size=Number(header[2]);assert(header[0]===row.blob&&header[1]==='blob'&&Number.isSafeInteger(size)&&size>=0&&size<2*1024*1024,'BLOB_HEADER');const bytes=batch.subarray(end+1,end+1+size);assert(bytes.length===size&&batch[end+1+size]===10,'FRAMING');assert(createHash('sha1').update(`blob ${size}\0`).update(bytes).digest('hex')===row.blob,'BLOB_HASH');row.bytes=size;row.sha256=hash(bytes);row.capture=`${index}.data`;fs.writeFileSync(destination+'/'+row.capture,bytes,{flag:'wx',mode:0o600});offset=end+size+2;}
  assert(offset===batch.length,'TRAILER');fs.writeFileSync(destination+'/MANIFEST.json',JSON.stringify({commit,rows},null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({label,files:rows.map(row=>({path:row.path,capture:row.capture,bytes:row.bytes,sha256:row.sha256}))}));
 }
 log({event:'COMPLETE',at:new Date().toISOString(),starts});
}catch(error){log({event:'STOP',message:error.message,starts});process.exitCode=1;}finally{fs.closeSync(capture);}
