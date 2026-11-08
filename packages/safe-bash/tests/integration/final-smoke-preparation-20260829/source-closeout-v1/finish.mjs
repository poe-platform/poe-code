import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
export async function finish({read,cache,root,own,sha,started}){
  const descriptor=row=>({path:row.path,bytes:row.bytes,sha256:row.sha256});
  const base='tests/integration/final-smoke-preparation-20260829';
  const packetRecord=read(base+'/runnable-r5/PACKET.json');assert.equal(packetRecord.sha256,'4da24e5b3f8376885988e95d20287036df81e63eead1c8712f0d3a953e31bfba');const packet=JSON.parse(packetRecord.body);
  const bindingRecord=read(packet.binding.path,packet.binding),binding=JSON.parse(bindingRecord.body);
  const review=read(packet.producerReviewReceipt.path);assert.equal(review.sha256,'708f5ec08e39a86efa848699c3fb1c8fb840b6eb72df16e0885fae765877ea47');
  const tools=JSON.parse(read(binding.tools.path,binding.tools).body);const pins=packet.files.map(row=>descriptor(read(row.path,row)));
  const owner=pins.find(row=>row.path.endsWith('/tracked-owner.mjs')),trace=pins.find(row=>row.path.endsWith('/trace.mjs'));assert(owner&&trace);
  const ownFiles=['driver.mjs','npm-descriptor.mjs','finish.mjs'].map(name=>descriptor(read(path.join(own,name))));
  const preseal={action:'ROOT_SEPARATE_SOURCE_ONLY_8_CLOSEOUT',repoRoot:root,binding:descriptor(bindingRecord),producerReview:descriptor(review),files:[...pins,...ownFiles],consumerFiles:packet.consumerFiles,entry:packet.entry,loader:packet.loader,workerGuard:packet.workerGuard,owner,trace,node:{path:tools.node.path,bytes:tools.node.size,sha256:tools.node.sha256},ids:['C01','C02','C07','C12','C13','C14','R17','R16'],workRoot:'/private/tmp/final-smoke-source-closeout-v1',phaseStarted:started,phaseDeadline:Math.min(started+480000,Date.parse('2026-08-29T18:20:00Z')),layoutExecutionMs:90000,retirementMs:30000,guestRegexWorkers:0,asyncLoaders:1,old24:'UNRUN_UNCHANGED'};
  fs.writeFileSync(path.join(own,'PRESEAL.json'),JSON.stringify(preseal,null,2)+'\n',{flag:'wx'});
  const {validateLink,administrativeTime}=await import('./npm-descriptor.mjs');const links=tools.npm.rows.filter(row=>row.kind==='link');assert.equal(links.length,12);
  const results=[];function check(id,body){body();results.push({id,status:'PASS',role:'PURE_DATA_NO_NPM'});}
  check('strict-authenticated-link-schema',()=>links.forEach(row=>validateLink(row,tools.npm.root)));
  check('reject-alias-and-extra-shape',()=>{assert.throws(()=>validateLink({...links[0],kind:'symlink'},tools.npm.root));assert.throws(()=>validateLink({...links[0],extra:true},tools.npm.root));});
  check('target-and-hash-types',()=>{assert.throws(()=>validateLink({...links[0],target:'../outside'},tools.npm.root));assert.throws(()=>validateLink({...links[0],targetSha256:'wrong'},tools.npm.root));});
  check('UTC-epoch-not-local-label',()=>{assert.deepEqual(administrativeTime(1788026882359),{epochMs:1788026882359,utc:'2026-08-29T18:08:02.359Z'});assert.throws(()=>administrativeTime(NaN));});
  for(const row of cache.values()){assert.equal(fs.lstatSync(row.path).size,row.bytes);assert.equal(sha(fs.readFileSync(row.path)),row.sha256);}
  assert(Date.now()+180000<preseal.phaseDeadline,'remaining child plus publication margin');
  const bytes=fs.readFileSync(path.join(own,'PRESEAL.json'));fs.writeFileSync(path.join(own,'PREP-RESULT.json'),JSON.stringify({groups:results,preseal:{path:path.join(own,'PRESEAL.json'),bytes:bytes.length,sha256:sha(bytes)},endedUTC:new Date().toISOString(),phaseDeadlineUTC:new Date(preseal.phaseDeadline).toISOString(),actualAttempt:'NOT_STARTED',strictNpmAdapter:'SOURCE_ONLY_NEVER_INVOKED_BY_SOURCE_BATCH',oldFailurePreserved:true},null,2)+'\n',{flag:'wx'});
  return {groups:results.length,presealBytes:bytes.length,presealSha256:sha(bytes),phaseDeadlineUTC:new Date(preseal.phaseDeadline).toISOString(),endedUTC:new Date().toISOString()};
}
