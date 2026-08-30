import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
const root=process.cwd(),base=path.join(root,'tests/integration/final-smoke-preparation-20260829'),own=path.join(base,'runnable-r5'),started=Date.now(),cache=new Map();
const sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
let serial=0;
fs.mkdirSync(own,{mode:0o700});fs.mkdirSync(path.join(own,'raw'),{mode:0o700});
console.log(JSON.stringify({startedUTC:new Date(started).toISOString(),pid:process.pid,childSpawns:0}));
function read(filename,expected){const absolute=path.resolve(root,filename);assert(absolute.startsWith(root+'/')&&!absolute.includes('AGENTS.md'));if(cache.has(absolute)){const record=cache.get(absolute);if(expected){assert.equal(record.bytes,expected.bytes);assert.equal(record.sha256,expected.sha256);}return record;}const stat=fs.lstatSync(absolute);assert(stat.isFile()&&!stat.isSymbolicLink()&&stat.size<=4194304);if(expected)assert.equal(stat.size,expected.bytes);const body=fs.readFileSync(absolute);assert.equal(body.length,stat.size);const hash=sha(body);if(expected)assert.equal(hash,expected.sha256);const record={path:absolute,bytes:body.length,mode:stat.mode&0o777,sha256:hash,body};fs.writeFileSync(path.join(own,'raw',String(++serial)+'.txt'),body,{flag:'wx'});cache.set(absolute,record);return record;}
try{
  const origin=path.join(base,'runnable-r4');
  for(const name of ['bootstrap.mjs','runtime.mjs','consumer-entry.mjs']){const record=read(path.join(origin,name));fs.writeFileSync(path.join(own,name),record.body,{flag:'wx'});}
  for(const name of ['policy.mjs','finish.mjs','launch.sh']){const record=read(path.join(origin,name));let text=record.body.toString();text=text.replaceAll('2026-08-29T17:55:00.000Z','2026-08-29T18:10:00.000Z').replaceAll('2026-08-29T18:15:00.000Z','2026-08-29T18:30:00.000Z').replaceAll('2026-08-29T17:55:00Z','2026-08-29T18:10:00Z').replaceAll('2026-08-29T17:55:00.001Z','2026-08-29T18:10:00.001Z').replaceAll('latest17:55','latest18:10').replaceAll('expiry18:15','expiry18:30').replaceAll('17:55UTC','18:10UTC').replaceAll('18:15','18:30').replaceAll('/runnable-r4/','/runnable-r5/').replaceAll('final-coherent-smoke-r4-20260829','final-coherent-smoke-r5-20260829');fs.writeFileSync(path.join(own,name),text,{flag:'wx'});}
  fs.writeFileSync(path.join(own,'DERIVATION.json'),JSON.stringify({sourceCommit:'2a3eb6b58422bcd83bafb4bdc8962c2f1a2d2764',unchanged:['bootstrap.mjs','runtime.mjs','consumer-entry.mjs'],changed:['policy.mjs: ROOT latest/expiry only','finish.mjs: matching controls/window and output namespace','launch.sh: new namespace only'],oldSTOPsUnchanged:true,syntaxChecks:'PENDING_BEFORE_READY'},null,2)+'\n',{flag:'wx'});
  const {finish}=await import(path.join(own,'finish.mjs'));const result=await finish({read,cache,root,own,sha,started});
  const packet=JSON.parse(fs.readFileSync(path.join(own,'PACKET.json')));
  const launch=read(path.join(own,'launch.sh'));
  fs.writeFileSync(path.join(own,'ACTIVATION-BINDING.json'),JSON.stringify({packet:{path:path.join(own,'PACKET.json'),bytes:result.packetBytes,sha256:result.packetSha256},launcher:{path:launch.path,bytes:launch.bytes,sha256:launch.sha256},bootstrap:packet.files.find(row=>row.path.endsWith('/bootstrap.mjs')),producerReview:'PENDING',preexecReview:'PENDING',rootAuthorization:'PENDING',rootGrantDigestAndLength:'PENDING_ACTUAL_WRITTEN_BYTES',syntaxChecks:'REQUIRED_BEFORE_READY',timePolicy:packet.clock},null,2)+'\n',{flag:'wx'});
  assert(Date.now()-started<180000,'publication reserve');
  console.log(JSON.stringify({...result,activationBindingSha256:sha(fs.readFileSync(path.join(own,'ACTIVATION-BINDING.json'))),syntaxChecks:'PENDING',endedUTC:new Date().toISOString()}));
}catch(error){process.exitCode=78;const value={failure:String(error),stack:error?.stack,endedUTC:new Date().toISOString()};fs.writeFileSync(path.join(own,'STOP.json'),JSON.stringify(value),{flag:'wx'});console.log(JSON.stringify(value));}
