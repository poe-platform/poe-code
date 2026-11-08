import fs from 'node:fs';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';

const root='/Users/kjopek/Workspace/safe-bash';
const base=root+'/tests/integration/agent-bash-coherent-b2-preflight-20260829/completion-r6/';
const own=root+'/tests/integration/agent-bash-coherent-b2-independent-20260829/completion-r6-review/activation-review-v1/';
const hash=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const observations=[];
function text(filename,expected,maximum=1048576){
  const stat=fs.lstatSync(filename);assert(stat.isFile()&&!stat.isSymbolicLink());assert(stat.size<=maximum);
  const bytes=fs.readFileSync(filename);assert.equal(bytes.length,stat.size);
  const digest=hash(bytes);if(expected)assert.equal(digest,expected);
  observations.push({path:filename,bytes:bytes.length,sha256:digest,mode:stat.mode&511});
  return bytes.toString('utf8');
}
async function streamed(row){
  const filename=row.path??row.filename;const stat=fs.lstatSync(filename);assert(stat.isFile());assert.equal(stat.size,row.bytes);
  const digest=crypto.createHash('sha256');let bytes=0;
  for await(const chunk of fs.createReadStream(filename,{highWaterMark:65536})){bytes+=chunk.length;assert(bytes<=row.bytes);digest.update(chunk);}
  assert.equal(bytes,row.bytes);assert.equal(digest.digest('hex'),row.sha256);observations.push({path:filename,...row,mode:stat.mode&511});
}
const receipt=JSON.parse(text(base+'final-binding-v1/FINAL-RECEIPT.json','32ecaf2ebdde79e196ccbaaed3d23732b617af9eb29367f55928b2f3e4ac83bf'));
const binding=JSON.parse(text(base+'final-binding-v1/BINDING.json','93e0c490859f6b9957f36bda7bbcb2a7a59387cebdd9bdf68506fdf755a7c06e'));
text(own+'../RECEIPT.json','7d4e01900cd8630d2331a237283c7e6e43bfad5e00080d8099f3cbddca67a897');
const grantText=text(receipt.grant.path,receipt.grant.sha256);assert.equal(Buffer.byteLength(grantText),1009);assert.equal(fs.lstatSync(receipt.grant.path).mode&511,384);
assert.equal(text(base+'final-binding-v1/B2-R6-ROOT-GO.json',receipt.grant.sha256),grantText);
const rawGrant=JSON.parse(grantText);assert.equal(rawGrant.reviewCommit,'bab8cae4da9bdb780ad26c4123451df2549cc1c6');
const packet=JSON.parse(text(base+'staged/PACKET.json',receipt.packet.sha256));assert.equal(packet.files.length,30);
for(const row of packet.files){assert(!row.path.includes('..')&&!row.path.startsWith('/'));await streamed({...row,path:base+'staged/'+row.path});}
assert.equal(binding.consumedPins.length,10);for(const row of binding.consumedPins)await streamed(row);
assert.equal(binding.tools.length,4);for(const row of binding.tools)await streamed(row);
await streamed(packet.package);
const unused=['/private/tmp/safe-bash-b2-runtime-r6','/private/tmp/safe-bash-b2-runtime-r6.outer.raw'];
function absent(){for(const filename of unused){let failure;try{fs.lstatSync(filename);}catch(error){failure=error;}assert.equal(failure?.code,'ENOENT');}}
absent();
const {grant}=await import(pathToFileURL(base+'staged/new/support.mjs'));
const {clock}=await import(pathToFileURL(base+'staged/new/owner.mjs'));
const anchor=Date.parse(rawGrant.notBefore),latest=Date.parse('2026-08-29T15:20:12.109Z');
assert.throws(()=>grant(rawGrant,anchor-1));
const checks=[];
for(const [name,now,active,total] of [['anchor',anchor,1620000,1800000],['external-latest',latest,1320000,1500000]]){
  const before=performance.now();const selected=grant(rawGrant,now);const after=performance.now();
  assert(selected.started>=before-(now-anchor)&&selected.started<=after-(now-anchor));
  const selectedClock=clock(selected.started,()=>selected.started+(now-anchor));
  assert.equal(selectedClock.remaining(),active);assert.equal(selectedClock.publication(),total);
  checks.push({name,activeMs:active,totalMs:total,publicationReserveMs:total-active});
}
assert.throws(()=>grant(rawGrant,Date.parse(rawGrant.activeDeadline)));
const coordinator=text(base+'staged/new/coordinator.mjs');
assert(coordinator.includes('started: authority.started')||coordinator.includes('started:authority.started'));
assert.equal(rawGrant.caps.knownOsStarts,64);assert.equal(rawGrant.caps.peakOs,3);
assert.equal(rawGrant.caps.rawBytes,96*1024*1024);assert.equal(rawGrant.caps.workBytes,512*1024*1024);
assert.equal(rawGrant.caps.loaderAdmissions,34);assert.equal(rawGrant.caps.regexWorkers,0);assert.equal(rawGrant.caps.guestEngines,0);
absent();
for(const row of [...observations])await streamed({...row});
const result={status:'ACCEPT_FINAL_SLOT_ONLY',utc:new Date().toISOString(),packetFiles:30,consumedPins:10,tools:4,timingChecks:checks,earlyAndActiveBoundaryRejected:true,unused,command:receipt.command,observations:observations.slice(0,observations.length/2),actualRuntime:false,externalLatestNotValidatorEnforced:true};
fs.writeFileSync(own+'RESULT.json',JSON.stringify(result,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({status:result.status,utc:result.utc,packetFiles:30,consumedPins:10,tools:4,timingChecks:checks}));
