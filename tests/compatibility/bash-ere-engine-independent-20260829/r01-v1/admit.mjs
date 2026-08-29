import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawnSync} from 'node:child_process';
const root='tests/compatibility/bash-ere-engine-independent-20260829/r01-v1';
const author='tests/compatibility/bash-ere-engine-author-20260829/r01-v1';
const commit='72187e5abc1179883f85a63e1ef558f2e141c542';
const sha=(bytes,algorithm='sha256')=>crypto.createHash(algorithm).update(bytes).digest('hex');
const processes=[];
function git(label,args,input) {
  const stdout=fs.openSync(`${root}/raw/${label}.stdout`,'wx',0o600),stderr=fs.openSync(`${root}/raw/${label}.stderr`,'wx',0o600);
  let result;
  try {result=spawnSync('/usr/bin/git',['-c','core.fsmonitor=false',...args],{input,stdio:['pipe',stdout,stderr],timeout:15000,maxBuffer:16777216});}
  finally {fs.closeSync(stdout);fs.closeSync(stderr);}
  processes.push({label,pid:result.pid,status:result.status,signal:result.signal,error:result.error?.message});
  if(result.status!==0||result.signal||result.error) throw new Error(`Git ${label} did not retire successfully`);
  const file=`${root}/raw/${label}.stdout`,stat=fs.lstatSync(file);
  if(!stat.isFile()||stat.size>16777216) throw new Error('capture bound');
  return fs.readFileSync(file);
}
const paths=[author,...['types','errors','limits','syntax','matcher'].map(name=>`src/commands/regex-execution/ere/${name}.ts`)];
const tree=git('candidate-tree',['ls-tree','-r','-z','--long',commit,'--',...paths]);
const rows=tree.toString('utf8').split('\0').filter(Boolean).map(record=>{
  const match=/^(100644|100755) blob ([a-f0-9]{40})\s+(\d+)\t([^\0]+)$/.exec(record);
  if(!match) throw new Error('tree record');
  return {mode:match[1],blob:match[2],size:Number(match[3]),path:match[4]};
});
if(rows.length>128) throw new Error('tree count');
const selected=rows.filter(row=>row.path.startsWith('src/') || path.dirname(row.path)===author);
if(selected.length>32||selected.some(row=>row.size>2097152)||selected.reduce((sum,row)=>sum+row.size,0)>8388608) throw new Error('selection bound');
const batch=git('candidate-blobs',['cat-file','--batch'],Buffer.from(selected.map(row=>row.blob).join('\n')+'\n'));
fs.mkdirSync(`${root}/inputs`,{recursive:true});
let offset=0;
for(const row of selected) {
  const end=batch.indexOf(10,offset),header=batch.subarray(offset,end).toString('ascii');
  if(header!==`${row.blob} blob ${row.size}`) throw new Error('blob header');
  const bytes=batch.subarray(end+1,end+1+row.size);
  if(bytes.length!==row.size || batch[end+1+row.size]!==10 || sha(Buffer.concat([Buffer.from(`blob ${row.size}\0`),bytes]),'sha1')!==row.blob) throw new Error('blob authentication');
  row.sha256=sha(bytes);row.copy=`${root}/inputs/${row.path.startsWith('src/')?'engine-':''}${path.basename(row.path)}.data`;
  fs.writeFileSync(row.copy,bytes,{flag:'wx',mode:0o600});offset=end+row.size+2;
}
if(offset!==batch.length) throw new Error('trailing blob bytes');
const result={commit,startedProcessCount:processes.length,processes,rows,selected};
fs.writeFileSync(`${root}/ADMISSION.json`,JSON.stringify(result,null,2)+'\n',{flag:'wx',mode:0o600});
console.log(JSON.stringify(result,null,2));
