import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
export function descriptor(sourcePath,row,expectedRelative){
 assert.equal(typeof sourcePath,'string');assert.ok(path.isAbsolute(sourcePath));assert.equal(path.normalize(sourcePath),sourcePath);
 assert.ok(row!==null&&typeof row==='object');assert.ok(!Object.hasOwn(row,'sourcePath'));assert.equal(row.type,'file');assert.equal(row.path,expectedRelative);
 assert.ok(!path.isAbsolute(expectedRelative)&&expectedRelative.split('/').every(part=>part&&part!=='.'&&part!=='..'));
 assert.ok(Number.isSafeInteger(row.bytes)&&row.bytes>=0);assert.match(row.sha256,/^[0-9a-f]{64}$/);
 return{sourcePath,relativePath:expectedRelative,type:'file',bytes:row.bytes,sha256:row.sha256};
}
export function readDescriptor(identity,maximum,onOpen=()=>{}){
 assert.ok(path.isAbsolute(identity.sourcePath));assert.equal(path.normalize(identity.sourcePath),identity.sourcePath);
 const before=fs.lstatSync(identity.sourcePath);assert.ok(before.isFile()&&!before.isSymbolicLink());assert.equal(before.size,identity.bytes);assert.ok(before.size<=maximum);
 onOpen();const fd=fs.openSync(identity.sourcePath,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);
 try{const opened=fs.fstatSync(fd);assert.equal(opened.ino,before.ino);assert.equal(opened.dev,before.dev);const bytes=Buffer.alloc(before.size);let cursor=0;while(cursor<bytes.length){const count=fs.readSync(fd,bytes,cursor,bytes.length-cursor,cursor);assert.ok(count>0);cursor+=count;}const after=fs.fstatSync(fd);assert.equal(after.size,before.size);assert.equal(after.mtimeMs,before.mtimeMs);assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'),identity.sha256);return bytes;}finally{fs.closeSync(fd);}
}
