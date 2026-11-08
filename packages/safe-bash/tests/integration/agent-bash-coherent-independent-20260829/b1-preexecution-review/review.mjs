import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { gunzipSync } from 'node:zlib';
import { pathToFileURL } from 'node:url';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';

const here = import.meta.dirname;
const hash = body => crypto.createHash('sha256').update(body).digest('hex');
function admitted(file, expected, maximum) {
  const stat = fs.lstatSync(file);
  assert.ok(stat.isFile() && !stat.isSymbolicLink() && stat.size <= maximum);
  assert.equal(stat.size, expected.bytes);
  const body = fs.readFileSync(file);
  assert.equal(hash(body), expected.sha256);
  return body;
}
const sealBody = fs.readFileSync(path.join(here, 'PRESEAL.json'));
assert.equal(hash(sealBody), process.argv[2]);
const seal = JSON.parse(sealBody);
assert.ok(Date.now() < Date.parse(seal.deadline));
for (const row of seal.files) admitted(path.join(here, row.path), row, 12000000);
const inputs = JSON.parse(fs.readFileSync(path.join(here, 'INPUTS.json')));
const dependencies = JSON.parse(fs.readFileSync(path.join(here, 'DEPENDENCIES.json')));
const all = [...inputs, ...dependencies];
function rowAt(suffix) {
  const matches = all.filter(row => row.path.endsWith(suffix));
  assert.equal(matches.length, 1, suffix);
  return matches[0];
}
function bodyAt(suffix) {
  const row = rowAt(suffix), body = Buffer.from(row.body, 'base64');
  assert.equal(body.length, row.bytes); assert.equal(hash(body), row.sha256);
  return body;
}
const candidate = JSON.parse(bodyAt('/stage-b1-r2/PRESEAL.json'));
assert.equal(hash(bodyAt('/stage-b1-r2/PRESEAL.json')), '007887fff41f65481ecf7a4fe4ab68db2aa1a5c67d4782a30c5bf764d84f0fbc');
for (const entry of candidate.files) {
  const row = all.find(item => item.path === entry.path);
  assert.ok(row); assert.equal(row.bytes, entry.bytes); assert.equal(row.sha256, entry.sha256);
}
const scratch = path.join(here, 'run');
assert.equal(fs.existsSync(scratch), false);
fs.mkdirSync(scratch);
for (const relative of ['stage-b1-r2','stage-b0-r3','stage-a-r2']) fs.mkdirSync(path.join(scratch, relative));
for (const suffix of ['/stage-b1-r2/admission.mjs','/stage-b1-r2/origins.mjs','/stage-b1-r2/controls.mjs','/stage-b1-r2/PRESEAL.json','/stage-b0-r3/owner.mjs','/stage-a-r2/common.mjs']) {
  const target = suffix.slice(suffix.indexOf('/', 1) + 1);
  const directory = suffix.split('/')[1];
  fs.writeFileSync(path.join(scratch, directory, target), bodyAt(suffix), { flag: 'wx' });
}
await import(pathToFileURL(path.join(scratch, 'stage-b1-r2/controls.mjs')));
const original = JSON.parse(fs.readFileSync(path.join(scratch, 'stage-b1-r2/CONTROL-RESULT.json')));
assert.equal(original.groups.length, 12);
assert.ok(original.groups.every(row => row.status === 'PASS'));
const { admitFile } = await import(pathToFileURL(path.join(scratch, 'stage-b1-r2/admission.mjs')));
const { mapImports } = await import(pathToFileURL(path.join(scratch, 'stage-b1-r2/origins.mjs')));
const { durableJSON, supervisor } = await import(pathToFileURL(path.join(scratch, 'stage-b0-r3/owner.mjs')));

function decode(suffix, maximum) {
  const admittedBody = bodyAt(suffix);
  const compressed = Buffer.from(admittedBody.toString('ascii').trim(), 'base64');
  assert.ok(compressed.length < 2097152);
  const decoded = gunzipSync(compressed, { maxOutputLength: maximum, info: true });
  assert.equal(decoded.engine.bytesWritten, compressed.length);
  assert.ok(admittedBody.length + compressed.length + decoded.buffer.length < 33554432);
  return JSON.parse(decoded.buffer);
}
const archive = decode('/author-v5/INPUTS-v1.json.gz.base64', 16777216);
const public98 = decode('/preparation-v3/PUBLIC98.json.gz.base64', 4194304);
const receipt = JSON.parse(bodyAt('/stage-b/PUBLIC-ENGINE-RECEIPT.json'));
const origins = JSON.parse(bodyAt('/stage-b1-r2/STAGED-IMPORT-ORIGINS.json'));
const members = JSON.parse(bodyAt('/stage-a-r2/evidence/PACKAGE-MEMBERS.json'));
assert.equal(archive.engine.length, 96); assert.equal(receipt.engine.length, 96);
assert.equal(origins.entries.length, 1117); assert.equal(members.length, 1014);
const entries = [];
for (const item of candidate.stageFiles) entries.push({ stagedPath:'harness/node/' + item.target, body:bodyAt('/' + item.source), origin:origins.entries.find(row => row.stagedPath === 'harness/node/' + item.target).origin });
for (const item of archive.engine) {
  const expected = receipt.engine.find(row => row.archiveTarget === item.target);
  assert.ok(expected);
  const body = Buffer.from(item.body, 'base64'); assert.equal(body.length, expected.bytes); assert.equal(hash(body), expected.sha256);
  const stagedPath = 'harness/node/' + expected.stagedRelativePath;
  entries.push({ stagedPath, body, origin:origins.entries.find(row => row.stagedPath === stagedPath).origin });
}
const producer = '/private/tmp/safe-bash-coherent-stage-a-20260829-r2/source';
let packageBytes = 0;
for (const item of members) {
  assert.ok(item.path && !item.path.startsWith('/') && !item.path.split('/').includes('..') && !item.path.includes('AGENTS.md'));
  const body = admitted(path.join(producer, item.path), item, 262144);
  packageBytes += body.length; assert.ok(packageBytes < 16777216);
  const stagedPath = 'node_modules/virtual-bash/' + item.path;
  const origin = origins.entries.find(row => row.stagedPath === stagedPath).origin;
  assert.equal(origin.bytes, body.length); assert.equal(origin.sha256, hash(body));
  entries.push({ stagedPath, body, origin });
}
const mapped = mapImports(entries);
assert.deepEqual(mapped, origins.edges);
assert.equal(mapped.filter(row => row.kind === 'COMPUTED_IMPORT_REQUIRES_RUNTIME_BOUND_LOADER').length, 3);
const counts = Object.fromEntries([...new Set(mapped.map(row => row.kind))].map(kind => [kind, mapped.filter(row => row.kind === kind).length]));
const worker = entries.find(row => row.stagedPath.endsWith('/commands/node/worker-main.js'));
fs.writeFileSync(path.join(here, 'WORKER-SOURCE.data'), worker.body, { flag: 'wx' });
const tests = [];
async function check(id, action) { await action(); tests.push({id,status:'PASS',role:'PURE_DATA_OR_INJECTED_IO'}); }
const empty = path.join(scratch, 'empty'); fs.writeFileSync(empty, '', {flag:'wx'});
const identity = {bytes:0,sha256:hash(Buffer.alloc(0))};
await check('N01-proxy-no-traps',()=>{let traps=0;const value=new Proxy(identity,{getOwnPropertyDescriptor(){traps++;throw 0;}});assert.throws(()=>admitFile(empty,value,0));assert.equal(traps,0);});
await check('N02-inherited-identity-no-getter',()=>{let getters=0;const prototype={get bytes(){getters++;return 0;},sha256:identity.sha256};assert.throws(()=>admitFile(empty,Object.create(prototype),0));assert.equal(getters,0);});
await check('N03-raw-falsy-metadata',()=>{const saved=fs.lstatSync;try{fs.lstatSync=()=>{throw false;};let caught=false;try{admitFile(empty,identity,0);}catch(reason){caught=true;assert.equal(reason,false);}assert.equal(caught,true);}finally{fs.lstatSync=saved;}});
await check('N04-known-empty-and-safe-bounds',()=>{assert.equal(admitFile(empty,identity,0).length,0);for(const bytes of [-1,NaN,Infinity,Number.MAX_SAFE_INTEGER+1])assert.throws(()=>admitFile(empty,{bytes,sha256:identity.sha256},16));});
await check('N05-duplicate-origin-refused',()=>{const row={stagedPath:'x.mjs',body:Buffer.from(''),origin:{kind:'OWN_NEW'}};assert.throws(()=>mapImports([row,row]));});
await check('N06-template-import-accounted',()=>{const rows=mapImports([{stagedPath:'x.mjs',body:Buffer.from('const value = `${import(target)}`;'),origin:{kind:'OWN_NEW'}}]);assert.equal(rows.length,1);assert.equal(rows[0].kind,'COMPUTED_IMPORT_REQUIRES_RUNTIME_BOUND_LOADER');});
await check('N07-cleanup-only-undefined-retained',()=>{let caught=false;try{durableJSON({openSync(){return 1;},writeSync(_fd,_body,_offset,length){return length;},fsyncSync(){},closeSync(){throw undefined;}},'synthetic',{});}catch(reason){caught=true;assert.equal(reason,undefined);}assert.equal(caught,true);});
await check('N08-nonESRCH-falsy-not-absence',async()=>{let descriptor=0;const io={openSync(){return ++descriptor;},writeSync(_fd,_body,_offset,length){return length;},fsyncSync(){},closeSync(){}};const owner=supervisor('synthetic',1620,65536,{io,now:()=>0,started:0,kill(){throw false;},spawn(){const child=new EventEmitter();child.pid=123456;child.stdout=new PassThrough();child.stderr=new PassThrough();child.stdin=new PassThrough();setImmediate(()=>{child.stdout.end();child.stderr.end();child.emit('exit',0,null);child.emit('close',0,null);});return child;}});let caught=false;try{await owner.run('offline-install','synthetic',[],{cwd:'.',env:{},seconds:1});}catch(reason){caught=true;assert.equal(reason,false);}assert.equal(caught,true);owner.abort(false);});
assert.ok(Date.now() < Date.parse(seal.deadline));
const result = {at:new Date().toISOString(),authorGroups:original.groups,independent:tests,entryCount:entries.length,edges:counts,public98Shape:Array.isArray(public98)?{array:public98.length}:Object.keys(public98),engineEntries:archive.engine.length,packageBytes,productImports:0,engineImports:0,realWorkerConstructions:0,actualOSChildConstructions:0,qualification:'Whole unchanged helpers; injected lifecycle is not native FD/process/Worker proof. Public and package code only read/hashed/scanned as DATA.'};
fs.writeFileSync(path.join(here,'RESULT.json'),JSON.stringify(result,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({authorGroups:12,independentGroups:tests.length,entries:entries.length,edges:counts,productImports:0,engineImports:0,realWorkers:0}));
