import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {gunzipSync,gzipSync} from 'node:zlib';
import assert from 'node:assert/strict';
const home=path.dirname(fileURLToPath(import.meta.url));
const hash=body=>createHash('sha256').update(body).digest('hex');
const decode=name=>JSON.parse(gunzipSync(Buffer.from(fs.readFileSync(home+'/'+name,'utf8').trim(),'base64'),{maxOutputLength:8388608}));
const earlier=decode('m02-INPUTS.json.gz.base64'),extra=decode('m04-INPUTS.json.gz.base64'),final=decode('m05-INPUTS.json.gz.base64');
for(const row of final){const prior=[...earlier,...extra].find(item=>item.oid===row.oid);assert(prior);assert.equal(row.body,prior.body);}
const snapshots=[];
for(const name of ['CLOSED.json','FINAL-CAPTURE.json.gz']){
 const filename='/tmp/bash-functional-v3-actual-m4s8qE/'+name;
 let descriptor;
 try{descriptor=fs.openSync(filename,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);}catch(error){if(error.code==='ENOENT'){snapshots.push({filename,available:false});continue;}throw error;}
 try{const before=fs.fstatSync(descriptor);assert(before.isFile()&&before.size<=1048576&&before.nlink===1);const bytes=fs.readFileSync(descriptor),after=fs.fstatSync(descriptor);assert.equal(bytes.length,before.size);assert.equal(after.size,before.size);assert.equal(after.mtimeMs,before.mtimeMs);assert.equal(after.ino,before.ino);snapshots.push({filename,available:true,observed:new Date().toISOString(),bytes:bytes.length,sha256:hash(bytes),base64:bytes.toString('base64'),qualification:'Fresh DATA read of exact FINALIZATION locator; no preexisting expected digest, not retroactive Git authentication'});}finally{fs.closeSync(descriptor);}
}
const closure=snapshots.find(row=>row.filename.endsWith('/CLOSED.json'));
const result={created:new Date().toISOString(),immutableCrossCommitBindings:final.length,allByteEqual:true,supplementaryClosure:closure?.available?JSON.parse(Buffer.from(closure.base64,'base64')):null,closureQualification:'Supplementary mutable-locator observation only; original immutable publication stops after eight admin children',targetExecutions:0};
fs.writeFileSync(home+'/SUPPLEMENTARY-LOCATORS.json.gz.base64',gzipSync(Buffer.from(JSON.stringify(snapshots))).toString('base64')+'\n',{flag:'wx'});
fs.writeFileSync(home+'/FINAL-BINDINGS.json',JSON.stringify(result,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({bindings:final.length,snapshots:snapshots.map(({filename,available,bytes,sha256})=>({filename,available,bytes,sha256}))}));
