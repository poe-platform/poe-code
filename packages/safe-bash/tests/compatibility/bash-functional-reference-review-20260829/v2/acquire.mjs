import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
const root=path.dirname(new URL(import.meta.url).pathname);
const capture=fs.openSync(path.join(root,'ACQUIRE.capture.data'),'wx',0o600);
const record=value=>fs.writeSync(capture,JSON.stringify(value)+'\n');
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const assert=(value,message)=>{if(!value)throw Error(message);};
let starts=0;
try{
 record({phase:'start',at:new Date().toISOString()});
 for(const [label,commit] of [['source','a5fd225af5f9985ae805f48ab1b1790a9c3fbc7f'],['evidence','f9fe59338cf01863735ee67bef5ae03ef993d053']]){
  const destination=path.join(root,label);fs.mkdirSync(destination);
  const git=(args,input)=>{
   starts++;record({phase:'enrolled',starts,args});
   const result=spawnSync('/usr/bin/git',args,{input,cwd:'/Users/kjopek/Workspace/safe-bash',env:{PATH:'/usr/bin:/bin',HOME:destination,GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null',GIT_OPTIONAL_LOCKS:'0'},timeout:30000,maxBuffer:16*1024*1024});
   fs.writeFileSync(path.join(root,`${starts}.stderr.data`),result.stderr??Buffer.alloc(0),{flag:'wx',mode:0o600});
   record({phase:'retired',starts,status:result.status,signal:result.signal,error:result.error?.message,stdoutBytes:result.stdout?.length,stderrBytes:result.stderr?.length});
   assert(!result.error&&!result.signal&&result.status===0,'metadata STOP');return result.stdout;
  };
  const listing=git(['ls-tree','-r','-z',commit,'--','tests/compatibility/bash-surface-independent-20260829/functional-reference-v2']);
  fs.writeFileSync(path.join(destination,'inventory.data'),listing,{flag:'wx',mode:0o600});
  const rows=listing.toString('utf8').split('\0').filter(Boolean).map(line=>{
   const match=/^(100644|100755) blob ([0-9a-f]{40})\t(.+)$/.exec(line);
   assert(match&&!match[3].split('/').includes('AGENTS.md'),'inventory role');return {mode:match[1],blob:match[2],path:match[3]};
  });
  assert(rows.length>0&&rows.length<=100,'file count');
  const bodies=git(['cat-file','--batch'],Buffer.from(rows.map(row=>row.blob).join('\n')+'\n'));let offset=0;
  for(const [index,row] of rows.entries()){
   const end=bodies.indexOf(10,offset);const header=bodies.subarray(offset,end).toString('ascii').split(' ');const size=Number(header[2]);
   assert(header[0]===row.blob&&header[1]==='blob'&&Number.isSafeInteger(size)&&size>=0&&size<8*1024*1024,'blob header');
   const bytes=bodies.subarray(end+1,end+1+size);assert(bytes.length===size&&bodies[end+1+size]===10,'blob framing');
   assert(createHash('sha1').update(`blob ${size}\0`).update(bytes).digest('hex')===row.blob,'blob integrity');
   row.bytes=size;row.sha256=hash(bytes);row.capture=`${index}.data`;fs.writeFileSync(path.join(destination,row.capture),bytes,{flag:'wx',mode:0o600});offset=end+size+2;
  }
  assert(offset===bodies.length,'batch trailer');
  fs.writeFileSync(path.join(destination,'MANIFEST.json'),JSON.stringify({commit,rows},null,2)+'\n',{flag:'wx'});
  console.log(JSON.stringify({label,files:rows.map(row=>({name:path.basename(row.path),capture:row.capture,bytes:row.bytes,sha256:row.sha256}))}));
 }
 record({phase:'complete',starts});
}catch(error){record({phase:'STOP',message:error.message,starts});process.exitCode=1;}
finally{fs.closeSync(capture);}
