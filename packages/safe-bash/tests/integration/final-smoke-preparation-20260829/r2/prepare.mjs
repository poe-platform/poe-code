import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import readline from 'node:readline';
const root=process.cwd();
const own=path.join(root,'tests/integration/final-smoke-preparation-20260829/r2');
const started=Date.now();
const cache=new Map();
let serial=0;
const sha=body=>crypto.createHash('sha256').update(body).digest('hex');
function read(relative){
  assert(Date.now()-started<330000,'preparation active deadline');
  assert(!relative.includes('AGENTS.md'));
  const absolute=path.resolve(root,relative);assert(absolute.startsWith(root+'/'));
  if(cache.has(absolute))return cache.get(absolute);
  const stat=fs.lstatSync(absolute);assert(stat.isFile()&&!stat.isSymbolicLink()&&stat.size<=1048576);
  const body=fs.readFileSync(absolute);assert.equal(body.length,stat.size);
  const record={path:absolute,bytes:body.length,mode:stat.mode&0o777,sha256:sha(body),body};
  fs.writeFileSync(path.join(own,'raw',String(++serial)+'.txt'),body,{flag:'wx'});cache.set(absolute,record);return record;
}
const rl=readline.createInterface({input:process.stdin});
console.log(JSON.stringify({pid:process.pid,startedUTC:new Date(started).toISOString(),childSpawns:0}));
for await(const input of rl){try{
  if(input==='finish'){
    const {finish}=await import('./finish.mjs');
    console.log(JSON.stringify(await finish({read,cache,root,own,sha,started})));
    rl.close();process.stdin.pause();break;
  }
  const [relative,offset='0',length='16000']=input.split(' ');const record=read(relative);
  console.log(JSON.stringify({...record,body:undefined,text:record.body.toString('utf8',Number(offset),Number(offset)+Number(length))}));
}catch(error){console.log(JSON.stringify({failure:String(error),stack:error?.stack}));fs.writeFileSync(path.join(own,'STOP.json'),JSON.stringify({failure:String(error),stack:error?.stack}),{flag:'wx'});process.exitCode=78;rl.close();process.stdin.pause();break;}}
console.log(JSON.stringify({endedUTC:new Date().toISOString(),childSpawns:0}));
