import fs from 'node:fs';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
export function admitFile(identity, maximum, io = fs) {
  assert(identity && typeof identity.path === 'string' && identity.path.startsWith('/'));
  assert(Number.isSafeInteger(identity.bytes) && identity.bytes >= 0 && identity.bytes <= maximum);
  assert.match(identity.sha256,/^[0-9a-f]{64}$/);
  const before=io.lstatSync(identity.path);assert(before.isFile()&&!before.isSymbolicLink());assert.equal(before.size,identity.bytes);
  const fd=io.openSync(identity.path,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);
  let body;
  try{
    const opened=io.fstatSync(fd);assert.equal(opened.ino,before.ino);assert.equal(opened.dev,before.dev);assert.equal(opened.size,before.size);
    body=Buffer.alloc(identity.bytes);
    let offset=0;while(offset<body.length){const count=io.readSync(fd,body,offset,body.length-offset,offset);assert(Number.isSafeInteger(count)&&count>0&&count<=body.length-offset);offset+=count;}
    const after=io.fstatSync(fd);assert.equal(after.size,before.size);assert.equal(after.mtimeMs,before.mtimeMs);
  }finally{io.closeSync(fd);}
  assert.equal(crypto.createHash('sha256').update(body).digest('hex'),identity.sha256);
  return body;
}
export function deriveHostMembers(members, umask, installed) {
  assert(Array.isArray(members));assert.equal(new Set(members.map(row=>row.path)).size,members.length);
  if(!installed)return members.map(row=>({...row}));
  assert.equal(umask,0o077);for(const row of members)assert.equal(row.mode,0o644);
  return members.map(row=>({...row,mode:row.mode&~umask}));
}
