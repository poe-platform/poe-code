import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { ids, layouts, bounds, admitProducerParameter, reconcileCardinality, beforeCase } from './contract.mjs';
export async function finish(context) {
  const { repo, scope, read, write, hash, cache, started } = context;
  const base = 'tests/integration/agent-bash-coherent-author-20260829/';
  const preseal = read(base + 'stage-b0-r3/PRESEAL.json'); assert.equal(preseal.sha256, '78e6c945ceadfb54d51d806fbe57399ab5a552ad4571791cb916c085736e27a7');
  const old = JSON.parse(preseal.body);
  const workflowPin = old.stageFiles.find(row => row.target === 'workflows.mjs');
  const fixturePin = old.stageFiles.find(row => row.target === 'fixture.json');
  const workflow = read(workflowPin.source); assert.equal(workflow.bytes, workflowPin.bytes); assert.equal(workflow.sha256, workflowPin.sha256);
  const fixture = read(fixturePin.source); assert.equal(fixture.bytes, fixturePin.bytes); assert.equal(fixture.sha256, fixturePin.sha256);
  const runtimeRows = read('tests/shell/pipestatus-author-20260829/runtime-cases.json'); assert.equal(runtimeRows.sha256, '9ece84f2f5cc4a4916d7deab4a173e17dc4fb5d3b5240267e54adf252d310806');
  const originalRows = JSON.parse(runtimeRows.body).cases.filter(row => ['R16','R17'].includes(row.id)); assert.equal(originalRows.length, 2);
  const local = read('tests/shell/pipestatus-author-20260829/local-a-v1/cases.json'); assert.equal(local.sha256, '44ca411e4ad54241ea23edac489710ecc4f50c51a65a1c375a5f06e29a4abc51');
  const localR17 = JSON.parse(local.body).find(row => row.id === 'R17-UNCHANGED');
  assert.equal(localR17.script, originalRows.find(row => row.id === 'R17').script); assert.equal(localR17.expected, originalRows.find(row => row.id === 'R17').stdout);
  const sourceManifest = read('tests/compatibility/final-composition-readiness-20260829/reconciliation-v2/CANDIDATE-INPUTS.json'); assert.equal(sourceManifest.sha256, 'ef910f1c3bccf4f0345a7d938cf9f2969a8d0e03ceaaafa55bf93b837e40cdbd');
  const primitives = read(base + 'admin-owner-r1/tracked-owner.mjs'); assert.equal(primitives.sha256, '00fdbaef7a6b2d950babe22a0d9e3c6ee0c8265004c88becc485a9f30d64d446');
  const marker = 'async function runWorkflow'; assert(workflow.body.toString().includes(marker));
  const metadata = record => ({ path:record.path, bytes:record.bytes, sha256:record.sha256, mode:record.mode });
  const cases = ids.map(id => id.startsWith('C') ? { id, authority:metadata(workflow), implementation:'existing runWorkflow branch unchanged', status:'UNRUN' } : { ...originalRows.find(row => row.id === id), authority:metadata(runtimeRows), status:'UNRUN' });
  const inputs = [workflow, fixture, runtimeRows, local, sourceManifest, primitives].map(metadata);
  const ownFiles = ['contract.mjs','consumer.mjs','coordinator.mjs','finish.mjs','prepare.mjs'].map(name => metadata(read(path.relative(repo, path.join(scope, name)))));
  const pre = { kind:'SOURCE_DATA_PREPARATION_ONLY', ids, layouts, cells:24, inputs, ownFiles, futureProducer:null, productCalls:0, workerStarts:0,
    controls:['D01-selector-order','D02-missing-producer','D03-cardinality','D04-own-data-rejection','D05-Worker-denial','D06-beforecase-fit'], bounds };
  const preBody = Buffer.from(JSON.stringify(pre, null, 2) + '\n'); write(path.join(scope, 'PRESEAL.json'), preBody);
  const results = [];
  const control = (id, action) => { action(); results.push({ id, status:'PASS', role:'PURE_DATA_NO_PRODUCT' }); };
  const descriptor = { path:'/synthetic/receipt', bytes:1, sha256:'a'.repeat(64) };
  const synthetic = { schema:'FINAL_SMOKE_ADMITTED_PRODUCER_V1', authority:'HASH_SIZE_TYPE_ADMITTED_PRODUCER_RECEIPT', sourceManifest:descriptor, emittedManifest:descriptor, packageManifest:descriptor, package:descriptor, counts:{ sourceInputs:2, emittedFiles:3, packageMembers:4 } };
  const gate = { selected:[...ids], layout:layouts[0], index:0, now:1000, activeEnd:31000, workers:{ guest:0, regex:0 }, captureRemaining:1048576, workRemaining:1048576 };
  control('D01-selector-order', () => { assert.equal(beforeCase(gate), 'C01'); assert.throws(() => beforeCase({ ...gate, selected:[...ids].reverse() })); assert.throws(() => beforeCase({ ...gate, selected:[...ids,'C08'] })); });
  control('D02-missing-producer', () => { assert.throws(() => admitProducerParameter(null)); assert.throws(() => admitProducerParameter({ ...synthetic, authority:'UNBUILT' })); });
  control('D03-cardinality', () => { const manifests = { source:[{path:'a'},{path:'b'}], emitted:[{path:'a'},{path:'b'},{path:'c'}], members:[{path:'a'},{path:'b'},{path:'c'},{path:'d'}] }; reconcileCardinality(synthetic, manifests); assert.throws(() => reconcileCardinality(synthetic,{ ...manifests, members:[] })); });
  control('D04-own-data-rejection', () => { let invoked = false; const bad = { ...synthetic }; Object.defineProperty(bad,'counts',{ get(){ invoked=true; return synthetic.counts; }, enumerable:true }); assert.throws(() => admitProducerParameter(bad)); assert.equal(invoked,false); assert.throws(() => admitProducerParameter({ ...synthetic, [Symbol('extra')]:1 })); });
  control('D05-Worker-denial', () => { assert.throws(() => beforeCase({ ...gate, workers:{guest:1,regex:0} })); assert.throws(() => beforeCase({ ...gate, workers:{guest:0,regex:1} })); });
  control('D06-beforecase-fit', () => { assert.throws(() => beforeCase({ ...gate, now:1001 })); assert.throws(() => beforeCase({ ...gate,captureRemaining:1048575 })); assert.throws(() => beforeCase({ ...gate,workRemaining:1048575 })); });
  for (const record of inputs.concat(ownFiles)) { const bytes = fs.readFileSync(record.path); assert.equal(bytes.length,record.bytes); assert.equal(hash(bytes),record.sha256); }
  const workerProfile = { guest:0, regex:0, nativeOracle:0, reason:'C01 registers an inert provider only; C02 literal equality/printf/cat; C07 printf redirects; C12 injected transport; C13/C14 VFS Git/patch; R16/R17 false/true/printf/local.', inheritedB0AsyncLoaderAdmissions:3, inheritedB0AsyncLoaderPeak:1, strictAllThreadsZero:false, decision:'ROOT must explicitly authorize these loader admissions or separately bind a qualified synchronous-hook successor before activation.' };
  const proposal = { status:'SOURCE_PURE_READY_NOT_FINAL_EXECUTABLE_ADMISSION', sourceUnion:metadata(sourceManifest), localACandidate:'ec74e14_under_independent_review', finalArtifact:'NOT_BUILT_NOT_ADMITTED', cases, layouts, prospectiveCells:24, workerProfile, bounds,
    knownRoles:{ coordinator:1, install:1, consumers:3, administrationAllowance:35 }, totalKnownOSCeiling:40,
    inclusiveSchedule:{ setup:60, install:120, consumers:[270,270,270], activeSlack:30, publication:180 },
    producerParameter:'Fresh externally hash/type/size-admitted producer receipt and exact source/emitted/package member manifests. Counts reconcile to their admitted arrays; no309/323/1014/HEAD runtime authority.',
    readinessErratum:'SMOKE-PROPOSAL v2 points to old v2 workflows. Select actual accepted B0 v4 6d8a1985 instead, including corrected C14 Git-diff oracle. No old expected byte edits.',
    actualBlockers:['local-a independent acceptance/final composition freeze','fresh trusted producer artifact and full member inventory','zero-Worker versus3 inherited async loader admissions ROOT decision','future layout/command/tool/permission paths and independent final preexecution review'],
    noActivationWindow:true, noProductExecuted:true };
  write(path.join(scope,'PROPOSAL.json'),Buffer.from(JSON.stringify(proposal,null,2)+'\n'));
  write(path.join(scope,'SELECTION.json'),Buffer.from(JSON.stringify({ids,layouts,cases},null,2)+'\n'));
  write(path.join(scope,'CONTROLS.json'),Buffer.from(JSON.stringify({results,startedUTC:new Date(started).toISOString(),endedUTC:new Date().toISOString(),childSpawns:0,productCalls:0},null,2)+'\n'));
  const report = '# Final coherent smoke: SOURCE/PURE preparation only\n\nEight rows x three layouts =24 UNRUN cells. C01/C02/C07/C12/C13/C14 use exact accepted B0 v4 workflow6d8a1985, not the stale v2 locator in readiness SMOKE-PROPOSAL. Neutral fixturefcb7bae1 unchanged. R16/R17 come from runtime-cases9ece84f2; R17 is byte-identical to local-a R17-UNCHANGED44ca411e. The unrelated local-a SCALAR row is not substituted for R16.\n\nSix PURE DATA controls pass. No product/module/Worker/npm/compiler/install/native execution. Source union323 is a provisional inspected inventory, not a hardcoded future member count. Final local-a-inclusive artifact remains unbuilt and requires a newly admitted producer receipt; consumer parameter schema is not authentication by itself. External type/size/hash admission of receipt and every manifest plus per-file loader binding is mandatory before runSelected.\n\nSelected branches require zero guest/Regex Workers. They do not call regex operators/regex tools or node guest execution; mock curl has no real network. Existing B0 resources guard can use allowance0. Its authenticated loader mechanism nevertheless requires3 async-loader admissions, peak1; therefore strict all-Worker/thread zero is NOT yet qualified. ROOT must explicitly approve that bounded loader profile or separately bind the already-qualified synchronous-hook alternative; no new hook was invented here.\n\ncoordinator.mjs reuses exact tracked-owner00fdbaef, with no ambient launch or new administrative framework. consumer.mjs invokes unchanged workflow branches plus the original R16/R17 script/stdout/status checks; it does not import product by itself. There is intentionally no runnable --run bootstrap/final command: producer/materializer/installed/moved/tool/permission bindings and independent review remain necessary. Maintain raw falsy presence/cleanup observations; disposal is not opaque-provider finalization.\n\nProposal:40knownOS peak3,1200s inclusive =1020active+180publication; setup60/install120/three270s consumers leaves30active slack. Eight30s cases/layout with awaited disposal, cleanup5s bounded by the enclosing clocks. Capture64MiB; sampled logical work256MiB is a cap requiring fresh pre-install fit admission, NOT a demonstrated final-artifact fit or OS quota. No hardcoded emitted/member cardinality, HEAD, or retained old package substitution. No shared test/package/source edits; historical failures and pending local-a status unchanged.\n';
  write(path.join(scope,'HANDOFF.md'),Buffer.from(report));
  return { status:proposal.status, controls:results, prospectiveCells:24, actualCells:0, workerProfile, presealSha256:hash(preBody), endedUTC:new Date().toISOString(), childSpawns:0 };
}
