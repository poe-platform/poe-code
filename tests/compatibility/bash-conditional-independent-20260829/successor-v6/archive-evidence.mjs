import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { gzipSync, gunzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
const own=path.dirname(fileURLToPath(import.meta.url));
assert.deepEqual(process.argv.slice(2),['--source-data-only']);
const originalStart=1787985986890;
assert.ok(Date.now()-originalStart<3600000);
const destination=path.join(own,'FINAL');fs.mkdirSync(destination);
const records=[],physical=[],summaries=[];let bytesTotal=0,physicalBytes=0;
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
function fileHash(filename){const stat=fs.lstatSync(filename);assert.ok(stat.isFile()&&!stat.isSymbolicLink());assert.equal(fs.realpathSync(filename),filename);const fd=fs.openSync(filename,'r'),buffer=Buffer.alloc(65536),digest=createHash('sha256');let bytes=0;try{for(;;){const count=fs.readSync(fd,buffer,0,buffer.length,null);if(!count)break;bytes+=count;assert.ok(bytes<=stat.size);digest.update(buffer.subarray(0,count));}}finally{fs.closeSync(fd);}assert.equal(bytes,stat.size);return{bytes,mode:stat.mode&511,sha256:digest.digest('hex')};}
const byteOrder=(a,b)=>Buffer.compare(Buffer.from(a),Buffer.from(b));
function walk(root,relative,attempt){for(const name of fs.readdirSync(path.join(root,relative)).sort(byteOrder)){assert.notEqual(name,'AGENTS.md');const rel=path.join(relative,name),filename=path.join(root,rel),stat=fs.lstatSync(filename);assert.ok(!stat.isSymbolicLink());if(stat.isDirectory())walk(root,rel,attempt);else{const row={path:attempt+'/'+rel,...fileHash(filename)};physical.push(row);physicalBytes+=row.bytes;assert.ok(physicalBytes<1073741824);if(relative===''||relative==='scratch'){assert.ok(row.bytes<=16777216);bytesTotal+=row.bytes;assert.ok(bytesTotal<=134217728);const bytes=fs.readFileSync(filename);assert.equal(hash(bytes),row.sha256);records.push({...row,base64:bytes.toString('base64')});}}}}
for(const attempt of ['ACTUAL-01','ACTUAL-02','ACTUAL-03']){const root=path.join(own,attempt);walk(root,'',attempt);const result=JSON.parse(fs.readFileSync(path.join(root,'scratch/RESULT.json'))),outer=JSON.parse(fs.readFileSync(path.join(root,'OUTER.json')));assert.ok(outer.closed&&outer.groupAbsent&&outer.signals.length===0&&!outer.failure);assert.ok(result.cleanup.allClosed&&result.cleanup.signals.length===0);summaries.push({attempt,status:result.status,outer,cleanup:result.cleanup,captureBytes:result.captureBytes,scratchBytes:result.actualScratchBytes,cohorts:result.cohorts.map(group=>({label:group.label,cases:group.cases.length,pass:group.pass,fail:group.cases.length-group.pass})),types:result.types.map(group=>({layout:group.label,role:group.role,negative:group.negative,pass:group.pass,diagnostics:group.errors.length})),error:result.error});}
const raw=Buffer.from(JSON.stringify(records)),packed=gzipSync(raw),unpacked=JSON.parse(gunzipSync(packed,{maxOutputLength:268435456}));assert.equal(unpacked.length,records.length);
for(let index=0;index<records.length;index++){const original=records[index],roundtrip=unpacked[index];assert.deepEqual(roundtrip,original);const bytes=Buffer.from(roundtrip.base64,'base64');assert.equal(bytes.length,original.bytes);assert.equal(hash(bytes),original.sha256);assert.deepEqual(fileHash(path.join(own,original.path)),{bytes:original.bytes,mode:original.mode,sha256:original.sha256});}
fs.writeFileSync(path.join(destination,'RAW.json.gz.base64'),packed.toString('base64')+'\n',{flag:'wx'});
fs.writeFileSync(path.join(destination,'RAW-MANIFEST.json'),JSON.stringify(records.map(({base64,...row})=>row),null,2)+'\n',{flag:'wx'});
fs.writeFileSync(path.join(destination,'PHYSICAL-CENSUS.json'),JSON.stringify(physical,null,2)+'\n',{flag:'wx'});
fs.writeFileSync(path.join(destination,'SUMMARY.json'),JSON.stringify({role:'SOURCE_DATA_SYNTHESIS_NOT_ADDITIONAL_EXECUTION',summaries,rawRecords:records.length,rawBytes:bytesTotal,archiveBytes:packed.length,archiveSha256:hash(packed),archiveBase64Sha256:hash(fs.readFileSync(path.join(destination,'RAW.json.gz.base64'))),physicalFiles:physical.length,physicalBytes,deleted:0,elapsedMs:Date.now()-originalStart},null,2)+'\n',{flag:'wx'});
assert.ok(Date.now()-originalStart<3600000);console.log(JSON.stringify({rawRecords:records.length,rawBytes:bytesTotal,physicalFiles:physical.length,physicalBytes,archiveBytes:packed.length,deleted:0,elapsedMs:Date.now()-originalStart}));

