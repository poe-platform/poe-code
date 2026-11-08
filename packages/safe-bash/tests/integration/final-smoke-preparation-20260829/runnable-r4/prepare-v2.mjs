import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
const root=process.cwd(),own=path.join(root,'tests/integration/final-smoke-preparation-20260829/runnable-r4');
const started=Date.parse('2026-08-29T17:43:52.638Z'),cache=new Map(),sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
let serial=0;
const raw=path.join(own,'raw-v2');fs.mkdirSync(raw,{mode:0o700});
function read(filename,expected){assert(Date.now()-started<420000,'original grant active publication margin');const absolute=path.resolve(root,filename);assert(absolute.startsWith(root+'/')&&!absolute.includes('AGENTS.md'));if(cache.has(absolute))return cache.get(absolute);const stat=fs.lstatSync(absolute);assert(stat.isFile()&&!stat.isSymbolicLink()&&stat.size<=4194304);if(expected)assert.equal(stat.size,expected.bytes);const body=fs.readFileSync(absolute);assert.equal(body.length,stat.size);const digest=sha(body);if(expected)assert.equal(digest,expected.sha256);const record={path:absolute,bytes:body.length,sha256:digest,mode:stat.mode&0o777,body};fs.writeFileSync(path.join(raw,String(++serial)+'.txt'),body,{flag:'wx'});cache.set(absolute,record);return record;}
console.log(JSON.stringify({pid:process.pid,phase:'ordinary-schema-correction',originalGrantStartedUTC:new Date(started).toISOString(),startedUTC:new Date().toISOString(),childSpawns:0}));
try{const {finish}=await import('./finish.mjs');console.log(JSON.stringify(await finish({read,cache,root,own,sha,started})));}catch(error){process.exitCode=78;const value={failure:String(error),stack:error?.stack,endedUTC:new Date().toISOString()};fs.writeFileSync(path.join(own,'STOP-v2.json'),JSON.stringify(value),{flag:'wx'});console.log(JSON.stringify(value));}
console.log(JSON.stringify({endedUTC:new Date().toISOString(),childSpawns:0}));
