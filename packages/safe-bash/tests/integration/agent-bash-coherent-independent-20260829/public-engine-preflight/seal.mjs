import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {gunzipSync} from 'node:zlib';
import assert from 'node:assert/strict';
const home=path.dirname(fileURLToPath(import.meta.url)),files=[],metadata=[];
let totalBytes=0,captureBytes=0;
for(const name of fs.readdirSync(home).sort()){
 if(['REVIEW-SEAL.json','seal.stdout','seal.stderr'].includes(name))continue;
 const fd=fs.openSync(home+'/'+name,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);
 try{const before=fs.fstatSync(fd);assert(before.isFile()&&before.size<=12582912);totalBytes+=before.size;assert(totalBytes<67108864);const digest=createHash('sha256'),buffer=Buffer.alloc(65536);let count,bytes=0;while((count=fs.readSync(fd,buffer,0,buffer.length,null))>0){bytes+=count;assert(bytes<=before.size);digest.update(buffer.subarray(0,count));}const after=fs.fstatSync(fd);assert.equal(after.size,before.size);assert.equal(after.mtimeMs,before.mtimeMs);files.push({path:name,bytes,sha256:digest.digest('hex')});}finally{fs.closeSync(fd);}
}
for(let index=1;index<=10;index++){const label='m'+String(index).padStart(2,'0');const raw=JSON.parse(gunzipSync(Buffer.from(fs.readFileSync(home+'/'+label+'-RAW.json.gz.base64','utf8').trim(),'base64'),{maxOutputLength:16777216}));assert.equal(raw.closed,true);assert.equal(raw.code,0);assert.equal(raw.signal,null);if(label!=='m04')assert.equal(raw.failure,undefined);captureBytes+=raw.captureBytes;metadata.push({label,pid:raw.pid,closed:raw.closed,code:raw.code,captureBytes:raw.captureBytes,failure:raw.failure??null});}
assert(captureBytes<33554432);
const source=fs.readFileSync(home+'/extract-bindings.mjs','utf8');const old=source.replace("const components=('packages/safejs/'+file.path).split('/')","const components=file.path.split('/')");assert.notEqual(old,source);assert.equal(createHash('sha256').update(old).digest('hex'),'221fe3904c9815a867f7f8340fd7726acf2ae5702f63646a9f44591ed84e867b');
assert(fs.statSync(home+'/extract-bindings.stderr').size>0);assert.equal(fs.statSync(home+'/extract-bindings-v2.stderr').size,0);assert.equal(fs.statSync(home+'/recover-m04.stderr').size,0);
const bindings=JSON.parse(fs.readFileSync(home+'/PUBLIC95-BINDINGS.json'));assert.equal(bindings.engineFiles.length,95);assert.equal(bindings.sourceArchive.files,98);
const result={schema:'public-engine-preflight-source-data-review-seal-v1',created:new Date().toISOString(),started:'2026-08-29T09:23:32.871Z',scope:'SOURCE_DATA_ONLY_NOT_RUNTIME_ACCEPTANCE',metadataChildren:metadata,metadataCapturedBytes:captureBytes,sealedWorkingBytes:totalBytes,sourceProof:{publicSourceFiles:98,gitTrees:15,carriedEmissions:95,archiveEntries:96,emittedBytes:1076164,strictCompilerTypecheck:false},corrections:['m04 missing guessed receipt locator retained, four complete blobs recovered','empty-array field-presentation tool error retained in history','extractor v1 monorepo/package pathname error retained, exact reversible v2 correction'],currentCoherent:{tree:'3adc676a0ab638c9788ef007e465931d65d2c6fe',sourceSha256:'ef0b79dbd30cebec3f8b939a98928b9441947ff4be724e5031b2ee03925f26ae',inputs:309,predictedMembers:1014,actualPackageSha256:null},targetExecutions:0,resourceQualification:'Serial metadata/DATA helpers. Ten Git children closed; no target subprocess. Editing/publication/tool-host roles are separate; no complete transitive OS/RSS census claimed. Final seal transport excluded from hashed files.',files};
fs.writeFileSync(home+'/REVIEW-SEAL.json',JSON.stringify(result,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({files:files.length,totalBytes,captureBytes,metadataChildren:metadata.length,targetExecutions:0,at:result.created}));
