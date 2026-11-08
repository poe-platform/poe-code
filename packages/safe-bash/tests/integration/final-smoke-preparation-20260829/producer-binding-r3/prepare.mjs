import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import readline from 'node:readline';
const root=process.cwd(),own=path.join(root,'tests/integration/final-smoke-preparation-20260829/producer-binding-r3'),started=Date.now(),cache=new Map();
const sha=body=>crypto.createHash('sha256').update(body).digest('hex');
let serial=0;
function read(filename,expected){
  assert(Date.now()-started<390000,'active preparation deadline');
  assert(!filename.includes('AGENTS.md'));
  const absolute=path.resolve(root,filename);
  assert(absolute.startsWith(root+'/')||absolute.startsWith('/private/tmp/'),'owned source root');
  if(cache.has(absolute)){const value=cache.get(absolute);if(expected){assert.equal(value.bytes,expected.bytes);assert.equal(value.sha256,expected.sha256);}return value;}
  const stat=fs.lstatSync(absolute);assert(stat.isFile()&&!stat.isSymbolicLink());assert(stat.size<=4194304);
  if(expected)assert.equal(stat.size,expected.bytes);
  const body=fs.readFileSync(absolute);assert.equal(body.length,stat.size);const digest=sha(body);
  if(expected)assert.equal(digest,expected.sha256);
  const record={path:absolute,bytes:body.length,mode:stat.mode&0o777,sha256:digest,body};
  if(!absolute.endsWith('.tgz')&&!absolute.endsWith('.gz'))fs.writeFileSync(path.join(own,'raw',String(++serial)+'.txt'),body,{flag:'wx'});
  cache.set(absolute,record);return record;
}
const rl=readline.createInterface({input:process.stdin});
console.log(JSON.stringify({pid:process.pid,startedUTC:new Date(started).toISOString(),childSpawns:0}));
for await(const input of rl){try{
  if(input==='finish'){const {finish}=await import('./finish.mjs');console.log(JSON.stringify(await finish({read,cache,root,own,sha,started})));rl.close();process.stdin.pause();break;}
  const [filename,offset='0',length='18000']=input.split(' '),record=read(filename);assert(!filename.endsWith('.tgz'));console.log(JSON.stringify({...record,body:undefined,text:record.body.toString('utf8',Number(offset),Number(offset)+Number(length))}));
}catch(error){console.log(JSON.stringify({failure:String(error),stack:error?.stack}));fs.writeFileSync(path.join(own,'STOP.json'),JSON.stringify({failure:String(error),stack:error?.stack}),{flag:'wx'});process.exitCode=78;rl.close();process.stdin.pause();break;}}
console.log(JSON.stringify({endedUTC:new Date().toISOString(),childSpawns:0}));
