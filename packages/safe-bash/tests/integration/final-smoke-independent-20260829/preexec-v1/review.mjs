import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
const repo = '/Users/kjopek/Workspace/safe-bash';
const own = path.dirname(fileURLToPath(import.meta.url));
const author = path.join(repo,'tests/integration/final-smoke-preparation-20260829');
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const start = Date.now();
const bindings = [];
const rows = [];
const observations = [];
function read(filename, expected, maximum = 2097152) {
  const stat = fs.lstatSync(filename);
  assert(stat.isFile() && !stat.isSymbolicLink() && stat.size <= maximum);
  if (expected) assert.equal(stat.size,expected.bytes);
  const bytes = fs.readFileSync(filename); assert.equal(bytes.length,stat.size);
  if (expected) assert.equal(hash(bytes),expected.sha256);
  bindings.push({path:filename,bytes:bytes.length,sha256:hash(bytes)});
  return bytes;
}
function write(name, value) {
  const body = Buffer.from(typeof value === 'string' ? value : JSON.stringify(value,null,2)+'\n');
  assert(body.length < 2097152); fs.writeFileSync(path.join(own,name),body,{flag:'wx'});
}
async function control(id, action) {
  try { await action(); rows.push({id,status:'PASS'}); }
  catch (reason) { rows.push({id,status:'FAIL',reasonPresent:true,detail:String(reason)}); }
}
function tag(reason) { return reason === undefined ? {type:'undefined'} : reason === null ? {type:'null'} : {type:typeof reason,value:reason}; }
try {
  const inspection = JSON.parse(read(path.join(own,'INSPECTION.json')));
  assert.equal(inspection.commit,'b2f84cc190318bc136731a05d1bc2d4fe681162e');
  const texts = new Map();
  for (const row of inspection.files) texts.set(path.basename(row.path),read(row.path,row));
  assert.equal(hash(texts.get('PRESEAL.json')),'c970b59e29472bc110f37e1e2367784fc97bcb0e429bd4f054d4d4a9bd446883');
  const preseal = JSON.parse(texts.get('PRESEAL.json'));
  for (const row of preseal.inputs) read(row.path,row);
  const oldStagePath = path.join(repo,'tests/integration/agent-bash-coherent-author-20260829/stage-b0-r3/PRESEAL.json');
  const oldStageBytes = read(oldStagePath); assert.equal(hash(oldStageBytes),'78e6c945ceadfb54d51d806fbe57399ab5a552ad4571791cb916c085736e27a7');
  const oldStage = JSON.parse(oldStageBytes);
  const loaderPin = oldStage.stageFiles.find(row => row.target === 'loader.mjs'); assert(loaderPin);
  const loaderBytes = read(path.join(repo,loaderPin.source),loaderPin);
  const loaderText = loaderBytes.toString();
  assert(!loaderText.includes('fsync'));
  assert(loaderText.includes('await fs.appendFile(binding.trace'));
  const contractText = texts.get('contract.mjs').toString();
  assert.equal((contractText.match(/^import /gm) ?? []).length,1);
  assert(contractText.startsWith("import assert from 'node:assert/strict';"));
  const consumerText = texts.get('consumer.mjs').toString();
  const consumerBody = consumerText.slice(consumerText.indexOf('export async function runSelected')).replace('export async function runSelected','return async function runSelected');
  const finish = texts.get('finish.mjs').toString();
  const first = finish.indexOf('  const results = [];');
  const last = finish.indexOf('  for (const record of inputs.concat(ownFiles))',first);
  assert(first > 0 && last > first);
  const authorBody = finish.slice(first,last); assert.equal((authorBody.match(/  control\('/g) ?? []).length,6);
  const nodeStat = fs.lstatSync(process.execPath); assert(nodeStat.isFile() && nodeStat.size === 112989184);
  const toolHash = crypto.createHash('sha256'); const descriptor = fs.openSync(process.execPath,'r');
  const buffer = Buffer.alloc(65536); let toolBytes = 0;
  try { for (;;) { const count = fs.readSync(descriptor,buffer,0,buffer.length,null); if (!count) break; toolBytes += count; assert(toolBytes <= nodeStat.size); toolHash.update(buffer.subarray(0,count)); } }
  finally { fs.closeSync(descriptor); }
  assert.equal(toolHash.digest('hex'),'5c899797c4eb8f1db5563eea56538342ddb3e9276ee1b04a5a1f0f1023d2b011');
  write('REVIEW-PRESEAL.json',{candidate:inspection.commit,authorPreseal:hash(texts.get('PRESEAL.json')),helperSha256:hash(read(fileURLToPath(import.meta.url))),bindings,authorBodySha256:hash(Buffer.from(authorBody)),consumerBodySha256:hash(Buffer.from(consumerBody)),membership:[...preseal.controls,'N01-artifact-parameters','N02-selector-cardinality','N03-cleanup-raw-presence','N04-reporting-must-not-mask'],mode:'SOURCE/PURE only; no actual coordinator/product/loader evaluation',processPlan:{inspectionHelper:1,metadataGit:1,reviewHelper:1,syntaxCheck:1,maximumKnownOS:24,peak:3,product:0,workers:0},extraction:'Six author bodies only, before author postguards/publication; exact consumer function body with imports injected; only contract imports assert.'});
  const contract = await import('data:text/javascript;base64,'+Buffer.from(contractText).toString('base64'));
  const authorResults = new Function('assert','ids','layouts','bounds','admitProducerParameter','reconcileCardinality','beforeCase',authorBody+'\nreturn results;')(assert,contract.ids,contract.layouts,contract.bounds,contract.admitProducerParameter,contract.reconcileCardinality,contract.beforeCase);
  rows.push(...authorResults);
  const runSelected = new Function('assert','ids','validateSelection',consumerBody)(assert,contract.ids,contract.validateSelection);
  const item = {path:'/neutral/artifact',bytes:1,sha256:'a'.repeat(64)};
  const parameter = {schema:'FINAL_SMOKE_ADMITTED_PRODUCER_V1',authority:'HASH_SIZE_TYPE_ADMITTED_PRODUCER_RECEIPT',sourceManifest:item,emittedManifest:item,packageManifest:item,package:item,counts:{sourceInputs:1,emittedFiles:1,packageMembers:1}};
  await control('N01-artifact-parameters',() => {
    for (const bytes of [0,-1,NaN,Infinity]) assert.throws(() => contract.admitProducerParameter({...parameter,package:{...item,bytes}}));
    assert.throws(() => contract.admitProducerParameter({...parameter,package:{...item,path:'tree:path'}}));
    assert.throws(() => contract.admitProducerParameter({...parameter,package:{...item,sha256:'x'.repeat(64)}}));
    contract.admitProducerParameter(parameter);
    observations.push({id:'N01',qualification:'Positive schema admits invented descriptor, explicitly NOT filesystem/package authentication.'});
  });
  await control('N02-selector-cardinality',() => {
    for (const selected of [contract.ids.slice(1),[...contract.ids,'C08'],Array(8)]) assert.throws(() => contract.validateSelection(selected,'source-built'));
    for (const members of [[],[{path:'a'},{path:'b'}],[{path:'../escape'}]]) assert.throws(() => contract.reconcileCardinality(parameter,{source:[{path:'s'}],emitted:[{path:'e'}],members}));
    assert.throws(() => contract.reconcileCardinality({...parameter,counts:{...parameter.counts,packageMembers:2}},{source:[{path:'s'}],emitted:[{path:'e'}],members:[{path:'a'},{path:'a'}]}));
  });
  const runtimePin = preseal.inputs.find(row => row.path.endsWith('/runtime-cases.json'));
  const scalarAndPipelineRows = JSON.parse(read(runtimePin.path,runtimePin)).cases;
  async function exercise(primary, reportingFault) {
    const events = [];
    class FakeShell {
      use() { events.push('use'); }
      async exec() { events.push('exec'); throw primary; }
      async dispose() { events.push('dispose'); throw false; }
    }
    const context = { ids:[...contract.ids],layout:'source-built',api:{Shell:FakeShell,MemoryFileSystem:class {},agentCommands() { return {}; }},nodeApi:{},fixture:{},scalarAndPipelineRows,beforeCase:async () => {},runWorkflow:async id => ({id,status:'PASS',role:'FAKE'}),observe(row) { events.push({event:'observe',primaryPresent:row.primaryPresent,primary:tag(row.primary),cleanupPresent:row.cleanupPresent,cleanup:tag(row.cleanup)}); if (reportingFault) throw undefined; }};
    let present = false; let reason;
    try { await runSelected(context); } catch (caught) { present = true; reason = caught; }
    return {present,reason,events};
  }
  await control('N03-cleanup-raw-presence',async () => {
    for (const primary of [undefined,null,false,0]) {
      const result = await exercise(primary,false); assert(result.present); assert.equal(result.reason,primary);
      assert.deepEqual(result.events.slice(0,3),['use','exec','dispose']);
      assert.equal(result.events[3].cleanupPresent,true); assert.equal(result.events[3].primaryPresent,true);
    }
  });
  await control('N04-reporting-must-not-mask',async () => {
    const result = await exercise(0,true);
    observations.push({id:'N04',expected:{present:true,reason:tag(0)},observed:{present:result.present,reason:tag(result.reason)},events:result.events});
    assert(result.present); assert.equal(result.reason,0,'raw primary0 must survive reporting undefined after cleanupfalse');
  });
  for (const binding of [...bindings]) read(binding.path,binding);
  const result = {verdict:rows.every(row => row.status === 'PASS')?'SOURCE-PURE-QUALIFIED':'HOLD',candidate:inspection.commit,preseal:hash(texts.get('PRESEAL.json')),rows,observations,bindings,elapsedMs:Date.now()-start,actual:{product:0,workers:0,loaders:0,coordinator:0,build:0,install:0},pending:{finalProducer:true,finalLoaderBinding:true,rootApprovedAsyncLoaders:3,asyncPeak:1,rootApprovedSampledWork:536870912,packetSampledWork:contract.bounds.sampledLogicalWorkBytes}};
  write('RESULT.json',result);
  write('REPORT.md',`# Final coherent smoke — independent SOURCE/PURE review\n\n${result.verdict}; ${rows.filter(row=>row.status==='PASS').length}/${rows.length} groups. Six unchanged extracted author controls plus four independent controls. No product, Worker, loader, coordinator, compiler, npm/install or native execution.\n\n## Finding F01\n\nconsumer.mjs:25 calls context.observe outside the protected outcome-selection block. Exact function with fake Shell: exec rejects0; dispose rejectsfalse and settles; observe receives both explicit presence records, then throwsundefined; runSelected rejectsundefined rather than original0. N04 preserves this failure. This is harness reporting-fault masking, not a product finding. Guard observation independently and preserve primary/cleanup precedence with bounded secondary reporting. No author file changed.\n\n## Parametric admission and loader\n\nAll ten candidate files match committed blobs b2f84cc190318bc136731a05d1bc2d4fe681162e; six input authorities hash/size rebound. PRESEAL c970b59e29472bc110f37e1e2367784fc97bcb0e429bd4f054d4d4a9bd446883. Receipt schema intentionally accepts syntactically valid invented descriptors, not a final artifact. Empty/wrong-cardinality/duplicate/traversal inventories reject. No hardcoded1002/1014 future cardinality. Host artifact paths are absolute filenames, not derived Git:path locators. No decompression.\n\nInherited B0 loader is stage-b0-r2/loader.mjs bound through stage-b0-r3 PRESEAL; source contains no fsync, uses awaited fs.appendFile, and returns next(url,context) after checking separately read bytes. This is NOT proof of B2r7 checked-write/close/postretirement trace binding or proof evaluated bytes equal the earlier read under mutation. Final loader/trace/capture/permissions/input manifest must be sealed and reviewed, not silently assumed from approving3 async admissions. No actual loader evaluated.\n\n## Prospective authority\n\n24 selectors are C01/C02/C07/C12/C13/C14/R17/R16 × source-built/installed/physically-moved. Workflows bind accepted v4, original R16/R17 retained. Fixed coordinator dispatch roles offline-install then those three smoke layouts; argv/tool/physical parents/materializer remain externally supplied, so no executable command/window is accepted. External admission before consumer calls, exact producer/source/emits/package inventory and per-file load bindings still required.\n\nRoot prospectively approves40 knownOS/peak3,1200s including180publication,64MiB capture,512MiB sampled/quiescent work,3 async-loader admissions peak1,0 guest/RegexWorkers. Packet still says256MiB: future version must bind approved512MiB and receipt-derived fit, not reinterpret this seal. Quiescent/sample is not prewrite/RSS/native-peak/OSquota. Selected cleanup is public dispose, not arbitrary opaque-provider retirement. Source union323/local-a remains provisional.\n\n## Evidence qualifications\n\nCaptured file-based helpers only; metadataGit exited0. Initial /usr/bin/rg lookup unavailable was tool-transcript-only metadata failure and no code execution; committed inventories/complete admitted bytes used instead. Missing optional scoped AGENTS paths were separately reported; instruction text not copied. Truncated source display is not reconstructed or used as completeness proof. Syntax and runtime stdout/stderr are separate captures; no active owned children. Two helpers only (inspection and review); no wholecampaign/transitive census claim.\n`);
  console.log(JSON.stringify({verdict:result.verdict,pass:rows.filter(row=>row.status==='PASS').length,total:rows.length,receiptSha256:hash(fs.readFileSync(path.join(own,'RESULT.json')))}));
  process.exitCode = result.verdict === 'HOLD' ? 1 : 0;
} catch (reason) {
  console.error(reason); write('FAILURE.json',{primaryPresent:true,reason:String(reason),stack:reason?.stack,rows,elapsedMs:Date.now()-start}); process.exitCode=1;
}
