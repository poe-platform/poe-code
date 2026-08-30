import assert from 'node:assert/strict';
import path from 'node:path';
import { createHash } from 'node:crypto';
export function bindSubject(ports) {
  const { guard, immutable, readLimited, scratch, control, limits } = ports;
  const sha = value => createHash('sha256').update(value).digest('hex');
  const evidence = { observations: [] };
function auditLoads(label, admitted) {
  const bytes = readLimited(path.join(scratch,'logs',label,'loads.jsonl'), limits.loadTraceBytesPerChild);
  const rows = bytes.toString().trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
  assert.ok(rows.length <= 4096); assert.ok(!rows.some(row => row.event === 'refuse'));
  const loads = rows.filter(row => row.event === 'load');
  for (const row of loads) {
    const expected = admitted.value.files[row.path]; assert.ok(expected); assert.equal(row.sha256, expected.sha256); assert.equal(row.role, expected.role);
    if (row.role === 'engine') { assert.equal(row.method,'explicit-transform'); assert.equal(row.emittedSha256,expected.emittedSha256); }
  }
  const paths = [...new Set(loads.filter(row => row.role === 'engine').map(row => row.path))].sort();
  for (const required of ['run.ts','interp/values.ts','interp/budget.ts','interp/host-bridge.ts']) assert.ok(paths.includes('consumer/engine/src/' + required), 'MISSING_ACTUAL_ENGINE_ROOT');
  assert.ok(paths.length <= 63); assert.equal(loads.filter(row => row.role === 'compiler').length,1);
  assert.equal(loads.filter(row => ['npm','product'].includes(row.role)).length,0);
  assert.ok(loads.some(row => row.path === 'consumer/harness/reference-entry.mjs'));
  return { sha256: sha(bytes), actualEnginePaths: paths, sourceAndEmissionHashesVerified: true, unknownLoads: 0 };
}
function ownRecord(value, required, optional = []) {
  assert.ok(value !== null && typeof value === 'object' && !Array.isArray(value), 'RECORD_TYPE');
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const keys = Reflect.ownKeys(descriptors);
  assert.ok(keys.every(key => typeof key === 'string' && [...required, ...optional].includes(key)), 'RECORD_EXTRA');
  for (const key of required) assert.ok(Object.hasOwn(descriptors, key), 'RECORD_MISSING:' + key);
  for (const key of keys) assert.ok(Object.hasOwn(descriptors[key], 'value'), 'RECORD_ACCESSOR');
  return value;
}
function denseData(value, maximum) {
  assert.ok(Array.isArray(value), 'ARRAY_TYPE');
  const descriptors = Object.getOwnPropertyDescriptors(value);
  assert.ok(Object.hasOwn(descriptors.length, 'value'));
  const length = descriptors.length.value;
  assert.ok(Number.isSafeInteger(length) && length >= 0 && length <= maximum, 'ARRAY_BOUND');
  assert.equal(Reflect.ownKeys(descriptors).length, length + 1, 'ARRAY_EXTRA_OR_HOLE');
  for (let index = 0; index < length; index++) assert.ok(descriptors[index] && Object.hasOwn(descriptors[index], 'value'), 'ARRAY_ACCESSOR_OR_HOLE');
  return value;
}
function primitiveData(value) {
  assert.ok(value === null || typeof value === 'boolean' || typeof value === 'string' && Buffer.byteLength(value) <= 4096 || typeof value === 'number' && Number.isFinite(value), 'PRIMITIVE_TYPE');
}
function reasonShape(value) {
  if (value === null) return;
  ownRecord(value, ['type'], ['name','message','text']);
  assert.ok(['undefined','null','object','string','number','boolean','function','symbol','bigint'].includes(value.type));
  if (value.type === 'object') {
    ownRecord(value, ['type','name','message']);
    for (const key of ['name','message']) assert.ok(value[key] === null || typeof value[key] === 'string' && value[key].length <= 4096);
  } else { ownRecord(value, ['type','text']); assert.ok(typeof value.text === 'string' && value.text.length <= 4096); }
}
function reconcileReceipt(label, receipt, terminal, result, loads, receiptBytes) {
  const identity = label.startsWith('F06-') ? 'F06' : label;
  assert.ok(control.evaluations.includes(label));
  const common = ['schema','label','identity','sourceSha256','events','marks','assertions','unhandled','counters','classification','clean','budget','engineOutcome','finalResources','rawSha256','publicOutcome','namespace'];
  const extra = identity === 'F05' ? ['cacheState'] : ['F01'].includes(identity) ? [] : identity === 'F06' ? ['held','cancellation','afterReadWhileHeld','publicReasonProof'] : ['held'];
  ownRecord(receipt, [...common,...extra]);
  ownRecord(terminal, ['label','classification','receiptSha256']);
  assert.equal(receipt.schema,'node-abi-child-v1'); assert.equal(receipt.label,label); assert.equal(receipt.identity,identity);
  assert.equal(receipt.sourceSha256,control.guestSources[identity]); assert.match(receipt.rawSha256,/^[0-9a-f]{64}$/);
  assert.equal(terminal.label,label); assert.equal(terminal.classification,receipt.classification); assert.equal(terminal.receiptSha256,sha(receiptBytes));
  assert.ok(result.stdout.equals(Buffer.from(JSON.stringify(terminal)+'\n'))); assert.equal(result.stderr.length,0);
  assert.equal(result.row.closeObserved,true); assert.equal(result.row.naturallyReaped,true); assert.equal(result.row.signal,null); assert.equal(result.row.containment,null);
  ownRecord(loads,['sha256','actualEnginePaths','sourceAndEmissionHashesVerified','unknownLoads']);
  assert.match(loads.sha256,/^[0-9a-f]{64}$/); assert.equal(loads.sourceAndEmissionHashesVerified,true); assert.equal(loads.unknownLoads,0);
  denseData(loads.actualEnginePaths,63); for (const name of loads.actualEnginePaths) assert.ok(typeof name === 'string' && name.length <= 4096);
  assert.equal(new Set(loads.actualEnginePaths).size,loads.actualEnginePaths.length);
  const sortedPaths = [...loads.actualEnginePaths].sort(); assert.ok(loads.actualEnginePaths.every((name,index)=>name===sortedPaths[index]));
  for (const name of ['run.ts','interp/values.ts','interp/budget.ts','interp/host-bridge.ts']) assert.ok(loads.actualEnginePaths.includes('consumer/engine/src/'+name));
  const counters = receipt.counters;
  const counterKeys = ['engineEntered','engineSettled','budgetCreated','factoryCreated','intrinsicEntered','intrinsicSettled','hostOperations','hostOperationsSettled','readsAdmitted','readsSettled','bytesRead','guestRecordsCreated','cleanupRegistrations','cleanupEffects','postCloseAdmissions'];
  ownRecord(counters,counterKeys); for (const name of counterKeys) assert.ok(Number.isSafeInteger(counters[name]) && counters[name] >= 0 && counters[name] <= 4096,'COUNTER_TYPE');
  const resources = receipt.finalResources;
  ownRecord(resources,['hostPending','readPending','intrinsicPending','trackedOperations','guestCacheEntries','listenerDetached','accepting']);
  for (const [name,value] of Object.entries({hostPending:0,readPending:0,intrinsicPending:0,trackedOperations:0,guestCacheEntries:0,listenerDetached:true,accepting:false})) assert.equal(resources[name],value);
  assert.equal(receipt.clean,true); assert.equal(denseData(receipt.unhandled,8).length,0);
  ownRecord(receipt.engineOutcome,['settled','thrown','ok','error']);
  assert.equal(receipt.engineOutcome.settled,true); assert.equal(typeof receipt.engineOutcome.thrown,'boolean');
  assert.ok(receipt.engineOutcome.ok === null || typeof receipt.engineOutcome.ok === 'boolean'); reasonShape(receipt.engineOutcome.error);
  if (receipt.engineOutcome.thrown) assert.equal(receipt.engineOutcome.ok,null);
  else assert.equal(typeof receipt.engineOutcome.ok,'boolean');
  if (receipt.engineOutcome.ok === true) assert.equal(receipt.engineOutcome.error,null);
  ownRecord(receipt.publicOutcome,['settled','rejected','sameEngineResult']);
  assert.equal(receipt.publicOutcome.settled,true); assert.equal(typeof receipt.publicOutcome.rejected,'boolean'); assert.equal(typeof receipt.publicOutcome.sameEngineResult,'boolean');
  ownRecord(receipt.budget,['options','resetCallsObserved','qualification']); assert.equal(receipt.budget.resetCallsObserved,null);
  assert.equal(receipt.budget.qualification,'Construction is witnessed by budgetCreated; internal reset calls are not instrumented. Source inspection says run resets Budget. No Shell or shared Shell budget is instantiated.');
  ownRecord(receipt.budget.options,['maxSteps','maxCallDepth','stringLength','arrayLength','dataSize','deadline']);
  for (const [name,value] of Object.entries({maxSteps:2000,maxCallDepth:32,stringLength:4096,arrayLength:256,dataSize:65536})) assert.equal(receipt.budget.options[name],value);
  assert.ok(Number.isSafeInteger(receipt.budget.options.deadline) && receipt.budget.options.deadline > 0);
  const expectedMarks = {F01:[7,'PURE','after'],F02:[false,'object','after'],F03:[true,2,'after','job'],F04:[true,'after'],F05:[true,false,true,2],F06:[],F07:['job',true,2,'after']}[identity];
  denseData(receipt.marks,32).forEach(primitiveData);
  const events = denseData(receipt.events,32), counts = {}, marks = [], outstanding = new Map();
  const eventFields = {'cleanup-registered':[],'budget-create':[],'factory-create':['name'],'engine-enter':[],'engine-settle':[],'host-enter':['name'],'host-settle':['name','rejected'],'guest-mark':['value'],'intrinsic-enter':['name'],'intrinsic-settle':['name','rejected'],'read-admitted':[],'read-settle':['rejected'],'cleanup-start':[],'cleanup-done':[],'public-settle':['rejected'],'caller-abort':['reasonType']};
  for (let index = 0; index < events.length; index++) {
    const entry = events[index]; ownRecord(entry,['ordinal','event'],['name','rejected','value','nativePromise','reasonType']);
    assert.equal(entry.ordinal,index+1); assert.ok(Object.hasOwn(eventFields,entry.event));
    ownRecord(entry,['ordinal','event',...eventFields[entry.event]],entry.event === 'intrinsic-settle' ? ['nativePromise'] : entry.event === 'public-settle' ? ['reasonType'] : []);
    if (Object.hasOwn(entry,'name')) assert.ok(['mark','pure','fail','readFile','hostRequire','require','readFileSync'].includes(entry.name));
    if (Object.hasOwn(entry,'rejected')) assert.equal(typeof entry.rejected,'boolean');
    if (Object.hasOwn(entry,'nativePromise') || identity === 'F05' && entry.event === 'intrinsic-settle' && !entry.rejected) assert.equal(entry.nativePromise,identity !== 'F05');
    if (Object.hasOwn(entry,'reasonType')) assert.ok(['null','object','undefined','string','number','boolean','function','symbol','bigint'].includes(entry.reasonType));
    counts[entry.event]=(counts[entry.event]??0)+1;
    if (entry.event === 'guest-mark') { primitiveData(entry.value); marks.push(entry.value); }
    if (entry.event === 'host-enter') outstanding.set(entry.name,(outstanding.get(entry.name)??0)+1);
    if (entry.event === 'host-settle') { assert.ok((outstanding.get(entry.name)??0)>0,'UNPAIRED_HOST_SETTLE'); outstanding.set(entry.name,outstanding.get(entry.name)-1); }
  }
  assert.equal(marks.length,receipt.marks.length); assert.ok(marks.every((value,index)=>value===receipt.marks[index])); assert.ok([...outstanding.values()].every(value=>value===0));
  const eventCounters={engineEntered:'engine-enter',engineSettled:'engine-settle',budgetCreated:'budget-create',factoryCreated:'factory-create',intrinsicEntered:'intrinsic-enter',intrinsicSettled:'intrinsic-settle',hostOperations:'host-enter',hostOperationsSettled:'host-settle',readsAdmitted:'read-admitted',readsSettled:'read-settle',cleanupRegistrations:'cleanup-registered',cleanupEffects:'cleanup-start'};
  for (const [name,event] of Object.entries(eventCounters)) assert.equal(counters[name],counts[event]??0,'EVENT_COUNTER:'+name);
  for (const name of ['engineEntered','engineSettled','budgetCreated','cleanupRegistrations','cleanupEffects']) assert.equal(counters[name],1);
  assert.equal(counters.postCloseAdmissions,0); assert.equal(counts['cleanup-done'],1); assert.equal(counts['public-settle'],1);
  assert.equal(counters.bytesRead,2*events.filter(entry=>entry.event==='read-settle' && !entry.rejected).length);
  assert.equal(counters.guestRecordsCreated,identity==='F05'?1:0);
  const position = name => events.findIndex(entry=>entry.event===name);
  assert.equal(position('cleanup-registered'),0); assert.ok(position('engine-enter')>position('budget-create'));
  assert.ok(position('cleanup-done')>position('cleanup-start')); assert.ok(position('public-settle')>position('cleanup-done')); assert.ok(position('public-settle')>position('engine-settle'));
  assert.equal(events[position('public-settle')].rejected,receipt.publicOutcome.rejected);
  ownRecord(receipt.namespace,['entries','writeGranted']); assert.equal(receipt.namespace.writeGranted,false);
  denseData(receipt.namespace.entries,1); assert.equal(receipt.namespace.entries.length,1); ownRecord(receipt.namespace.entries[0],['name','bytes']);
  assert.equal(receipt.namespace.entries[0].name,'/work/a'); denseData(receipt.namespace.entries[0].bytes,2); assert.equal(receipt.namespace.entries[0].bytes.length,2); assert.equal(receipt.namespace.entries[0].bytes[0],65); assert.equal(receipt.namespace.entries[0].bytes[1],66);
  const predicates = [];
  const add = (name,pass) => predicates.push({name,pass});
  const equal = (left,right) => JSON.stringify(left)===JSON.stringify(right);
  if (extra.includes('held')) {
    ownRecord(receipt.held,['eventOrdinal','marks','enginePending','publicPending','hostPending','readPending','intrinsicPending']);
    assert.ok(Number.isSafeInteger(receipt.held.eventOrdinal) && receipt.held.eventOrdinal>=1 && receipt.held.eventOrdinal<=events.length);
    denseData(receipt.held.marks,32).forEach(primitiveData);
    for (const key of ['enginePending','publicPending']) assert.equal(typeof receipt.held[key],'boolean');
    for (const key of ['hostPending','readPending','intrinsicPending']) assert.ok(Number.isSafeInteger(receipt.held[key]) && receipt.held[key]>=0 && receipt.held[key]<=16);
    const heldEvents=events.slice(0,receipt.held.eventOrdinal), heldCount=name=>heldEvents.filter(entry=>entry.event===name).length;
    assert.ok(equal(receipt.held.marks,heldEvents.filter(entry=>entry.event==='guest-mark').map(entry=>entry.value)));
    assert.equal(receipt.held.hostPending,heldCount('host-enter')-heldCount('host-settle'));
    assert.equal(receipt.held.readPending,heldCount('read-admitted')-heldCount('read-settle'));
    assert.equal(receipt.held.intrinsicPending,heldCount('intrinsic-enter')-heldCount('intrinsic-settle'));
    assert.equal(receipt.held.publicPending,heldCount('public-settle')===0);
    if(heldCount('engine-settle')===0)assert.equal(receipt.held.enginePending,true);
    if(identity==='F02') add('ordinary host Promise stays boxed',equal(receipt.held.marks,[false,'object','after']));
    if(['F03','F04','F06'].includes(identity)) add('ordinary intrinsic call holds guest progress',equal(receipt.held.marks,[]) && receipt.held.enginePending);
    if(identity==='F07') add('explicit await releases queued reaction',equal(receipt.held.marks,['job']) && receipt.held.enginePending);
  }
  if(identity==='F06') {
    ownRecord(receipt.cancellation,['callbackSawExactReason','signalStoresExactReason','rawEnginePending','rawEngineThrown','rawEngineReasonIdentity','engineErrorShape','whileCleanupHeldPublicPending']);
    for(const key of ['callbackSawExactReason','signalStoresExactReason','rawEnginePending','rawEngineThrown','rawEngineReasonIdentity','whileCleanupHeldPublicPending']) assert.equal(typeof receipt.cancellation[key],'boolean');
    reasonShape(receipt.cancellation.engineErrorShape);
    ownRecord(receipt.afterReadWhileHeld,['eventOrdinal','readPending','publicPending']); assert.ok(Number.isSafeInteger(receipt.afterReadWhileHeld.readPending) && receipt.afterReadWhileHeld.readPending>=0 && receipt.afterReadWhileHeld.readPending<=1); assert.equal(typeof receipt.afterReadWhileHeld.publicPending,'boolean');
    assert.ok(Number.isSafeInteger(receipt.afterReadWhileHeld.eventOrdinal) && receipt.afterReadWhileHeld.eventOrdinal>=receipt.held.eventOrdinal && receipt.afterReadWhileHeld.eventOrdinal<=events.length);
    const afterReadEvents=events.slice(0,receipt.afterReadWhileHeld.eventOrdinal);
    assert.equal(receipt.afterReadWhileHeld.readPending,afterReadEvents.filter(entry=>entry.event==='read-admitted').length-afterReadEvents.filter(entry=>entry.event==='read-settle').length);
    assert.equal(receipt.afterReadWhileHeld.publicPending,!afterReadEvents.some(entry=>entry.event==='public-settle'));
    ownRecord(receipt.publicReasonProof,['rejected','exactIdentity','reasonType']);
    for(const key of ['rejected','exactIdentity']) assert.equal(typeof receipt.publicReasonProof[key],'boolean');
    assert.equal(receipt.publicReasonProof.reasonType,label==='F06-null'?'null':'object');
    assert.equal(counts['caller-abort'],1); assert.equal(events[position('caller-abort')].reasonType,receipt.publicReasonProof.reasonType);
    add('held cleanup blocks public settlement',receipt.cancellation.whileCleanupHeldPublicPending);
    add('underlying read settled but cleanup still holds',receipt.afterReadWhileHeld.readPending===0 && receipt.afterReadWhileHeld.publicPending);
  } else assert.equal(counts['caller-abort']??0,0);
  add('exact interpreter-dependent primitive marks',equal(receipt.marks,expectedMarks));
  add('one actual engine evaluation and settlement',counters.engineEntered===1 && counters.engineSettled===1);
  add('one actual Budget construction',counters.budgetCreated===1);
  add('cooperative cleanup precedes actual public settlement',position('cleanup-done')<position('public-settle') && counters.cleanupRegistrations===1);
  if(identity==='F06') add('actual public rejection preserves caller reason including null',receipt.publicOutcome.rejected && receipt.publicReasonProof.rejected && receipt.publicReasonProof.exactIdentity && receipt.cancellation.callbackSawExactReason && receipt.cancellation.signalStoresExactReason);
  else add('real interpreter and envelope succeed',!receipt.publicOutcome.rejected && !receipt.engineOutcome.thrown && receipt.engineOutcome.ok===true && receipt.publicOutcome.sameEngineResult);
  add('intrinsic route actually entered where required',counters.intrinsicEntered===(identity==='F05'?2:['F03','F04','F06'].includes(identity)?1:0));
  add('actual host/read operations retire',counters.hostOperations===counters.hostOperationsSettled && counters.intrinsicEntered===counters.intrinsicSettled && counters.readsAdmitted===(['F01','F05'].includes(identity)?0:1) && counters.readsAdmitted===counters.readsSettled);
  add('virtual namespace and default write denial',true);
  if(identity==='F05') { ownRecord(receipt.cacheState,['hostValue','guestBackingValue','guestRecordsCreated','liveCacheEntries','backingJsonBytes']); for(const key of Object.keys(receipt.cacheState)) assert.ok(Number.isSafeInteger(receipt.cacheState[key]) && receipt.cacheState[key]>=0); assert.equal(receipt.cacheState.guestRecordsCreated,1); assert.equal(receipt.cacheState.liveCacheEntries,0); add('ordinary host record remains isolated',receipt.cacheState.hostValue===1); }
  denseData(receipt.assertions,predicates.length); assert.equal(receipt.assertions.length,predicates.length,'ASSERTION_INVENTORY');
  for(let index=0;index<predicates.length;index++) { const entry=receipt.assertions[index]; ownRecord(entry,['name','pass'],['reason']); assert.equal(entry.name,predicates[index].name); assert.equal(typeof entry.pass,'boolean'); assert.equal(entry.pass,predicates[index].pass,'ASSERTION_OBSERVATION_CONTRADICTION'); if(entry.pass) assert.ok(!Object.hasOwn(entry,'reason')); else { assert.ok(Object.hasOwn(entry,'reason')); reasonShape(entry.reason); } }
  const classification=predicates.every(entry=>entry.pass)?'PASS':'ASSERTION_FAILURE_CLEAN';
  assert.equal(receipt.classification,classification); assert.equal(result.row.status,classification==='PASS'?0:1);
  return {classification,predicates:predicates.length};
}
function acceptEvaluation(label, admitted, result) {
  guard('after-' + label); immutable('after-' + label);
  const loads = auditLoads(label,admitted);
  const output = path.join(scratch,'logs',label,'receipt.json');
  const receiptBytes = readLimited(output,limits.receiptBytesPerChild), receipt = JSON.parse(receiptBytes);
  const rawBytes = readLimited(output+'.raw',limits.receiptBytesPerChild), raw = JSON.parse(rawBytes);
  assert.equal(sha(rawBytes),receipt.rawSha256,'RAW_RECEIPT_BINDING');
  ownRecord(raw.engineOutcome,['settled','thrown','ok','error','stats']);
  delete raw.engineOutcome.stats;
  const normalized = {...receipt}; delete normalized.rawSha256;
  assert.deepEqual(raw,normalized,'RAW_NORMALIZED_RECONCILIATION');
  const terminal = JSON.parse(result.stdout.toString());
  const reconciliation = reconcileReceipt(label,receipt,terminal,result,loads,receiptBytes);
  const observation = {label,classification:receipt.classification,receiptSha256:sha(receiptBytes),rawSha256:sha(rawBytes),counters:receipt.counters,loads,reconciliation};
  evidence.observations.push(observation);
  return observation;
}
return { acceptEvaluation, reconcileReceipt, evidence };
}
