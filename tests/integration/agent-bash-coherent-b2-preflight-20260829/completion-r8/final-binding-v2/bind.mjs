import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';

const base=process.argv[2],capture=process.argv[3],output=path.join(base,'final-binding-v2');
const sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const pins=[];
function verify(filename, expected) {
  assert(path.isAbsolute(filename));
  const stat=fs.lstatSync(filename);assert(stat.isFile()&&!stat.isSymbolicLink());assert.equal(stat.size,expected.bytes);
  const fd=fs.openSync(filename,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW),buffer=Buffer.alloc(65536),hash=crypto.createHash('sha256');let total=0;
  try {
    const opened=fs.fstatSync(fd);assert.equal(opened.dev,stat.dev);assert.equal(opened.ino,stat.ino);
    for(;;){const count=fs.readSync(fd,buffer,0,buffer.length,null);if(!count)break;total+=count;hash.update(buffer.subarray(0,count));}
    const after=fs.fstatSync(fd);assert.equal(after.size,opened.size);assert.equal(after.mtimeMs,opened.mtimeMs);
  } finally {fs.closeSync(fd);}
  assert.equal(total,expected.bytes);assert.equal(hash.digest('hex'),expected.sha256,filename);
  return {...expected,path:filename};
}
function admit(filename,expected){const pin=verify(filename,expected);pins.push(pin);return pin;}
function save(name,value) {
  const bytes=Buffer.from(JSON.stringify(value,null,2)+'\n'),filename=path.join(output,name);
  const fd=fs.openSync(filename,'wx',0o600);
  try {let offset=0;while(offset<bytes.length){const count=fs.writeSync(fd,bytes,offset,bytes.length-offset);assert(count>0);offset+=count;}}finally{fs.closeSync(fd);}
  assert.equal(fs.lstatSync(filename).mode&0o777,0o600);
  const pin={path:filename,bytes:bytes.length,sha256:sha(bytes)};verify(filename,pin);return pin;
}
const packetPath=path.join(base,'staged/PACKET.json');
admit(packetPath,{bytes:6945,sha256:'6df866e7990386218848061128777008bfbd6cdd93a7c0f658559fc0d0aa23f9'});
const packet=JSON.parse(fs.readFileSync(packetPath));assert.equal(packet.files.length,32);assert.equal(packet.source,'3adc676a0ab638c9788ef007e465931d65d2c6fe');assert.equal(packet.retained,672);assert.equal(packet.roleCount,41);
for(const entry of packet.files)admit(path.join(base,'staged',entry.path),entry);
admit(packet.package.path,packet.package);
const frozen=JSON.parse(fs.readFileSync(path.join(base,'staged/metadata/FROZEN-BINDINGS.json')));
assert.equal(frozen.selectedInputs.length,309);assert.equal(frozen.actualEmitted.length,1012);assert.equal(frozen.packageMembers.length,1014);
const publisher=path.join(base,'publication-v2.mjs'),publisherStat=fs.lstatSync(publisher);assert(publisherStat.size<131072);
admit(publisher,{bytes:publisherStat.size,sha256:'f8ede5c4890135e0e68020cfc39007bd74f9d39d6402d6a31a6b031df2c9bf5f'});
const recipe=JSON.parse(fs.readFileSync(path.join(base,'staged/metadata/RECIPE.json'))),toolsRoot='/private/tmp/safe-bash-coherent-stage-a-20260829-r2/tools/';
for(const filename of [recipe.compiler,recipe.npm]){assert(filename.startsWith(toolsRoot));const expected=recipe.toolInventory.find(entry=>entry.path===filename.slice(toolsRoot.length));assert(expected);admit(filename,expected);}
admit('/Users/kjopek/.nvm/versions/node/v22.22.2/bin/node',{bytes:112989184,sha256:'5c899797c4eb8f1db5563eea56538342ddb3e9276ee1b04a5a1f0f1023d2b011'});
const absentSlots=['/private/tmp/safe-bash-b2-runtime-r8','/private/tmp/safe-bash-b2-runtime-r8.outer.raw','/private/tmp/B2-R8-ROOT-GO.json'];
function absent(filename){try{fs.lstatSync(filename);throw Error('SLOT_OCCUPIED '+filename);}catch(error){if(error.code!=='ENOENT')throw error;}}
for(const filename of absentSlots)absent(filename);
const original=JSON.parse(fs.readFileSync(path.join(base,'PENDING-AUTHORITY.json')));
assert.equal(original.schema,'B2_RUNTIME_GO_R8');assert.equal(original.reviewCommit,null);assert.equal(original.authority,'ROOT_B2_672_EXPLICIT_FRESH_GO');assert.equal(original.reviewAuthority,'INDEPENDENT_PREEXEC_REVIEW_ACCEPTED');assert.equal(original.packetSha256,sha(fs.readFileSync(packetPath)));assert.equal(original.mutableCacheAuthority,'ROOT_ACCEPTS_BEST_EFFORT_MUTABLE_CACHE_R8');
const caps={seconds:1800,reserveSeconds:180,knownOsStarts:64,peakOs:3,rawBytes:100663296,childRawBytes:67108864,workBytes:536870912,terminalReserveBytes:4194304,traceBytesPerRole:524288,loaderAdmissions:34,regexWorkers:0,regexLoaderAdmissions:0,guestEngines:0,loaderThreads:34,peakLoaderThreads:1,decoderBytes:67108864,maximumInventoryEntries:16384};
assert.deepEqual(original.caps,caps);
const draft={...original,reviewCommit:'a54f318dedf6e80edd3ac12887f9e50ae4bff758',issuedAt:new Date().toISOString(),notBefore:'2026-08-29T17:00:00.000Z',activeDeadline:'2026-08-29T17:27:00.000Z',deadline:'2026-08-29T17:30:00.000Z'};
assert.deepEqual(Object.keys(draft),Object.keys(original));
const latest='2026-08-29T17:05:00.000Z';
assert(Date.parse(draft.issuedAt)<Date.parse(draft.notBefore));assert.equal(Date.parse(draft.deadline)-Date.parse(draft.notBefore),1800000);assert.equal(Date.parse(draft.deadline)-Date.parse(draft.activeDeadline),180000);assert.equal(Date.parse(draft.deadline)-Date.parse(latest),1500000);
const grant=save('GRANT.pending.json',draft);
for(const pin of pins)verify(pin.path,pin);
for(const filename of absentSlots)absent(filename);
const command='/bin/zsh '+path.join(base,'staged/new/launch.sh')+' /private/tmp/B2-R8-ROOT-GO.json 6945';
const result={schema:'B2-R8-FINAL-BINDING-2',status:'READY_FOR_DIFFERENT_FINAL_BINDING_REVIEW_NO_ACTUAL_GO',checkedUTC:new Date().toISOString(),previousFailure:'9f3d9efa02f78ed5d1c540e5f9f19e4dcc222da6',independentPreexec:draft.reviewCommit,grant,grantInstalled:false,actualGo:false,command,commandSha256:sha(Buffer.from(command)),commandHashDomain:'UTF8 without trailing newline',cwd:'/Users/kjopek/Workspace/safe-bash',login:false,window:{issuedAt:draft.issuedAt,notBefore:draft.notBefore,externalLatestStart:latest,activeDeadline:draft.activeDeadline,deadline:draft.deadline,remainingSecondsAtLatest:1500,publicationReserveSeconds:180,remainingActiveSecondsAtLatest:1320},caps,roles:{owner:1,children:41,administration:22},pins,postguardCount:pins.length,absentSlotsBeforeAfter:absentSlots,cache:{reservationBytes:134217728,includedWithinWorkBytes:536870912,sourceDerivedUpperBound:false,activeSampling:'BEST_EFFORT_NONATOMIC_NOT_PEAK_PROOF',quiescentReconciliation:'REQUIRED',kernelQuota:false},qualification:'Only consumed pin/entry verification, not full tool or source recensus. No runtime, npm, compiler, Worker, native or archive decoding. Fixed deadlines may leave UNRUN cases; no full1800from delayed dispatch claim.'};
save('BINDING.json',result);fs.writeFileSync(path.join(capture,'RESULT.json'),JSON.stringify(result,null,2)+'\n',{flag:'wx',mode:0o600});process.stdout.write(JSON.stringify({status:result.status,grant,commandSha256:result.commandSha256,pins:pins.length,postguards:pins.length,window:result.window})+'\n');
