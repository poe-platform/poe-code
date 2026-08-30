import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { gunzipSync } from 'node:zlib';
const here = import.meta.dirname;
const sha = body => crypto.createHash('sha256').update(body).digest('hex');
const sealBytes = fs.readFileSync(path.join(here,'FINAL-DATA-PRESEAL.json'));
assert.equal(sha(sealBytes),process.argv[2]);
const seal = JSON.parse(sealBytes);
assert.ok(Date.now()<Date.parse(seal.deadline));
for(const row of seal.files){const file=path.join(here,row.path),stat=fs.lstatSync(file);assert.ok(stat.isFile()&&!stat.isSymbolicLink()&&stat.size===row.bytes&&stat.size<12000000);assert.equal(sha(fs.readFileSync(file)),row.sha256);}
const dependencies=JSON.parse(fs.readFileSync(path.join(here,'DEPENDENCIES.json')));
const inputs=JSON.parse(fs.readFileSync(path.join(here,'INPUTS.json')));
function bodyAt(rows,suffix){const matches=rows.filter(row=>row.path.endsWith(suffix));assert.equal(matches.length,1);const row=matches[0],body=Buffer.from(row.body,'base64');assert.equal(body.length,row.bytes);assert.equal(sha(body),row.sha256);return body;}
const archive=bodyAt(dependencies,'/PUBLIC98.json.gz.base64');
const compressed=Buffer.from(archive.toString('ascii').trim(),'base64');assert.ok(compressed.length<1048576);
const decoded=gunzipSync(compressed,{maxOutputLength:4194304,info:true});assert.equal(decoded.engine.bytesWritten,compressed.length);
const public98=JSON.parse(decoded.buffer);
const receipt=JSON.parse(bodyAt(dependencies,'/PUBLIC-ENGINE-RECEIPT.json'));
assert.equal(public98.commit,'bb23ec270aaaf1d394b00d330fbf1aa6ccb2952e');assert.equal(public98.files.length,98);assert.equal(receipt.source98.files.length,98);
for(const row of public98.files){assert.equal(row.mode,'100644');const expected=receipt.source98.files.find(item=>item.path===row.path);assert.ok(expected);const bytes=Buffer.from(row.base64,'base64');assert.equal(bytes.length,row.bytes);assert.equal(sha(bytes),row.sha256);assert.equal(crypto.createHash('sha1').update(Buffer.from('blob '+bytes.length+'\0')).update(bytes).digest('hex'),row.blob);for(const field of ['mode','blob','bytes','sha256'])assert.equal(row[field],expected[field]);}
const retained=JSON.parse(bodyAt(dependencies,'/RETAINED-SOURCES.json'));assert.equal(retained.length,14);
for(const row of retained){const body=Buffer.from(row.text);assert.equal(body.length,row.bytes);assert.equal(sha(body),row.sha256);assert.equal(crypto.createHash('sha1').update(Buffer.from('blob '+body.length+'\0')).update(body).digest('hex'),row.blob);}
const origin=JSON.parse(bodyAt(inputs,'/STAGED-IMPORT-ORIGINS.json'));
assert.deepEqual(origin.computedImports.map(row=>row.importer),['harness/node/consumer.mjs','harness/node/consumer.mjs','node_modules/virtual-bash/dist/commands/node/worker-main.js']);
function census(root){assert.equal(fs.realpathSync(root),root);const rows=[];let bytes=0;function walk(relative=''){for(const entry of fs.readdirSync(path.join(root,relative),{withFileTypes:true})){const name=relative?relative+'/'+entry.name:entry.name;assert.notEqual(entry.name,'AGENTS.md');const filename=path.join(root,name),stat=fs.lstatSync(filename);assert.ok(!stat.isSymbolicLink());if(stat.isDirectory()){walk(name);continue;}assert.ok(stat.isFile()&&stat.size<16000000);bytes+=stat.size;assert.ok(bytes<134217728&&rows.length<1000);const descriptor=fs.openSync(filename,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW),buffer=Buffer.alloc(65536),hash=crypto.createHash('sha256');let position=0;try{while(position<stat.size){const count=fs.readSync(descriptor,buffer,0,Math.min(buffer.length,stat.size-position),position);assert.ok(count>0);hash.update(buffer.subarray(0,count));position+=count;}const after=fs.fstatSync(descriptor);assert.equal(after.size,stat.size);assert.equal(after.mtimeMs,stat.mtimeMs);}finally{fs.closeSync(descriptor);}rows.push({path:name,bytes:stat.size,sha256:hash.digest('hex')});}}walk();rows.sort((left,right)=>Buffer.compare(Buffer.from(left.path),Buffer.from(right.path)));return Object.freeze({root,bytes,regularFiles:rows.length,rows});}
assert.equal(process.argv[3],here);
assert.equal(process.argv[4],'/private/tmp/safe-bash-b1-review-20260829T1242');
const own=census(process.argv[3]),capture=census(process.argv[4]);
assert.ok(own.bytes+capture.bytes<268435456);assert.ok(capture.bytes<67108864);assert.ok(Date.now()<Date.parse(seal.deadline));
fs.writeFileSync(path.join(here,'FINAL-DATA-RESULT.json'),JSON.stringify({at:new Date().toISOString(),publicSourceRecords:98,retainedHelpers:14,sourceFilesNewlyExecuted:0,own,capture,qualification:'Invocation-local immutable snapshot before this output and final publication; no resource-containment or full process census claim.'},null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({public98:98,retainedHelpers:14,ownBytes:own.bytes,captureBytes:capture.bytes,productImports:0,realWorkers:0}));
