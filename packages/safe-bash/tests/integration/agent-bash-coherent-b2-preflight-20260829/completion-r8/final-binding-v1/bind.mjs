import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
const base=process.argv[2],capture=process.argv[3],output=path.join(base,'final-binding-v1');
const sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const checked=[];
function auth(filename, expected) {
  const stat=fs.lstatSync(filename);assert(stat.isFile()&&!stat.isSymbolicLink());assert.equal(stat.size,expected.bytes);
  const digest=crypto.createHash('sha256'),fd=fs.openSync(filename,'r'),buffer=Buffer.alloc(65536);let total=0;
  try{for(;;){const count=fs.readSync(fd,buffer,0,buffer.length,null);if(!count)break;digest.update(buffer.subarray(0,count));total+=count;}}finally{fs.closeSync(fd);}
  assert.equal(total,expected.bytes);assert.equal(digest.digest('hex'),expected.sha256);checked.push({...expected,path:filename});
}
function save(name,value){const bytes=Buffer.from(JSON.stringify(value,null,2)+'\n');fs.writeFileSync(path.join(output,name),bytes,{flag:'wx',mode:0o600});return {path:path.join(output,name),bytes:bytes.length,sha256:sha(bytes)};}
const packetPath=path.join(base,'staged/PACKET.json');
auth(packetPath,{bytes:6945,sha256:'6df866e7990386218848061128777008bfbd6cdd93a7c0f658559fc0d0aa23f9'});
const packet=JSON.parse(fs.readFileSync(packetPath));assert.equal(packet.files.length,32);
for(const row of packet.files)auth(path.join(base,'staged',row.path),row);
auth(packet.package.path,packet.package);
const publisher=path.join(base,'publication-v2.mjs');const publisherStat=fs.lstatSync(publisher);
auth(publisher,{bytes:publisherStat.size,sha256:'f8ede5c4890135e0e68020cfc39007bd74f9d39d6402d6a31a6b031df2c9bf5f'});
const recipe=JSON.parse(fs.readFileSync(path.join(base,'staged/metadata/RECIPE.json')));
const toolsRoot='/private/tmp/safe-bash-coherent-stage-a-20260829-r2/tools/';
for(const filename of [recipe.compiler,recipe.npm]){const expected=recipe.toolInventory.find(row=>row.path===filename.slice(toolsRoot.length));assert(expected);auth(filename,expected);}
auth('/Users/kjopek/.nvm/versions/node/v22.22.2/bin/node',{bytes:112989184,sha256:'5c899797c4eb8f1db5563eea56538342ddb3e9276ee1b04a5a1f0f1023d2b011'});
const unused=['/private/tmp/safe-bash-b2-runtime-r8','/private/tmp/safe-bash-b2-runtime-r8.outer.raw','/private/tmp/B2-R8-ROOT-GO.json'];
const absent=filename=>{try{fs.lstatSync(filename);throw Error('occupied slot '+filename);}catch(error){if(error.code!=='ENOENT')throw error;}};
for(const filename of unused)absent(filename);
const original=JSON.parse(fs.readFileSync(path.join(base,'PENDING-AUTHORITY.json')));
assert.equal(original.reviewCommit,null);assert.equal(original.packetSha256,packet.files&&sha(fs.readFileSync(packetPath)));
const draft=structuredClone(original);draft.reviewCommit='a54f318dedf6e80edd3ac12887f9e50ae4bff758';draft.issuedAt=new Date().toISOString();draft.notBefore='2026-08-29T17:10:00.000Z';draft.activeDeadline='2026-08-29T17:37:00.000Z';draft.deadline='2026-08-29T17:40:00.000Z';
assert.deepEqual(Object.keys(draft),Object.keys(original));assert.equal(Date.parse(draft.deadline)-Date.parse(draft.notBefore),draft.caps.seconds*1000);assert.equal(Date.parse(draft.deadline)-Date.parse(draft.activeDeadline),draft.caps.reserveSeconds*1000);
assert.equal(draft.caps.knownOsStarts,64);assert.equal(draft.caps.workBytes,536870912);assert.equal(draft.mutableCacheAuthority,'ROOT_ACCEPTS_BEST_EFFORT_MUTABLE_CACHE_R8');
const grant=save('GRANT.pending.json',draft);
const command='/bin/zsh '+path.join(base,'staged/new/launch.sh')+' /private/tmp/B2-R8-ROOT-GO.json 6945';
for(const entry of [...checked])auth(entry.path,entry);
for(const filename of unused)absent(filename);
const result={schema:'B2-R8-CONDITIONAL-BINDING-1',status:'HOLD_WINDOW_POLICY',checkedUTC:new Date().toISOString(),grant,grantInstalled:false,actualGo:false,independentReview:draft.reviewCommit,command,commandSha256:sha(Buffer.from(command)),commandHashDomain:'UTF8 no trailing newline',cwd:'/Users/kjopek/Workspace/safe-bash',login:false,externalLatestStartUTC:'2026-08-29T17:10:00.000Z',schemaDerivedNotBeforeUTC:draft.notBefore,expiryUTC:draft.deadline,positiveWidthStartWindowMs:0,caps:draft.caps,unusedBeforeAfter:unused,pins:checked.slice(0,checked.length/2),cache:{reservationBytes:134217728,withinWorkBytes:536870912,sourceDerivedBound:false,activeSampling:'BEST_EFFORT_NONATOMIC',quiescentReconciliation:'REQUIRED',noKernelQuota:true},requiredRootDecision:'Choose an earlier anchored notBefore with earlier expiry, or later external latest with shrinking remaining time. Existing schema cannot offer full1800s from arbitrary started with fixed expiry. Do not change code or invent grant keys.'};
save('BINDING.json',result);fs.writeFileSync(path.join(capture,'RESULT.json'),JSON.stringify(result,null,2)+'\n',{flag:'wx'});process.stdout.write(JSON.stringify(result)+'\n');
