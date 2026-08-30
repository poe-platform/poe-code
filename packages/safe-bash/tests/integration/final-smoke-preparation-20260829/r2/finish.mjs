import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
export async function finish({read,cache,root,own,sha,started}) {
  const prefix='tests/integration/final-smoke-preparation-20260829';
  const review=read('tests/integration/final-smoke-independent-20260829/preexec-v1/RESULT.json');
  assert.equal(review.sha256,'2037604aaf69a5b149f6f2e2f0d1d8de1f1f19aebee7061e0eb28d622f4e6a97');
  const oldSeal=JSON.parse(read(prefix+'/PRESEAL.json').body);
  const stage='tests/integration/agent-bash-coherent-b2-preflight-20260829/completion-r8/staged';
  const packetRecord=read(stage+'/PACKET.json');
  assert.equal(packetRecord.sha256,'6df866e7990386218848061128777008bfbd6cdd93a7c0f658559fc0d0aa23f9');
  const packet=JSON.parse(packetRecord.body);
  const dependencies=['new/loader.mjs','new/trace.mjs','new/support.mjs','new/cache-census.mjs'];
  const pins=[];
  for(const name of dependencies){const identity=packet.files.find(row=>row.path===name);assert(identity);const record=read(stage+'/'+name);assert.equal(record.bytes,identity.bytes);assert.equal(record.sha256,identity.sha256);pins.push({...identity,absolute:record.path});}
  const tracePath=path.resolve(root,stage,'new/trace.mjs');
  const traceSource=read(stage+'/new/trace.mjs').body.toString();
  assert(!traceSource.includes('fsync'));assert(!traceSource.includes('appendFile'));assert(traceSource.includes('trace write must make valid progress'));
  const owner=read('tests/integration/agent-bash-coherent-author-20260829/admin-owner-r1/tracked-owner.mjs');
  assert.equal(owner.sha256,'00fdbaef7a6b2d950babe22a0d9e3c6ee0c8265004c88becc485a9f30d64d446');
  const sources=['consumer.mjs','profile.mjs','coordinator.mjs','finish.mjs'].map(name=>{const row=read(prefix+'/r2/'+name);return {path:row.path,bytes:row.bytes,sha256:row.sha256};});
  const plan={schema:'FINAL_SMOKE_R2_SOURCE_PURE_PRESEAL',oldPreseal:sha(read(prefix+'/PRESEAL.json').body),sources,traceAndLoader:pins,owner:{path:owner.path,bytes:owner.bytes,sha256:owner.sha256},groups:['F01-primary0-cleanupfalse-reportundefined','F02-cleanupfalse-reportundefined','F03-reportundefined-only','F04-primaryundefined-cleanupfalse-report0','F05-success24-shape','T01-short-writes-close','T02-zero-write-close-poison','T03-writefalse-closeundefined'],limits:{knownOS:40,peak:3,seconds:1200,publicationSeconds:180,captureBytes:67108864,workBytes:536870912,asyncLoaders:3,peakAsyncLoaders:1,guestWorkers:0,regexWorkers:0},actualCells:'UNRUN',artifact:'NOT_BUILT_HASH_AND_COUNTS_PENDING'};
  fs.writeFileSync(path.join(own,'PRESEAL.json'),JSON.stringify(plan,null,2)+'\n',{flag:'wx'});
  const {runSelected}=await import('./consumer.mjs');
  const {ids}=await import('../contract.mjs');
  const {createTrace}=await import(pathToFileURL(tracePath).href);
  const results=[];
  async function consumerCase(id,primaryPresent,primary,cleanupPresent,cleanup,reportingPresent,reporting){
    const observations=[],events=[];
    class Shell { use(){events.push('use');} async exec(){events.push('exec');if(primaryPresent)throw primary;return {stdout:'ok',stderr:'',exitCode:0};} async dispose(){events.push('dispose');if(cleanupPresent)throw cleanup;} }
    const context={ids:[...ids],layout:'source-built',beforeCase(){},runWorkflow:async id=>({id,status:'STUB'}),api:{Shell,MemoryFileSystem:class {},agentCommands:()=>[]},nodeApi:{},fixture:{},scalarAndPipelineRows:['R17','R16'].map(id=>({id,script:'INERT',stdout:'ok',exitCode:0})),observe(){events.push('observe');if(reportingPresent)throw reporting;}};
    let caught=false,reason,result;
    try{result=await runSelected(context,observations);}catch(error){caught=true;reason=error;}
    assert.equal(caught,primaryPresent||cleanupPresent||reportingPresent);
    if(caught)assert.equal(reason,primaryPresent?primary:cleanupPresent?cleanup:reporting);
    assert(events.indexOf('dispose')<events.indexOf('observe'));
    assert.equal(observations[0].primaryPresent,primaryPresent);assert.equal(observations[0].cleanupPresent,cleanupPresent);assert.equal(observations[0].reportingPresent,reportingPresent);
    if(reportingPresent)assert.equal(observations[0].reporting,reporting);
    if(!caught)assert.equal(result.rows.length,8);
    results.push({id,status:'PASS',role:'PURE_STUB_NO_PRODUCT',events});
  }
  await consumerCase(plan.groups[0],true,0,true,false,true,undefined);
  await consumerCase(plan.groups[1],false,undefined,true,false,true,undefined);
  await consumerCase(plan.groups[2],false,undefined,false,undefined,true,undefined);
  await consumerCase(plan.groups[3],true,undefined,true,false,true,0);
  await consumerCase(plan.groups[4],false,undefined,false,undefined,false,undefined);
  function traceFixture(kind){let bytes=0,closed=0,writes=0;return {state:()=>({bytes,closed,writes}),io:{openSync:()=>9,fstatSync:()=>({isFile:()=>true,size:bytes,dev:1,ino:2}),writeSync(_descriptor,body,offset,length){writes++;if(kind==='zero')return 0;if(kind==='false')throw false;const count=Math.min(2,length);bytes+=count;return count;},closeSync(){closed++;if(kind==='false')throw undefined;}}};}
  const short=traceFixture('short');createTrace('/inert',short.io)({ok:true});assert(short.state().writes>1);assert.equal(short.state().closed,1);results.push({id:plan.groups[5],status:'PASS',role:'PURE_IO_NOT_NATIVE_FD'});
  const zero=traceFixture('zero'),writeZero=createTrace('/inert',zero.io);assert.throws(()=>writeZero({ok:true}));assert.equal(zero.state().closed,1);assert.throws(()=>writeZero({ok:true}));results.push({id:plan.groups[6],status:'PASS',role:'PURE_IO_NOT_NATIVE_FD'});
  const falsey=traceFixture('false');let present=false,reason;try{createTrace('/inert',falsey.io)({ok:true});}catch(error){present=true;reason=error;}assert(present);assert.equal(reason,false);assert.equal(falsey.state().closed,1);results.push({id:plan.groups[7],status:'PASS',role:'PURE_IO_NOT_NATIVE_FD'});
  for(const record of cache.values()){const stat=fs.lstatSync(record.path);assert(stat.isFile()&&!stat.isSymbolicLink());assert.equal(stat.size,record.bytes);assert.equal(stat.mode&0o777,record.mode);assert.equal(sha(fs.readFileSync(record.path)),record.sha256);}
  assert(Date.now()-started<330000);
  const result={status:'SOURCE_PURE_READY_FINAL_ARTIFACT_AND_ACTIVATION_PENDING',groups:results,postguards:cache.size,productExecutions:0,loaderExecutions:0,childSpawns:0,startedUTC:new Date(started).toISOString(),endedUTC:new Date().toISOString(),qualifications:['Original057d HOLD unchanged','No actual coordinator/install/loader/native trace execution','IO mocks are not native FD or crash durability proof','Known owned role observation is not full transitive census','512MiB sampled/quiescent fit required after actual producer; cache post-close only']};
  const body=Buffer.from(JSON.stringify(result,null,2)+'\n');fs.writeFileSync(path.join(own,'RESULT.json'),body,{flag:'wx'});
  fs.writeFileSync(path.join(own,'ENVELOPE.md'),'# Prospective physical layout and command admission\n\nprofile.mjs constructs one pinned Node offline npm-install command plus three sequential Node consumer commands. Coordinator reuses exact owner00fdbaef and restores per-command private owner env after awaited settlement; process.env is not changed. Four managed children, at most40knownOS with metadata/publication; guest/Regex0, three async loader admissions peak1 at trusted builtin functional boundary.\n\nBefore activation, an external captured entry must authenticate producer receipt type/exactsize/hash before parsing; source/emits/package manifests and all package bytes must match that new receipt, not old counts. Source-built consumes genuine producer dist; offline installer consumes exact tgz with authenticated lifecycle eligibility, fixed empty npm configs and owned cache. Installed package must be authenticated after closed installer. Physically moved layout must rename the genuine installed package after installed consumer retires, retain dev/ino evidence and reauthenticate members; no tar-copy relabeling. Per-layout binding files are exclusively created with exact hashes/sizes and current paths. Materialization/command callbacks are pending final artifact-specific implementation/binding, not tested facts.\n\nLoader path is exact B2-r8 checked-write trace implementation, not prior appendFile/fsync loader. All its relative dependencies and entry/product members require per-file admission. Existing member guard checks source bytes before eval, builtins trusted; --allow-worker permits loader function but is not security isolation or universal thread census. No guest/Regex construction is part of selected rows.\n\nOwned read/write roots are explicit physical stage/tool/application roots in profile.mjs. No broad /tmp or private read. Capture is charged by owner; bounded loader trace524288B per layout remains inside64MiB aggregate. Quiescent512MiB logicalwork includes staged/install/moved/cache/outputs; post-close cache reconciliation, no live ENOENT waiver or npm peak claim. Stop on observed excess. Final receipt needs actual commands/tool pins, loader/member files, work-fit evidence and reviewed activation. No current grant/window or runnable final release claim.\n',{flag:'wx'});
  fs.writeFileSync(path.join(own,'HANDOFF.md'),`# Final smoke r2 SOURCE/PURE handoff\n\n8/8 groups, all24 product cells UNRUN. F01 fixed in versioned consumer: execution primary wins over cleanup and reporting; secondary raw-falsy presence retained in caller-owned observations. shell.use is now inside the disposal-protected region. Original057d report and source unchanged.\n\nFive actual stub-driven consumer groups plus three actual PURE checked-writer groups; no product or loader executed. Reporting exceptions are independently caught after cleanup. Received observations preserve raw0/false/undefined, no truthiness identity inference.\n\nExact B2-r8 trace/loader/support/cache source pins in PRESEAL, checked writes and close, post-retirement hash verification; no fsync/appendFile or crash durability claim. ROOT profile updated to512MiB sampled/quiescent and3async-loaders peak1, guest/Regex0. OS command envelope/coordinator source prepared; artifact-specific materialization/permission paths and full producer fit still pending, not an executable final approval.\n\nRESULT SHA256 ${sha(body)} (${body.length}B). PRESEAL SHA256 ${sha(fs.readFileSync(path.join(own,'PRESEAL.json')))}. No fresh artifact hash/cardinality invented; all original script/oracle selection retained.\n`,{flag:'wx'});
  return {groups:results.length,resultSha256:sha(body),presealSha256:sha(fs.readFileSync(path.join(own,'PRESEAL.json'))),endedUTC:result.endedUTC,productExecutions:0,loaderExecutions:0};
}
