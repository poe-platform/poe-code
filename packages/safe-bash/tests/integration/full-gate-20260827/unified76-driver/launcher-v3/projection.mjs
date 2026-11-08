import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {closeSync,lstatSync,openSync,readFileSync,readSync,readdirSync,realpathSync} from 'node:fs';
import {dirname,join,posix} from 'node:path';
import {fileURLToPath} from 'node:url';

export const PROJECTION_SHA256='b74e575644c9476b26d96b6863aa2a2078931e73fe3251862d713edd1d7bbefb';
const digest=value=>createHash('sha256').update(value).digest('hex');
const descriptor=entry=>({path:entry.path,mode:entry.mode,blob:entry.blob,bytes:entry.bytes});
export const instructionName=path=>posix.basename(path).toLowerCase()==='agents.md';
export function readProjection(value=JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)),'INSTRUCTION-PROJECTION.json')))){
  assert.equal(digest(JSON.stringify(value)),PROJECTION_SHA256,'instruction projection metadata changed');
  return value;
}
export function selectProjection(entries,candidate){
  const policy=readProjection(),byPath=new Map(policy.candidateEntries.map(entry=>[entry.path,entry]));
  const blobs=new Set(policy.candidateEntries.map(entry=>entry.blob)),selected=[];
  for(const entry of entries){
    const expected=byPath.get(entry.path);
    if(expected){assert.deepEqual(descriptor(entry),descriptor(expected),'instruction path/mode/length/blob binding');selected.push(expected);}
    else assert.ok(!instructionName(entry.path)&&!blobs.has(entry.blob),'unapproved instruction path or body alias');
  }
  if(selected.length){assert.equal(candidate,policy.candidate,'instruction projection candidate binding');assert.deepEqual(selected,policy.candidateEntries,'all five instruction entries required');}
  return selected;
}
export function assertLinkProjection(path,target){
  const normalized=posix.normalize(posix.join(posix.dirname(path),target));
  assert.ok(!instructionName(path)&&!instructionName(normalized),'symlink instruction alias refused');
}
export function projectionReceipt(entries,candidate,hashes){
  const selected=selectProjection(entries,candidate),omitted=new Set(selected.map(entry=>entry.path));
  assert.deepEqual(Object.keys(hashes).sort(),entries.map(entry=>entry.path).sort(),'logical body binding must cover every entry');
  for(const entry of selected)assert.equal(hashes[entry.path],entry.sha256,'instruction content SHA256 mismatch');
  const physical=entries.filter(entry=>!omitted.has(entry.path));
  return{format:'unified76-logical-projection-v1',candidate,projectionSha256:PROJECTION_SHA256,entriesSha256:digest(JSON.stringify(entries.map(descriptor))),
    logical:{entries:entries.length,bytes:entries.reduce((total,entry)=>total+entry.bytes,0)},
    physical:{entries:physical.length,bytes:physical.reduce((total,entry)=>total+entry.bytes,0)},metadataOnly:selected};
}
export function verifyProjectionReceipt(entries,transport){
  const selected=selectProjection(entries,transport?.projection?.candidate);
  if(!selected.length){assert.equal(transport?.projection?.metadataOnly?.length??0,0);return[];}
  assert.ok(transport&&transport.hashes&&transport.projection,'missing streamed logical body binding');
  assert.equal(transport.status,0);assert.equal(transport.signal,null);assert.equal(transport.closed,true);assert.deepEqual(transport.survivors,[]);
  assert.deepEqual(transport.projection,projectionReceipt(entries,transport.projection.candidate,transport.hashes),'logical projection receipt mismatch');
  return selected;
}
export function hashRegularFile(path){
  const before=lstatSync(path);assert.ok(before.isFile()&&!before.isSymbolicLink(),'dependency must be a regular file');
  const descriptor=openSync(path,'r'),hash=createHash('sha256'),buffer=Buffer.alloc(65536);let bytes=0;
  try{for(;;){const count=readSync(descriptor,buffer,0,buffer.length,null);if(!count)break;hash.update(buffer.subarray(0,count));bytes+=count;}}
  finally{closeSync(descriptor);}
  const after=lstatSync(path);for(const key of ['dev','ino','size','mode','mtimeMs','ctimeMs'])assert.equal(after[key],before[key],'dependency changed while hashing');
  assert.equal(bytes,before.size);return{mode:before.mode&0o777,bytes,sha256:hash.digest('hex')};
}
export function dependencyProjection(entries,origin){
  const policy=readProjection(),expected=policy.dependencyEntries[0],knownHashes=new Set([...policy.candidateEntries,expected].map(entry=>entry.sha256));
  const selected=[];
  for(const entry of entries){
    if(origin===expected.origin&&entry.path===expected.path){
      assert.deepEqual({mode:entry.mode,bytes:entry.bytes,sha256:entry.sha256},{mode:0o644,bytes:expected.bytes,sha256:expected.sha256},'benchmark instruction identity');selected.push(expected);
    }else assert.ok(!instructionName(entry.path)&&!knownHashes.has(entry.sha256),'unapproved dependency instruction path/body/origin');
  }
  assert.equal(selected.length,origin===expected.origin?1:0,'missing benchmark instruction body binding');
  return selected;
}
export function assertNoInstructionCopyTree(root,skip=[]){
  const actual=realpathSync(root),files=[];
  const visit=(directory,prefix='')=>{for(const name of readdirSync(directory).sort()){
    if(skip.includes(name))continue;
    const path=prefix?prefix+'/'+name:name,full=join(directory,name),stat=lstatSync(full);
    assert.ok(!instructionName(path),'unapproved instruction input before copy: '+path);assert.equal(stat.isSymbolicLink(),false,'copy input symlink');
    if(stat.isDirectory())visit(full,path);else{assert.ok(stat.isFile());files.push({path,bytes:stat.size,mode:stat.mode&0o777});}
  }};
  visit(actual);return{root:actual,files:files.length,metadataSha256:digest(JSON.stringify(files)),instructionEntries:0,qualification:'Metadata preflight of exact would-copy paths; no added omission and no private body read'};
}
