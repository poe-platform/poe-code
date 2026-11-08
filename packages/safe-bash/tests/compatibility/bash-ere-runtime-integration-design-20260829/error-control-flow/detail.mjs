import fs from 'node:fs';
import crypto from 'node:crypto';
const path='/tmp/safe-bash-reference-source-20260829-fn91Rw/bash-5.3/parse.y';
const stat=fs.lstatSync(path);
if(!stat.isFile() || stat.isSymbolicLink() || stat.size!==217136) throw new Error('source admission');
const descriptor=fs.openSync(path,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);
let bytes;
try { const opened=fs.fstatSync(descriptor); if(opened.ino!==stat.ino || opened.dev!==stat.dev) throw new Error('inode'); bytes=fs.readFileSync(descriptor); } finally {fs.closeSync(descriptor);}
if(crypto.createHash('sha256').update(bytes).digest('hex')!=='076a16d00c5b065137b3d2730d2b94a1f6c89a1bbb5d2f4bd72d31e00947e27f') throw new Error('source hash');
const lines=new TextDecoder('utf8',{fatal:true}).decode(bytes).split('\n');
console.log(lines.slice(5094,5124).map((line,index)=>`${index+5095}:${line}`).join('\n'));
