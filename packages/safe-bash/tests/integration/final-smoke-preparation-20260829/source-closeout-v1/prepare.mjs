import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import readline from 'node:readline';
const root=process.cwd(),own=path.join(root,'tests/integration/final-smoke-preparation-20260829/source-closeout-v1'),started=Date.now(),cache=new Map();
let serial=0;const sha=body=>crypto.createHash('sha256').update(body).digest('hex');
function read(filename,expected){assert(Date.now()-started<300000);const absolute=path.resolve(root,filename);assert(absolute.startsWith(root+'/')&&!absolute.includes('AGENTS.md'));if(cache.has(absolute))return cache.get(absolute);const stat=fs.lstatSync(absolute);assert(stat.isFile()&&!stat.isSymbolicLink()&&stat.size<=4194304);if(expected)assert.equal(stat.size,expected.bytes);const body=fs.readFileSync(absolute);assert.equal(body.length,stat.size);const digest=sha(body);if(expected)assert.equal(digest,expected.sha256);const record={path:absolute,bytes:body.length,mode:stat.mode&0o777,sha256:digest,body};fs.writeFileSync(path.join(own,'raw',String(++serial)+'.txt'),body,{flag:'wx'});cache.set(absolute,record);return record;}
console.log(JSON.stringify({pid:process.pid,startedUTC:new Date(started).toISOString(),startedEpochMs:started,childSpawns:0}));
const rl=readline.createInterface({input:process.stdin});
for await(const input of rl){try{if(input==='finish'){const {finish}=await import('./finish.mjs');console.log(JSON.stringify(await finish({read,cache,root,own,sha,started})));rl.close();process.stdin.pause();break;}const row=read(input);if(input.endsWith('TOOLS.json')){const data=JSON.parse(row.body);console.log(JSON.stringify({path:row.path,bytes:row.bytes,sha256:row.sha256,links:data.npm.rows.filter(item=>item.kind!=='file'),node:data.node}));}else console.log(JSON.stringify({...row,body:undefined,text:row.body.toString().slice(0,5000)}));}catch(error){process.exitCode=78;console.log(JSON.stringify({failure:String(error),stack:error?.stack}));fs.writeFileSync(path.join(own,'STOP.json'),JSON.stringify({failure:String(error),stack:error?.stack}),{flag:'wx'});rl.close();process.stdin.pause();break;}}
console.log(JSON.stringify({endedUTC:new Date().toISOString(),childSpawns:0}));
