import fs from 'node:fs';
import path from 'node:path';
import {gunzipSync} from 'node:zlib';
import {hash,readPinned} from './reuse/auth.mjs';

export function timeWindow(started, deadline, now=Date.now()) {
  if (![started,deadline,now].every(Number.isSafeInteger) || started < 0 || deadline-started !== 1800000 || now < started || now >= deadline-180000) throw Error('TIME_ADMISSION');
  return {started,deadline,bodyDeadline:deadline-180000};
}
export function validateTar(tar, manifest) {
  if (!Buffer.isBuffer(tar) || tar.length !== manifest.tarBytes || tar.length % 512 || manifest.count !== 1010 || manifest.members.length !== 1010) throw Error('TAR_CARDINALITY_ALIGNMENT');
  const expected = new Map();
  for (const row of manifest.members) {
    if (!row.path.startsWith('package/') || row.path.split('/').some(part=>!part||part==='..'||part==='.') || expected.has(row.path) || !Number.isSafeInteger(row.size) || row.size<0 || row.mode!==420 || !/^[a-f0-9]{64}$/u.test(row.sha256)) throw Error('MANIFEST_SCHEMA');
    expected.set(row.path,row);
  }
  const text = bytes => { const end=bytes.indexOf(0); const head=end<0?bytes:bytes.subarray(0,end); if(end>=0&&bytes.subarray(end).some(byte=>byte!==0))throw Error('TAR_TEXT_PADDING'); return new TextDecoder('utf-8',{fatal:true}).decode(head); };
  const octal = bytes => { const raw=bytes.toString('ascii').replace(/[\0 ]+$/u,''); if(!/^[0-7]+$/u.test(raw))throw Error('TAR_OCTAL'); const value=Number.parseInt(raw,8);if(!Number.isSafeInteger(value))throw Error('TAR_SIZE');return value; };
  const rows=[]; const seen=new Set(); let offset=0;
  while (offset+512<=tar.length) {
    const header=tar.subarray(offset,offset+512);
    if(header.every(byte=>byte===0)) { if(tar.length-offset<1024||tar.subarray(offset).some(byte=>byte!==0))throw Error('TAR_TERMINAL');offset=tar.length;break; }
    let sum=0;for(let index=0;index<512;index++)sum+=index>=148&&index<156?32:header[index];
    if(sum!==octal(header.subarray(148,156))||header[156]!==48||header.subarray(257,263).toString('ascii')!=='ustar\0')throw Error('TAR_HEADER');
    const prefix=text(header.subarray(345,500)); const name=text(header.subarray(0,100)); const relative=prefix?prefix+'/'+name:name;
    const expectedRow=expected.get(relative); const size=octal(header.subarray(124,136)); const mode=octal(header.subarray(100,108));
    if(!expectedRow||seen.has(relative)||size!==expectedRow.size||mode!==expectedRow.mode||offset+512+size>tar.length)throw Error('TAR_MEMBER');
    const content=tar.subarray(offset+512,offset+512+size);if(hash(content)!==expectedRow.sha256)throw Error('TAR_CONTENT');
    const end=offset+512+Math.ceil(size/512)*512;if(tar.subarray(offset+512+size,end).some(byte=>byte!==0))throw Error('TAR_PADDING');
    rows.push({path:relative.slice(8),content,mode,sha256:expectedRow.sha256});seen.add(relative);offset=end;
  }
  if(offset!==tar.length||seen.size!==expected.size||rows.length!==1010)throw Error('TAR_SET');
  return rows;
}
export function admitArchive(filename, manifest) {
  const compressed=readPinned(filename,{bytes:manifest.size,sha256:manifest.sha256},16777216);
  const tar=gunzipSync(compressed,{maxOutputLength:33554432});
  return {tar,rows:validateTar(tar,manifest),compressedBytes:compressed.length};
}
export function materialize(rows, root) {
  if(fs.existsSync(root))throw Error('STAGE_EXISTS');fs.mkdirSync(root,{recursive:true});
  for(const row of rows){const filename=path.join(root,row.path);fs.mkdirSync(path.dirname(filename),{recursive:true});fs.writeFileSync(filename,row.content,{flag:'wx',mode:row.mode});}
  verifyPackage(root,rows);
}
export function verifyPackage(root, rows) {
  const actual=[];const walk=(directory,relative='')=>{for(const name of fs.readdirSync(directory)){const filename=path.join(directory,name),stat=fs.lstatSync(filename),next=relative?relative+'/'+name:name;if(stat.isSymbolicLink())throw Error('STAGE_LINK');if(stat.isDirectory())walk(filename,next);else{if(!stat.isFile())throw Error('STAGE_TYPE');actual.push(next);}}};walk(root);
  const expected=rows.map(row=>row.path).sort();actual.sort();if(JSON.stringify(expected)!==JSON.stringify(actual))throw Error('STAGE_SET');
  for(const row of rows){const filename=path.join(root,row.path);if((fs.lstatSync(filename).mode&511)!==row.mode)throw Error('STAGE_MODE');readPinned(filename,{bytes:row.content.length,sha256:row.sha256});}
}
export function sample(root, maximum) {
  let bytes=0,files=0;const walk=directory=>{for(const name of fs.readdirSync(directory)){const filename=path.join(directory,name),stat=fs.lstatSync(filename);if(stat.isDirectory())walk(filename);else{if(!stat.isFile()||stat.isSymbolicLink())throw Error('WORK_TYPE');bytes+=stat.size;files++;if(bytes>maximum)throw Error('WORK_LIMIT');}}};walk(root);return {bytes,files};
}
