import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {gunzipSync} from 'node:zlib';
import assert from 'node:assert/strict';
const home=path.dirname(fileURLToPath(import.meta.url));
const files=[];
let totalBytes=0;
for(const name of fs.readdirSync(home).sort()){
 if(['seal.stdout','seal.stderr','REVIEW-SEAL.json'].includes(name))continue;
 const descriptor=fs.openSync(home+'/'+name,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);
 try{const before=fs.fstatSync(descriptor);assert(before.isFile()&&before.size<=4194304);totalBytes+=before.size;assert(totalBytes<16777216);const digest=createHash('sha256'),buffer=Buffer.alloc(65536);let bytes=0,count;while((count=fs.readSync(descriptor,buffer,0,buffer.length,null))>0){bytes+=count;assert(bytes<=before.size);digest.update(buffer.subarray(0,count));}const after=fs.fstatSync(descriptor);assert.equal(after.size,before.size);assert.equal(after.mtimeMs,before.mtimeMs);files.push({path:name,bytes,sha256:digest.digest('hex')});}finally{fs.closeSync(descriptor);}
}
const metadata=[];
for(const name of ['m01','m02','m03','m04','m05']){const receipt=JSON.parse(gunzipSync(Buffer.from(fs.readFileSync(home+'/'+name+'-RAW.json.gz.base64','utf8').trim(),'base64'),{maxOutputLength:12582912}));assert.equal(receipt.closed,true);assert.equal(receipt.code,0);assert.equal(receipt.signal,null);metadata.push({label:name,pid:receipt.pid,start:receipt.start,end:receipt.end,captureBytes:receipt.captureBytes});}
for(const name of ['audit-v1','audit-publication-v2','final-bindings','prepare-extra','prepare-final-bindings'])assert.equal(fs.statSync(home+'/'+name+'.stderr').size,0);
assert(fs.statSync(home+'/audit-publication.stderr').size>0);
const seal={schema:'independent-data-review-seal-v1',at:new Date().toISOString(),verdict:'QUALIFIED_FUNCTIONAL_ORACLE_OBSERVATIONS_NOT_PARITY_OR_CONTAINMENT',actualCommit:'eaa9889d98eaa6d15acc31f4e39a33d000b67d2c',publicationCommit:'664b178c018c9de76a061b84b905c438ff02735b',targetExecutions:0,originalDataPredicates:47,additionalCrossCommitBindings:17,supplementaryPublication:'v1 assertion failure preserved; v2 closed/noReuse profile and13 admin records verified',metadataChildren:metadata,totalSealedWorkingBytes:totalBytes,files,ownResourceQualification:'Serial known metadata/data/edit/publication roles only. No universal transitive process, RSS or hard disk census. Seal stdout/stderr and later Git transport excluded from this file hash set.'};
fs.writeFileSync(home+'/REVIEW-SEAL.json',JSON.stringify(seal,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({files:files.length,totalBytes,metadataChildren:metadata.length,targetExecutions:0,created:seal.at}));
