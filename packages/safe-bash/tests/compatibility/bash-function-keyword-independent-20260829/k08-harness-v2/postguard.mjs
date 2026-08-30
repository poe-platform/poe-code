import fs from 'node:fs';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';

const own=new URL('.',import.meta.url);
const bindingFile=new URL('BINDINGS.json',own);
const bindingStat=fs.lstatSync(bindingFile);
assert(bindingStat.isFile()&&bindingStat.size<65536);
const bindings=JSON.parse(fs.readFileSync(bindingFile));
let verified=0;
for(const row of bindings.bindings){
  const stat=fs.lstatSync(row.path);
  assert(stat.isFile()&&stat.size===row.bytes&&(stat.mode&511)===row.mode);
  const hash=crypto.createHash('sha256');let size=0;
  for await(const chunk of fs.createReadStream(row.path,{highWaterMark:65536})){
    size+=chunk.length;assert(size<=row.bytes);hash.update(chunk);
  }
  assert.equal(size,row.bytes);assert.equal(hash.digest('hex'),row.sha256);verified++;
}
const samples=[];
function walk(dir){
  for(const name of fs.readdirSync(dir)){
    const path=new URL(name,dir),stat=fs.lstatSync(path);assert(!stat.isSymbolicLink());
    if(stat.isDirectory())walk(new URL(name+'/',dir));
    else{assert(stat.isFile());samples.push({path:path.href,bytes:stat.size});}
  }
}
walk(own);
const snapshot={utc:new Date().toISOString(),originalBindingPostguards:verified,files:samples.length,logicalBytes:samples.reduce((sum,row)=>sum+row.bytes,0),measure:'owned namespace file-byte snapshot; not host RSS or global census',futureCaptureEmpty:fs.readdirSync(bindings.paths.work+'/future-capture').length===0};
assert(snapshot.logicalBytes<268435456);
fs.writeFileSync(new URL('POSTGUARDS.json',own),JSON.stringify(snapshot,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify(snapshot));
