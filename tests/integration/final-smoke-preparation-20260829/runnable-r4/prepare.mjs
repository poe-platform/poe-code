import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import readline from 'node:readline';
const root=process.cwd(),own=path.join(root,'tests/integration/final-smoke-preparation-20260829/runnable-r4'),started=Date.now(),cache=new Map();
const sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');let serial=0;
function read(filename,expected){assert(Date.now()-started<390000,'active prep deadline');assert(!filename.includes('AGENTS.md'));const absolute=path.resolve(root,filename);assert(absolute.startsWith(root+'/'));if(cache.has(absolute))return cache.get(absolute);const stat=fs.lstatSync(absolute);assert(stat.isFile()&&!stat.isSymbolicLink()&&stat.size<=4194304);if(expected)assert.equal(stat.size,expected.bytes);const body=fs.readFileSync(absolute);assert.equal(body.length,stat.size);const digest=sha(body);if(expected)assert.equal(digest,expected.sha256);const record={path:absolute,bytes:body.length,sha256:digest,mode:stat.mode&0o777,body};fs.writeFileSync(path.join(own,'raw',String(++serial)+'.txt'),body,{flag:'wx'});cache.set(absolute,record);return record;}
console.log(JSON.stringify({startedUTC:new Date(started).toISOString(),pid:process.pid,childSpawns:0}));const rl=readline.createInterface({input:process.stdin});
for await(const input of rl){try{if(input==='finish'){const {finish}=await import('./finish.mjs');console.log(JSON.stringify(await finish({read,cache,root,own,sha,started})));rl.close();process.stdin.pause();break;}const [name,offset='0',length='12000']=input.split(' ');const row=read(name);console.log(JSON.stringify({...row,body:undefined,text:row.body.toString('utf8',Number(offset),Number(offset)+Number(length))}));}catch(error){console.log(JSON.stringify({failure:String(error),stack:error?.stack}));fs.writeFileSync(path.join(own,'STOP.json'),JSON.stringify({failure:String(error),stack:error?.stack}),{flag:'wx'});process.exitCode=78;rl.close();process.stdin.pause();break;}}
console.log(JSON.stringify({endedUTC:new Date().toISOString(),childSpawns:0}));
