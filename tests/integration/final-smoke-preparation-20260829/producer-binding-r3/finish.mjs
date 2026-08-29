import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
export async function finish({read,cache,root,own,sha,started}){
  const base='tests/compatibility/final-coherent-producer-20260829';
  const descriptor=record=>({path:record.path,bytes:record.bytes,sha256:record.sha256});
  const dataRecord=read(base+'/DATA-RECEIPT.json');assert.equal(dataRecord.sha256,'d8451028627a01651e4fadf648147c15a39ef04e643dfa2e48a0259be385a50e');
  const data=JSON.parse(dataRecord.body);
  const producerRecord=read(base+'/PRODUCER-RECEIPT.json');assert.equal(producerRecord.sha256,data.producerReceiptSha256);
  const producer=JSON.parse(producerRecord.body);
  const presealRecord=read(base+'/PRESEAL.json',producer.preseal),preseal=JSON.parse(presealRecord.body);
  const source=read(base+'/SOURCE-INPUTS.json',producer.sourceSeal);
  const tools=read(base+'/TOOLS.json',producer.toolsSeal);
  const shippingRecord=read(base+'/SHIPPING.json',data.shipManifest),shipping=JSON.parse(shippingRecord.body);
  const emitsRecord=read(base+'/EMITS.json'),emits=JSON.parse(emitsRecord.body);
  assert.equal(emits.count,data.emitCount);assert.equal(emits.rows.length,emits.count);assert.equal(shipping.count,data.shippingCount);assert.equal(shipping.members.length,shipping.count);
  const compressed=read(data.archive.path,data.archive);assert.equal(compressed.bytes,974493);
  assert.equal(compressed.sha256,'de8741c1be9c870650e92944020fa2785114b7046ef1774af2c27ea79238e17a');
  const members=shipping.members.map(row=>({path:row.path,bytes:row.size,mode:row.mode,sha256:row.sha256}));
  const previous='tests/integration/agent-bash-coherent-b2-preflight-20260829/completion-r8/staged';
  const packetRecord=read(previous+'/PACKET.json');assert.equal(packetRecord.sha256,'6df866e7990386218848061128777008bfbd6cdd93a7c0f658559fc0d0aa23f9');
  const packet=JSON.parse(packetRecord.body),helperNames=['new/tar.mjs','legacy/stage-a-r2/common.mjs','new/loader.mjs','new/trace.mjs','new/support.mjs','new/cache-census.mjs'];
  const helpers=helperNames.map(name=>{const identity=packet.files.find(row=>row.path===name);assert(identity);return descriptor(read(previous+'/'+name,identity));});
  const ownPins=['admission.mjs','worker-denial.mjs','entry.mjs','finish.mjs'].map(name=>descriptor(read(path.join(own,name))));
  const controls=['same-buffer-before-decode','wrong-size-before-open','wrong-hash-before-consumption','symlink-before-open','exact-installed-mode','wrong-umask-or-archive-mode'];
  fs.writeFileSync(path.join(own,'PRESEAL.json'),JSON.stringify({schema:'FINAL_SMOKE_PRODUCER_BINDING_R3_PREPARATION',producer:descriptor(producerRecord),data:descriptor(dataRecord),archive:descriptor(compressed),source:descriptor(source),tools:descriptor(tools),shipping:descriptor(shippingRecord),emits:descriptor(emitsRecord),helpers,ownPins,controls,independentProducerReview:'PENDING',actualGo:false},null,2)+'\n',{flag:'wx'});
  const {admitFile,deriveHostMembers}=await import('./admission.mjs');
  const {unpackVerified}=await import(path.resolve(root,previous,'new/tar.mjs'));
  const outcomes=[];
  const same=admitFile(data.archive,1048576);unpackVerified(same,members);outcomes.push({id:controls[0],status:'PASS',role:'ACTUAL_DATA_DECODE_NO_PRODUCT'});
  let opens=0;const noOpen={lstatSync:()=>({isFile:()=>true,isSymbolicLink:()=>false,size:2}),openSync(){opens++;throw new Error('must not open');}};
  assert.throws(()=>admitFile({path:'/inert',bytes:1,sha256:'0'.repeat(64)},10,noOpen));assert.equal(opens,0);outcomes.push({id:controls[1],status:'PASS',role:'PURE_IO'});
  assert.throws(()=>admitFile({...data.archive,sha256:'0'.repeat(64)},1048576));outcomes.push({id:controls[2],status:'PASS',role:'DATA_REFUSAL_NO_DECODE'});
  assert.throws(()=>admitFile({path:'/inert',bytes:1,sha256:'0'.repeat(64)},10,{...noOpen,lstatSync:()=>({isFile:()=>true,isSymbolicLink:()=>true,size:1})}));assert.equal(opens,0);outcomes.push({id:controls[3],status:'PASS',role:'PURE_IO'});
  assert(deriveHostMembers(members,0o077,true).every(row=>row.mode===0o600));assert.deepEqual(deriveHostMembers(members,0o077,false),members);outcomes.push({id:controls[4],status:'PASS',role:'PURE_MODES'});
  assert.throws(()=>deriveHostMembers(members,0o022,true));assert.throws(()=>deriveHostMembers(members.map((row,index)=>index?row:{...row,mode:0o755}),0o077,true));outcomes.push({id:controls[5],status:'PASS',role:'PURE_MODES'});
  const memberMap=new Map(members.map(row=>[row.path,row]));
  for(const row of emits.rows){const member=memberMap.get('dist/'+row.path);assert(member);assert.equal(member.sha256,row.sha256);assert.equal(member.bytes,row.size);}
  const sourceRoot=preseal.procedure.sourceRoot;
  const selectedActual=[];
  for(const row of members){const filename=path.join(sourceRoot,row.path),stat=fs.lstatSync(filename);assert(stat.isFile()&&!stat.isSymbolicLink());assert.equal(stat.size,row.bytes);const bytes=fs.readFileSync(filename);assert.equal(sha(bytes),row.sha256);assert.equal(stat.mode&0o777,row.mode);selectedActual.push({path:filename,bytes:row.bytes,sha256:row.sha256,mode:row.mode});}
  const pkgRecord=read(path.join(sourceRoot,'package.json'),memberMap.get('package.json')),pkg=JSON.parse(pkgRecord.body);
  for(const hook of ['preinstall','install','postinstall','prepare'])assert.equal(pkg.scripts?.[hook],undefined);
  const fixture=read('tests/integration/agent-bash-coherent-author-20260829/v2/NEUTRAL-FIXTURE.json');assert.equal(fixture.sha256,'fcb7bae1505a86b2b676396742d7bf362ad779c77192770ed94085646f8d0074');
  const scripts=read('tests/integration/agent-bash-coherent-author-20260829/v4/workflows.mjs');assert.equal(scripts.sha256,'6d8a19854a6e96986013ed3d94ee15dd774e225259dea922bf4749799c60d89b');
  const scalar=read('tests/shell/pipestatus-author-20260829/runtime-cases.json');assert.equal(scalar.sha256,'9ece84f2f5cc4a4916d7deab4a173e17dc4fb5d3b5240267e54adf252d310806');
  const sums={archive:compressed.bytes,sourceBuiltCopy:shipping.logicalBytes,installed:shipping.logicalBytes,movedAdditionalCopy:0,cacheReserve:134217728,captureReserve:67108864,helperAndMetadataReserve:33554432,publicationReserve:16777216,decodeReserve:67108864};
  const fit=Object.values(sums).reduce((total,value)=>total+value,0);assert(fit<536870912);
  const futureRoot='/private/tmp/final-coherent-smoke-r3-20260829';assert(!fs.existsSync(futureRoot));
  const binding={schema:'FINAL_SMOKE_PRODUCER_BOUND_PREPARATION_R3',sourceCount:data.sourceCount,emittedCount:emits.count,shippingCount:shipping.count,producer:descriptor(producerRecord),data:descriptor(dataRecord),archive:descriptor(compressed),sourceRoot,source:descriptor(source),tools:descriptor(tools),emits:descriptor(emitsRecord),shipping:descriptor(shippingRecord),members,actualProducerFiles:selectedActual,fixture:descriptor(fixture),workflows:descriptor(scripts),scalarRows:descriptor(scalar),futureRoot,installerUmask:63,installedMode:384,sourceMode:420,limits:{knownOS:40,peak:3,seconds:1200,publicationSeconds:180,captureBytes:67108864,sampledWorkBytes:536870912,asyncLoaders:3,peakAsyncLoaders:1,guestWorkers:0,regexWorkers:0},fit:{sums,total:fit,headroom:536870912-fit,qualification:'prospective reserved logical fit; actual cache/post-close observations and all owned outputs remain mandatory'},independentProducerReview:'PENDING',activation:'NOT_AUTHORIZED',node:preseal.procedure.commands.pack.executable,npm:preseal.procedure.commands.pack.args[0],helpers,ownPins};
  fs.writeFileSync(path.join(own,'BINDING.json'),JSON.stringify(binding,null,2)+'\n',{flag:'wx'});
  for(const row of cache.values()){const stat=fs.lstatSync(row.path);assert(stat.isFile()&&!stat.isSymbolicLink());assert.equal(stat.size,row.bytes);assert.equal(sha(fs.readFileSync(row.path)),row.sha256);}
  assert(Date.now()-started<390000);
  const result={status:'ARTIFACT_AND_SOURCE_BINDING_READY_EXECUTABLE_ASSEMBLY_INCOMPLETE',outcomes,sourceFilesAuthenticated:selectedActual.length,sourceCount:data.sourceCount,emits:emits.count,members:shipping.count,package:descriptor(compressed),fit:binding.fit,startedUTC:new Date(started).toISOString(),endedUTC:new Date().toISOString(),productExecutions:0,loaderExecutions:0,childSpawns:0,independentProducerReview:'PENDING',blockers:['Final captured entry/whole-helper import-member map and callback implementation remain unsealed; coordinator source alone is not a runnable envelope','Per-case30s teardown ownership is not established by existing beforeCase headroom check; no actual per-case timer/cleanup proof','Existing r2 validator requires fixed1200s anchor1020+180. Shrinking-window semantics require explicit versioned binding; no new window issued']};
  const body=Buffer.from(JSON.stringify(result,null,2)+'\n');fs.writeFileSync(path.join(own,'RESULT.json'),body,{flag:'wx'});
  fs.writeFileSync(path.join(own,'HANDOFF.md'),`# Final smoke producer binding r3\n\n6/6 DATA/PURE admission controls. Authenticated archive974493B/de8741c1; same admitted Buffer decoded against producer1070 members. Genuine producer source shipping files1070 separately hash/mode checked, including1068 emissions. Selected source323 derives from producer receipt, not old source/count. No product/compiler/install/loader/Worker execution.\n\nBINDING.json records exact source/manifests/archive/tool-seal/fixture paths and future absent ownedroot. Installed/moved host modes derive0644 & ~077 =0600 only for this authenticated all0644 archive and pinned installer. Source0644 unchanged. Fit reservation ${fit}B within512MiB; this is prospective logical accounting, not observed npm peak/kernel enforcement.\n\nROOT producer independent review remains PENDING. Full runnable admission is NOT sealed: whole helper/member graph and materialization/retirement callback wiring remain; beforeCase only proves headroom, not an actual30s case teardown bound. Fixed r2 clock1020+180 cannot silently become a shrinking latest+10/expiry+20 protocol. No window or actual command is claimed ready. New entry/worker-denial source is UNEXECUTED and awaits its complete loader member binding; historical sources untouched.\n\nRESULT ${body.length}B SHA256 ${sha(body)}. Preparation stopped at this bounded checkpoint rather than claiming final executable acceptance. All24 scripts/oracles remain unchanged and UNRUN.\n`,{flag:'wx'});
  return {status:result.status,groups:outcomes.length,resultSha256:sha(body),bindingSha256:sha(fs.readFileSync(path.join(own,'BINDING.json'))),endedUTC:result.endedUTC};
}
