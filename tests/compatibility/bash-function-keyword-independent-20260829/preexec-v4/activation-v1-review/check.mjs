import fs from 'node:fs';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
const own=fileURLToPath(new URL('.',import.meta.url));
console.log(JSON.stringify({phase:'binding-check-start',pid:process.pid,utc:new Date().toISOString()}));
const base=process.cwd()+'/tests/compatibility/bash-function-keyword-author-20260829/preexec-v4/';
const sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
function read(filename,max=2097152){const stat=fs.lstatSync(filename);assert(stat.isFile()&&stat.size<=max);return {bytes:fs.readFileSync(filename),mode:stat.mode&4095};}
function json(filename){return JSON.parse(new TextDecoder('utf8',{fatal:true}).decode(read(filename).bytes));}
function check(filename,pin){const file=read(filename);assert.equal(file.bytes.length,pin.bytes);assert.equal(sha(file.bytes),pin.sha256);if(pin.requiredMode)assert.equal(file.mode,parseInt(pin.requiredMode,8));return file.bytes;}
function stream(pin){const stat=fs.lstatSync(pin.path);assert(stat.isFile());assert.equal(stat.size,pin.bytes);assert.equal(stat.mode&4095,pin.mode);const fd=fs.openSync(pin.path,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW),hash=crypto.createHash('sha256'),buffer=Buffer.alloc(65536);let total=0;try{const opened=fs.fstatSync(fd);assert.equal(opened.ino,stat.ino);assert.equal(opened.dev,stat.dev);for(;;){const count=fs.readSync(fd,buffer,0,buffer.length,null);if(!count)break;total+=count;assert(total<=pin.bytes);hash.update(buffer.subarray(0,count));}}finally{fs.closeSync(fd);}assert.equal(total,pin.bytes);assert.equal(hash.digest('hex'),pin.sha256);}
try{
 const raw=read(own+'inventory.stdout').bytes;assert.equal(raw.at(-1),0);let inventory=0;for(const row of raw.subarray(0,-1).toString().split('\0')){const tab=row.indexOf('\t'),[mode,type,oid]=row.slice(0,tab).split(' '),name=row.slice(tab+1);assert(tab>0&&type==='blob');const file=read(name);assert.equal(file.mode,parseInt(mode,8)&4095);assert.equal(crypto.createHash('sha1').update(Buffer.from('blob '+file.bytes.length+'\0')).update(file.bytes).digest('hex'),oid);inventory++;}
 const binding=json(base+'activation-v1/BINDING.json'),authority=json(base+'activation-v1/ROOT-AUTHORIZATION.json');
 const presealHash='b4b562d5ce6673aea3f9d91c50b6697ebaf01f9b92ca8107265a84ff652edfa3';
 const preseal=JSON.parse(check(base+'PRESEAL.json',{bytes:9470,sha256:presealHash}));
 const exact=[['GO.json',991,'d483bbd28c5686e844b25bf56689538ad0a2720220d1cf1e18a8f065be9fef55'],['REVIEW.json',204,'34f4d2f65854f26968e3fe6a204432f060fef2c6628db51c2cce90a88b617d32'],['activation-v1/COMMAND.pending.txt',340,'477f1c1f142a40c906a4a7c666502e3fa07a23f9c2fd8910d12262c1f1900f8f']];
 for(const [name,bytes,sha256]of exact)check(base+name,{bytes,sha256,requiredMode:name.includes('/')?undefined:'0600'});
 for(const pin of binding.bindings)check(pin.path,pin);
 for(const [name,pin]of Object.entries(preseal.files))check(base+name,pin);
 for(const pin of [preseal.node,preseal.envExecutable,preseal.canonicalBootstrap.zsh,preseal.originalPackage])stream(pin);
 const tools=json(base+'TOOLS.json');let toolRows=0;for(const pkg of tools.packages){assert.equal(fs.realpathSync(pkg.origin),pkg.resolved);for(const row of pkg.rows){assert(!row.path.split('/').includes('..'));stream({...row,path:pkg.resolved+'/'+row.path});toolRows++;}}assert.equal(toolRows,247);
 const review=json(base+'REVIEW.json'),grant=json(base+'GO.json');assert.deepEqual(Object.keys(review),['decision','preseal','scope','independentCommit']);assert.equal(review.independentCommit,'556fc7efba79497fc64b8b8ce537b5d265dde266');assert.equal(review.preseal,presealHash);assert.equal(review.scope,'b35-preexec-v3');
 check(authority.independent.path,authority.independent);assert.notEqual(sha(read(base+'REVIEW.json').bytes),authority.independent.sha256);
 const activation=check(base+'activation.mjs',preseal.files['activation.mjs']);fs.writeFileSync(own+'activation.mjs',activation,{flag:'wx',mode:384});
 const {validateActivation}=await import('./activation.mjs');const now=Date.now();const validated=validateActivation(grant,review,{preseal:presealHash,work:preseal.work,limits:preseal.limits,roles:preseal.roles,started:now,now});
 assert.equal(new Date(grant.issuedAtEpochMs).toISOString(),'2026-08-29T14:00:06.737Z');assert.equal(new Date(grant.latestStartEpochMs).toISOString(),'2026-08-29T14:20:06.737Z');assert.equal(new Date(grant.expiresEpochMs).toISOString(),'2026-08-29T14:45:06.737Z');
 assert.equal(authority.futurePrepublicationMeasuredRoleCount.state,'PENDING_ACTUAL_OBSERVATION');for(const key of ['runtimeKnownStarts','administrativeKnownStarts','totalKnownStarts','allKnownRetired'])assert.equal(authority.futurePrepublicationMeasuredRoleCount[key],null);
 assert.equal(fs.realpathSync(preseal.work),preseal.work);let paths=0;const emptyTree=[];function walk(root){for(const name of fs.readdirSync(root)){assert(++paths<=64);const path=root+'/'+name,stat=fs.lstatSync(path);assert(stat.isDirectory());emptyTree.push(path.slice(preseal.work.length+1));walk(path);}}walk(preseal.work);assert.deepEqual(fs.readdirSync(preseal.work+'/capture'),[]);
 const command=read(base+'activation-v1/COMMAND.pending.txt').bytes.toString();assert.equal(command,`exec /bin/zsh -f '${base}launch.sh' '9470' '${presealHash}' '${exact[0][2]}' '${exact[1][2]}'\n`);
 const result={decision:'ACCEPT',scope:'FINAL_SLOT_DATA_ONLY_NOT_ACTUAL_GO',utc:new Date().toISOString(),inventory,sourcePins:Object.keys(preseal.files).length,toolRows,toolBinaries:3,packageAuthenticated:true,activationFourFields:true,richReceiptSeparate:true,remainingStartMs:grant.latestStartEpochMs-Date.now(),window:{issued:'2026-08-29T14:00:06.737Z',latestStart:'2026-08-29T14:20:06.737Z',expires:'2026-08-29T14:45:06.737Z'},validationAtNow:validated,workEmptyDirectories:emptyTree,measuredFutureRoles:'UNKNOWN_PENDING',actualCalls:0,roles:preseal.roles,limits:preseal.limits,command};
 fs.writeFileSync(own+'RESULT.json',JSON.stringify(result,null,2)+'\n',{flag:'wx',mode:384});console.log(JSON.stringify({decision:result.decision,inventory,sourcePins:result.sourcePins,toolRows,remainingStartMs:result.remainingStartMs,actualCalls:0}));
}catch(reason){console.error(reason.stack??reason);process.exitCode=1;}
