import { createFsFromVolume, Volume } from 'memfs';
import { expect, it } from 'vitest';
import { createDiskAdmissionStore } from './admissions.js';
import { createJobStateJournal } from './job-state.js';

it.each(['unknown-outcome', 'sandbox-lost'] as const)('does not record provider failure as native evidence in %s', async stage => {
  const records = new Map<string, import('./admissions.js').AdmissionRecord>();
  const journal = createJobStateJournal({
    async record(value) { records.set(value.operationId, structuredClone(value)); },
    async inspect(id) { return structuredClone(records.get(id) ?? null); },
  }, {operationId:'loss-provider-error',epoch:'e',tenantId:'t',principalId:'p',kind:'job',requestDigest:'a'.repeat(64)});
  await journal.append({stage:'accepted',retainedUntil:100,effectBarrier:'0'});
  await journal.append({stage:'running',retainedUntil:100,effectBarrier:'0'});
  await expect(journal.append({stage,retainedUntil:100,effectBarrier:'0',cleanup:'unknown',
    processOutcome:{kind:'executionError',error:{category:'transport',code:'unavailable',message:'Provider unavailable',phase:'unknown'}}}))
    .rejects.toThrow('Confirmed native outcome is required');
  expect(await journal.inspect(1)).toMatchObject({stage:'running',sequence:'2'});
  expect(records.size).toBe(2);
});

it.each(['unknown-outcome', 'sandbox-lost'] as const)('rejects retained %s history with invented provider process evidence', async stage => {
  const records = new Map<string, import('./admissions.js').AdmissionRecord>();
  const store = {
    async record(value: import('./admissions.js').AdmissionRecord) { records.set(value.operationId, structuredClone(value)); },
    async inspect(id: string) { return structuredClone(records.get(id) ?? null); },
  };
  const identity = {operationId:'retained-provider-error',epoch:'e',tenantId:'t',principalId:'p',kind:'job',requestDigest:'a'.repeat(64)};
  const journal = createJobStateJournal(store, identity);
  await journal.append({stage:'accepted',retainedUntil:100,effectBarrier:'0'});
  await journal.append({stage:'running',retainedUntil:100,effectBarrier:'0'});
  await journal.recover(1, stage);
  const lost = [...records.values()].find(value => value.jobState?.stage === stage)!;
  lost.jobState!.processOutcome = {kind:'executionError',error:{category:'transport',code:'unavailable',message:'Provider unavailable',phase:'unknown'}};
  const reconnect = createJobStateJournal(store, identity);
  await expect(reconnect.inspect(2)).rejects.toMatchObject({status:410});
  await expect(reconnect.recover(2, 'sandbox-lost')).rejects.toMatchObject({status:410});
  expect(records.size).toBe(3);
});

it('reclaims the complete invocation history at its fixed TTL without granting recovery execution authority', async () => {
  const fs = createFsFromVolume(Volume.fromJSON({'/ledger': null})).promises;
  await fs.chmod('/ledger', 0o700);
  const store = createDiskAdmissionStore({root:'/ledger',fs:fs as never,ownerId:(await fs.lstat('/ledger')).uid,maxRecordBytes:8192});
  const identity = {operationId:'cleanup-boundary',epoch:'e',tenantId:'t',principalId:'p',kind:'job',requestDigest:'a'.repeat(64)};
  const owner = createJobStateJournal(store, identity);
  await owner.append({stage:'accepted',retainedUntil:100,effectBarrier:'0'});
  await owner.append({stage:'running',retainedUntil:100,effectBarrier:'0'});
  await owner.append({stage:'process-exited',retainedUntil:100,effectBarrier:'2',processOutcome:{kind:'exited',exitCode:0}});
  await store.sweep!(99);
  const reconnect = createJobStateJournal(store, identity);
  expect(await reconnect.inspect(99)).toMatchObject({stage:'process-exited',sequence:'3',effectBarrier:'2'});
  await store.sweep!(100);
  expect(await fs.readdir('/ledger')).toEqual([]);
  await expect(reconnect.recover(100,'sandbox-lost')).rejects.toMatchObject({status:410});
  expect(await fs.readdir('/ledger')).toEqual([]);
});

it.each([50, 200])('refuses changing invocation retention to %i during a durable transition', async retainedUntil => {
  const records = new Map<string, import('./admissions.js').AdmissionRecord>();
  const journal = createJobStateJournal({
    async record(value) { records.set(value.operationId, structuredClone(value)); },
    async inspect(id) { return records.get(id) ?? null; },
  }, {operationId:'fixed-retention',epoch:'e',tenantId:'t',principalId:'p',kind:'job',requestDigest:'a'.repeat(64)});
  await journal.append({stage:'accepted',retainedUntil:100,effectBarrier:'0'});
  await expect(journal.append({stage:'running',retainedUntil,effectBarrier:'0'})).rejects.toThrow('Invocation retention deadline cannot change');
  expect(await journal.inspect(99)).toMatchObject({stage:'accepted',sequence:'1',retainedUntil:100});
  await expect(journal.inspect(100)).rejects.toMatchObject({status:410});
  expect(records.size).toBe(1);
});

it.each(['transition', 'record-ttl', 'missing-record-ttl'] as const)('refuses reconnect history with contradictory retention: %s', async corruption => {
  const records = new Map<string, import('./admissions.js').AdmissionRecord>();
  const store = {
    async record(value: import('./admissions.js').AdmissionRecord) { records.set(value.operationId, structuredClone(value)); },
    async inspect(id: string) { return records.get(id) ?? null; },
  };
  const identity = {operationId:'retention-loss',epoch:'e',tenantId:'t',principalId:'p',kind:'job',requestDigest:'a'.repeat(64)};
  const owner = createJobStateJournal(store, identity);
  await owner.append({stage:'accepted',retainedUntil:100,effectBarrier:'0'});
  await owner.append({stage:'running',retainedUntil:100,effectBarrier:'0'});
  const running = [...records.values()].find(record => record.jobState?.stage === 'running')!;
  if (corruption === 'transition') { running.retainedUntil = 200; running.jobState!.retainedUntil = 200; }
  else if (corruption === 'record-ttl') running.retainedUntil = 50;
  else delete running.retainedUntil;
  const reconnect = createJobStateJournal(store, identity);
  await expect(reconnect.inspect(60)).rejects.toMatchObject({status:410});
  await expect(reconnect.recover(60,'unknown-outcome')).rejects.toMatchObject({status:410});
  expect(records.size).toBe(2);
});

it.each(['accepted', 'running'] as const)('refuses native outcome metadata in %s before an exit observation', async stage => {
  const records = new Map<string, import('./admissions.js').AdmissionRecord>();
  const journal = createJobStateJournal({
    async record(value) { records.set(value.operationId, structuredClone(value)); },
    async inspect(id) { return records.get(id) ?? null; },
  }, {operationId:'premature-exit',epoch:'e',tenantId:'t',principalId:'p',kind:'job',requestDigest:'a'.repeat(64)});
  if (stage === 'running') await journal.append({stage:'accepted',retainedUntil:100,effectBarrier:'0'});
  await expect(journal.append({stage,retainedUntil:100,effectBarrier:'0',processOutcome:{kind:'exited',exitCode:0}})).rejects.toThrow('Native outcome cannot precede process exit');
  expect(records.size).toBe(stage === 'accepted' ? 0 : 1);
});

it.each([
  {kind:'unknown',reason:'Lost attachment'},
  {kind:'executionError',error:{category:'transport',code:'lost',message:'Interrupted',phase:'unknown'}},
  {kind:'canceled',terminationConfirmed:false},
] satisfies import('./wire.generated.js').Outcome[])('refuses uncertain native outcomes as durable process exit: %j', async processOutcome => {
  const records = new Map<string, import('./admissions.js').AdmissionRecord>();
  const journal = createJobStateJournal({
    async record(value) { records.set(value.operationId, structuredClone(value)); },
    async inspect(id) { return records.get(id) ?? null; },
  }, {operationId:'uncertain-exit',epoch:'e',tenantId:'t',principalId:'p',kind:'job',requestDigest:'a'.repeat(64)});
  await journal.append({stage:'accepted',retainedUntil:100,effectBarrier:'0'});
  await journal.append({stage:'running',retainedUntil:100,effectBarrier:'0'});
  await expect(journal.append({stage:'process-exited',retainedUntil:100,effectBarrier:'0',processOutcome})).rejects.toThrow('Confirmed native outcome is required');
  expect(await journal.inspect(0)).toMatchObject({stage:'running',sequence:'2'});
});

it('refuses retained history that presents transport uncertainty as an observed native exit', async () => {
  const records = new Map<string, import('./admissions.js').AdmissionRecord>();
  const store = {
    async record(value: import('./admissions.js').AdmissionRecord) { records.set(value.operationId, structuredClone(value)); },
    async inspect(id: string) { return records.get(id) ?? null; },
  };
  const identity = {operationId:'false-retained-exit',epoch:'e',tenantId:'t',principalId:'p',kind:'job',requestDigest:'a'.repeat(64)};
  const journal = createJobStateJournal(store, identity);
  await journal.append({stage:'accepted',retainedUntil:100,effectBarrier:'0'});
  await journal.append({stage:'running',retainedUntil:100,effectBarrier:'0'});
  await journal.append({stage:'process-exited',retainedUntil:100,effectBarrier:'0',processOutcome:{kind:'exited',exitCode:0}});
  for (const value of records.values()) if (value.jobState?.stage === 'process-exited') value.jobState.processOutcome = {kind:'unknown',reason:'Lost native observation'};
  const reconnect = createJobStateJournal(store, identity);
  await expect(reconnect.inspect(10)).rejects.toMatchObject({status:410});
  await expect(reconnect.recover(10,'unknown-outcome')).rejects.toMatchObject({status:410});
  expect(records.size).toBe(3);
});

it.each(['request-missing','exit-won'] as const)('refuses a cancellation action contradicting durable linearization: %s', async schedule => {
  const records = new Map<string, import('./admissions.js').AdmissionRecord>();
  const journal = createJobStateJournal({
    async record(value) { records.set(value.operationId, structuredClone(value)); },
    async inspect(id) { return records.get(id) ?? null; },
  }, {operationId:'cancel-race',epoch:'e',tenantId:'t',principalId:'p',kind:'job',requestDigest:'a'.repeat(64)});
  await journal.append({stage:'accepted',retainedUntil:100,effectBarrier:'0'});
  await journal.append({stage:'running',retainedUntil:100,effectBarrier:'0'});
  if(schedule==='exit-won')await journal.append({stage:'process-exited',retainedUntil:100,effectBarrier:'0',processOutcome:{kind:'exited',exitCode:0}});
  await expect(journal.append({cancelRequested:schedule==='exit-won',cancelActed:true})).rejects.toThrow('Cancellation action');
  expect(await journal.inspect(0)).toMatchObject({sequence:schedule==='exit-won'?'3':'2'});
});

it('keeps cancellation before exit and a request after exit as distinct durable observations', async () => {
  for(const cancelFirst of [false,true]){
    const records = new Map<string, import('./admissions.js').AdmissionRecord>();
    const identity={operationId:'ordered-cancel',epoch:'e',tenantId:'t',principalId:'p',kind:'job',requestDigest:'a'.repeat(64)};
    const store={async record(value:import('./admissions.js').AdmissionRecord){records.set(value.operationId,structuredClone(value));},async inspect(id:string){return records.get(id)??null;}};
    const journal=createJobStateJournal(store,identity);
    await journal.append({stage:'accepted',retainedUntil:100,effectBarrier:'0'});
    await journal.append({stage:'running',retainedUntil:100,effectBarrier:'0'});
    if(cancelFirst)await journal.append({cancelRequested:true,cancelActed:true});
    await journal.append({stage:'process-exited',retainedUntil:100,effectBarrier:'0',processOutcome:{kind:'exited',exitCode:0}});
    if(!cancelFirst)await journal.append({cancelRequested:true,cancelActed:false});
    expect(await createJobStateJournal(store,identity).inspect(0)).toMatchObject({stage:'process-exited',cancelRequested:true,cancelActed:cancelFirst,processOutcome:{kind:'exited',exitCode:0}});
  }
});

it('requires a native observation before durable process-exited', async () => {
  const records = new Map<string, import('./admissions.js').AdmissionRecord>();
  const journal = createJobStateJournal({
    async record(value) { records.set(value.operationId, structuredClone(value)); },
    async inspect(id) { return records.get(id) ?? null; },
  }, {operationId:'missing-exit',epoch:'e',tenantId:'t',principalId:'p',kind:'job',requestDigest:'a'.repeat(64)});
  await journal.append({stage:'accepted',retainedUntil:100,effectBarrier:'0'});
  await journal.append({stage:'running',retainedUntil:100,effectBarrier:'0'});
  await expect(journal.append({stage:'process-exited',retainedUntil:100,effectBarrier:'0'})).rejects.toThrow('Native outcome observation is required');
  expect(records.size).toBe(2);
});

it.each(['process-exited', 'io-settled'] as const)('refuses retained %s history that lost its native observation', async stage => {
  const records = new Map<string, import('./admissions.js').AdmissionRecord>();
  const store = {
    async record(value: import('./admissions.js').AdmissionRecord) { records.set(value.operationId, structuredClone(value)); },
    async inspect(id: string) { return records.get(id) ?? null; },
  };
  const identity = {operationId:'lost-observation',epoch:'e',tenantId:'t',principalId:'p',kind:'job',requestDigest:'a'.repeat(64)};
  const journal = createJobStateJournal(store, identity);
  await journal.append({stage:'accepted',retainedUntil:100,effectBarrier:'0'});
  await journal.append({stage:'running',retainedUntil:100,effectBarrier:'0'});
  await journal.append({stage:'process-exited',retainedUntil:100,effectBarrier:'0',processOutcome:{kind:'exited',exitCode:0}});
  if (stage === 'io-settled') await journal.append({stage,retainedUntil:100,effectBarrier:'0',outputComplete:true,cleanup:'complete'});
  for (const record of records.values()) if (record.jobState) delete record.jobState.processOutcome;
  const reconnect = createJobStateJournal(store, identity);
  await expect(reconnect.inspect(10)).rejects.toMatchObject({status:410});
  await expect(reconnect.recover(10,'unknown-outcome')).rejects.toMatchObject({status:410});
  expect(records.size).toBe(stage === 'process-exited' ? 3 : 4);
});

it.each(['accepted','running','process-exited'] as const)('refuses fresh writer admission over retained %s history', async stage => {
  const records = new Map<string, import('./admissions.js').AdmissionRecord>();
  const store = {
    async record(value: import('./admissions.js').AdmissionRecord) { records.set(value.operationId, structuredClone(value)); },
    async inspect(id: string) { return records.get(id) ?? null; },
  };
  const identity = {operationId:'reconnect',epoch:'e',tenantId:'t',principalId:'p',kind:'job',requestDigest:'a'.repeat(64)};
  const owner = createJobStateJournal(store, identity);
  await owner.append({stage:'accepted',retainedUntil:100,effectBarrier:'0'});
  if (stage !== 'accepted') await owner.append({stage:'running',retainedUntil:100,effectBarrier:'0'});
  if (stage === 'process-exited') await owner.append({stage,retainedUntil:100,effectBarrier:'1',processOutcome:{kind:'exited',exitCode:0}});
  const retained = await owner.inspect(0);
  const reconnect = createJobStateJournal(store, identity);
  await expect(reconnect.append({stage:'accepted',retainedUntil:200,effectBarrier:'0'})).rejects.toMatchObject({status:410});
  expect(await reconnect.inspect(0)).toEqual(retained);
  expect(records.size).toBe(Number(retained!.sequence));
});

it.each(['sandbox-lost','unknown-outcome'] as const)('preserves completed settlement observations after %s', async stage => {
  const records = new Map<string, import('./admissions.js').AdmissionRecord>();
  const store = {async record(value:import('./admissions.js').AdmissionRecord) {records.set(value.operationId,structuredClone(value));},async inspect(id:string) {return records.get(id)??null;}};
  const identity = {operationId:'settled',epoch:'e',tenantId:'t',principalId:'p',kind:'job',requestDigest:'a'.repeat(64)};
  const journal = createJobStateJournal(store,identity);
  await journal.append({stage:'accepted',retainedUntil:100,effectBarrier:'0'});
  await journal.append({stage:'running',retainedUntil:100,effectBarrier:'0'});
  await journal.append({stage:'process-exited',retainedUntil:100,effectBarrier:'2',processOutcome:{kind:'exited',exitCode:0}});
  await journal.append({stage:'io-settled',retainedUntil:100,effectBarrier:'2',outputComplete:true,cleanup:'complete'});
  const recovered = await createJobStateJournal(store,identity).recover(10,stage);
  expect(recovered.event).toMatchObject({stage,sequence:'5',effectBarrier:'2',processOutcome:{kind:'exited',exitCode:0},outputComplete:true,cleanup:'complete'});
  expect(recovered.actions).toContain('reauthorize');
  expect(await createJobStateJournal(store,identity).inspect(10)).toEqual(recovered.event);
  const refined = await createJobStateJournal(store,identity).recover(10,'sandbox-lost');
  expect(refined.event).toMatchObject({stage:'sandbox-lost',effectBarrier:'2',outputComplete:true,cleanup:'complete'});
});

it('preserves completed cleanup independently from incomplete output on sandbox loss', async () => {
  const records = new Map<string, import('./admissions.js').AdmissionRecord>();
  const journal = createJobStateJournal({async record(value) {records.set(value.operationId,structuredClone(value));},async inspect(id) {return records.get(id)??null;}},
    {operationId:'partial',epoch:'e',tenantId:'t',principalId:'p',kind:'job',requestDigest:'a'.repeat(64)});
  await journal.append({stage:'accepted',retainedUntil:100,effectBarrier:'0'});
  await journal.append({stage:'running',retainedUntil:100,effectBarrier:'0'});
  await journal.append({stage:'process-exited',retainedUntil:100,effectBarrier:'1',processOutcome:{kind:'exited',exitCode:0},outputComplete:false,cleanup:'complete'});
  expect((await journal.recover(10,'sandbox-lost')).event).toMatchObject({stage:'sandbox-lost',effectBarrier:'1',processOutcome:{kind:'exited',exitCode:0},outputComplete:false,cleanup:'complete'});
});

it.each(['1','2'] )('refuses partial durable-state loss at sequence %s rather than reporting stale acceptance', async missing => {
 const records=new Map<string,import('./admissions.js').AdmissionRecord>();
 const store={async record(value:import('./admissions.js').AdmissionRecord){records.set(value.operationId,structuredClone(value));},async inspect(id:string){return records.get(id)??null;}};
 const identity={operationId:'i',epoch:'e',tenantId:'t',principalId:'p',kind:'job',requestDigest:'a'.repeat(64)};
 const journal=createJobStateJournal(store,identity);
 await journal.append({stage:'accepted',retainedUntil:100,effectBarrier:'0'});
 await journal.append({stage:'running',retainedUntil:100,effectBarrier:'0'});
 await journal.append({stage:'process-exited',retainedUntil:100,effectBarrier:'1',processOutcome:{kind:'exited',exitCode:0}});
 for(const [id,record] of records)if(record.jobState?.sequence===missing)records.delete(id);
 const reconnected=createJobStateJournal(store,identity);
 await expect(reconnected.inspect(10)).rejects.toMatchObject({status:410});
 await expect(reconnected.recover(10,'unknown-outcome')).rejects.toMatchObject({status:410});
 expect(records.size).toBe(2);
});

it.each(['unknown-outcome', 'sandbox-lost'] as const)('retains a cancellation observation after %s without changing the lost outcome', async stage => {
  const records = new Map<string, import('./admissions.js').AdmissionRecord>();
  const journal = createJobStateJournal({
    async record(value) { records.set(value.operationId, structuredClone(value)); },
    async inspect(id) { return records.get(id) ?? null; },
  }, {operationId:'i',epoch:'e',tenantId:'t',principalId:'p',kind:'job',requestDigest:'a'.repeat(64)});
  await journal.append({stage:'accepted',retainedUntil:100,effectBarrier:'0'});
  await journal.recover(10, stage);
  const observation = await journal.append({cancelRequested:true,cancelActed:false});
  expect(observation).toMatchObject({stage,sequence:'3',cancelRequested:true,cancelActed:false,cleanup:'unknown',outputComplete:false});
  expect(await journal.inspect(10)).toEqual(observation);
});

it('linearizes loss recovery and subsequent transitions while durable inspection is pending', async () => {
  const records = new Map<string, import('./admissions.js').AdmissionRecord>();
  let inspecting!: () => void; let release!: () => void;
  const entered = new Promise<void>(resolve => { inspecting = resolve; });
  const barrier = new Promise<void>(resolve => { release = resolve; });
  let pause = false;
  const store = {
    async record(value: import('./admissions.js').AdmissionRecord) { records.set(value.operationId, structuredClone(value)); },
    async inspect(id: string) {
      const value = structuredClone(records.get(id) ?? null);
      if (pause && value?.jobState?.sequence === '1') { inspecting(); await barrier; }
      return value;
    },
  };
  const journal = createJobStateJournal(store, {operationId:'i',epoch:'e',tenantId:'t',principalId:'p',kind:'job',requestDigest:'a'.repeat(64)});
  await journal.append({stage:'accepted',retainedUntil:100,effectBarrier:'0'});
  pause = true;
  const recovery = journal.recover(10, 'unknown-outcome');
  await entered;
  const loss = journal.append({stage:'sandbox-lost',retainedUntil:100,effectBarrier:'0',cleanup:'unknown',outputComplete:false});
  release();
  const [recovered, lost] = await Promise.all([recovery, loss]);
  expect(recovered.event).toMatchObject({stage:'unknown-outcome',sequence:'2'});
  expect(lost).toMatchObject({stage:'sandbox-lost',sequence:'3'});
  pause = false;
  expect(await journal.inspect(10)).toMatchObject({stage:'sandbox-lost',sequence:'3'});
  expect(records.size).toBe(3);
});

it('owns its invocation identity and payload/build binding before durable writes', async () => {
  const records = new Map<string, import('./admissions.js').AdmissionRecord>();
  const store = {async record(value:import('./admissions.js').AdmissionRecord) { records.set(value.operationId, structuredClone(value)); }, async inspect(id:string) { return records.get(id) ?? null; }};
  const identity = {operationId:'invocation',epoch:'e',tenantId:'t',principalId:'p',sessionId:'s',kind:'job',requestDigest:'a'.repeat(64),buildDigest:'b'.repeat(64)};
  const original = structuredClone(identity);
  const journal = createJobStateJournal(store, identity);
  const accepted = journal.append({stage:'accepted',retainedUntil:100,effectBarrier:'0'});
  identity.operationId = 'replacement'; identity.requestDigest = 'c'.repeat(64); identity.buildDigest = 'd'.repeat(64);
  await accepted;
  expect(await createJobStateJournal(store, original).inspect(0)).toMatchObject({stage:'accepted',sequence:'1'});
  await expect(createJobStateJournal(store, {...original,requestDigest:identity.requestDigest}).inspect(0)).rejects.toMatchObject({status:409});
});

it.each([
 {outputComplete:false,cleanup:'complete' as const},
 {outputComplete:true,cleanup:'pending' as const},
 {outputComplete:true,cleanup:'unknown' as const},
])('refuses durable I/O settlement with incomplete barriers: %j',async barriers=>{
 const records=new Map<string,import('./admissions.js').AdmissionRecord>();
 const journal=createJobStateJournal({async record(value){records.set(value.operationId,structuredClone(value));},async inspect(id){return records.get(id)??null;}},
 {operationId:'i',epoch:'e',tenantId:'t',principalId:'p',kind:'job',requestDigest:'a'.repeat(64)});
 await journal.append({stage:'accepted',retainedUntil:100,effectBarrier:'0'});
 await journal.append({stage:'running',retainedUntil:100,effectBarrier:'0'});
 await journal.append({stage:'process-exited',retainedUntil:100,effectBarrier:'0',processOutcome:{kind:'exited',exitCode:0}});
 await expect(journal.append({stage:'io-settled',retainedUntil:100,effectBarrier:'0',...barriers})).rejects.toThrow('I/O settlement requires complete output and cleanup');
 expect(await journal.inspect(0)).toMatchObject({stage:'process-exited',sequence:'3',processOutcome:{kind:'exited',exitCode:0}});
});

it('refuses additional contradictory fields on an already observed native outcome',async()=>{
 const records=new Map<string,import('./admissions.js').AdmissionRecord>();
 const journal=createJobStateJournal({async record(value){records.set(value.operationId,structuredClone(value));},async inspect(id){return records.get(id)??null;}},
 {operationId:'i',epoch:'e',tenantId:'t',principalId:'p',kind:'job',requestDigest:'a'.repeat(64)});
 await journal.append({stage:'accepted',retainedUntil:100,effectBarrier:'0'});
 await journal.append({stage:'running',retainedUntil:100,effectBarrier:'0'});
 await journal.append({stage:'process-exited',retainedUntil:100,effectBarrier:'0',processOutcome:{kind:'canceled',terminationConfirmed:true}});
 await expect(journal.append({stage:'process-exited',retainedUntil:100,effectBarrier:'0',processOutcome:{kind:'canceled',terminationConfirmed:true,signal:'SIGTERM'}})).rejects.toThrow('Observed native outcome cannot change');
 expect(await journal.inspect(0)).toMatchObject({stage:'process-exited',sequence:'3',processOutcome:{kind:'canceled',terminationConfirmed:true}});
});

it('retains unknown outcome without manufacturing native process evidence',async()=>{
 const records=new Map<string,import('./admissions.js').AdmissionRecord>();
 const journal=createJobStateJournal({async record(value){records.set(value.operationId,structuredClone(value));},async inspect(id){return records.get(id)??null;}},
 {operationId:'i',epoch:'e',tenantId:'t',principalId:'p',kind:'job',requestDigest:'a'.repeat(64)});
 const processOutcome:import('./wire.generated.js').Outcome={kind:'executionError',error:{category:'transport',code:'lost',message:'Interrupted',phase:'unknown'}};
 await journal.append({stage:'accepted',retainedUntil:100,effectBarrier:'0'});
 await journal.append({stage:'running',retainedUntil:100,effectBarrier:'0'});
 const lost=await journal.append({stage:'unknown-outcome',retainedUntil:100,effectBarrier:'0',outputComplete:false,cleanup:'unknown'});
 expect(lost).toMatchObject({stage:'unknown-outcome',sequence:'3'});
 expect(lost.processOutcome).toBeUndefined();
 expect(await journal.inspect(0)).toEqual(lost);
 await expect(journal.append({stage:'io-settled',retainedUntil:100,effectBarrier:'0',processOutcome:structuredClone(processOutcome),outputComplete:true,cleanup:'complete'})).rejects.toThrow('Invalid durable job transition');
});

it('deduplicates simultaneous loss observations in one durable invocation owner', async () => {
 const records=new Map<string,import('./admissions.js').AdmissionRecord>();
 const journal=createJobStateJournal({async record(value){records.set(value.operationId,structuredClone(value));},async inspect(id){return records.get(id)??null;}},
 {operationId:'i',epoch:'e',tenantId:'t',principalId:'p',kind:'job',requestDigest:'a'.repeat(64)});
 await journal.append({stage:'accepted',retainedUntil:100,effectBarrier:'0'});
 const results=await Promise.all([journal.recover(10,'unknown-outcome'),journal.recover(10,'unknown-outcome')]);
 expect(results.map(result=>result.event.sequence)).toEqual(['2','2']);
 expect(records.size).toBe(2);
});

it('preserves cancellation and native exit observations and rejects a regressing effect barrier', async () => {
 const records=new Map<string,import('./admissions.js').AdmissionRecord>();
 const journal=createJobStateJournal({async record(value){records.set(value.operationId,structuredClone(value));},async inspect(id){return records.get(id)??null;}},
 {operationId:'i',epoch:'e',tenantId:'t',principalId:'p',kind:'job',requestDigest:'a'.repeat(64)});
 await journal.append({stage:'accepted',retainedUntil:100,effectBarrier:'0'});
 await journal.append({stage:'running',retainedUntil:100,effectBarrier:'1',cancelRequested:true,cancelActed:true});
 await journal.append({stage:'process-exited',retainedUntil:100,effectBarrier:'2',processOutcome:{kind:'exited',exitCode:0}});
 const settled=await journal.append({stage:'io-settled',retainedUntil:100,effectBarrier:'2',outputComplete:true,cleanup:'complete'});
 expect(settled).toMatchObject({cancelRequested:true,cancelActed:true,processOutcome:{kind:'exited',exitCode:0}});
 await expect(journal.append({stage:'io-settled',retainedUntil:100,effectBarrier:'1'})).rejects.toThrow('Effect barrier');
 expect(await journal.inspect(0)).toMatchObject({sequence:'4',effectBarrier:'2'});
});

it('serializes cancellation observations behind pending exit persistence', async () => {
  const records = new Map<string, import('./admissions.js').AdmissionRecord>();
  let release!: () => void; let entered!: () => void;
  const ready = new Promise<void>(resolve => { entered = resolve; });
  const barrier = new Promise<void>(resolve => { release = resolve; });
  const journal = createJobStateJournal({async record(value) {
    if (value.jobState?.stage === 'process-exited') { entered(); await barrier; }
    records.set(value.operationId, structuredClone(value));
  }, async inspect(id) { return records.get(id) ?? null; }},
  {operationId:'i',epoch:'e',tenantId:'t',principalId:'p',kind:'job',requestDigest:'a'.repeat(64)});
  await journal.append({stage:'accepted',retainedUntil:100,effectBarrier:'0'});
  await journal.append({stage:'running',retainedUntil:100,effectBarrier:'0'});
  const exit = journal.append({stage:'process-exited',retainedUntil:100,effectBarrier:'2',processOutcome:{kind:'exited',exitCode:0}});
  await ready;
  const cancel = journal.append({cancelRequested:true,cancelActed:false});
  release(); await exit;
  expect(await cancel).toMatchObject({stage:'process-exited',sequence:'4',effectBarrier:'2',cancelRequested:true,processOutcome:{kind:'exited',exitCode:0}});
});

it('recovers versioned transitions from durable records without launching and binds payload/build', async () => {
  const fs = createFsFromVolume(Volume.fromJSON({'/ledger': null})).promises;
  await fs.chmod('/ledger', 0o700);
  const store = createDiskAdmissionStore({root:'/ledger',fs:fs as never,ownerId:(await fs.lstat('/ledger')).uid,maxRecordBytes:8192});
  const identity = {operationId:'invocation',epoch:'epoch',tenantId:'tenant',principalId:'principal',sessionId:'session',kind:'job',requestDigest:'a'.repeat(64),buildDigest:'b'.repeat(64)};
  const journal = createJobStateJournal(store, identity);
  await journal.append({stage:'accepted',retainedUntil:100, effectBarrier:'0'});
  await journal.append({stage:'running',retainedUntil:100,effectBarrier:'0'});
  await journal.append({stage:'process-exited',retainedUntil:100,effectBarrier:'1',processOutcome:{kind:'exited',exitCode:0}});
  const reconnected = createJobStateJournal(store, identity);
  expect(await reconnected.inspect(10)).toMatchObject({version:1,sequence:'3',stage:'process-exited',processOutcome:{kind:'exited',exitCode:0}});
  await expect(createJobStateJournal(store,{...identity,requestDigest:'c'.repeat(64)}).inspect(10)).rejects.toMatchObject({status:409});
  await expect(reconnected.inspect(101)).rejects.toMatchObject({status:410});
});

it('never advances or publishes a later durable state after a failed persistence', async () => {
  const records = new Map(); let fail = false;
  const journal = createJobStateJournal({async record(value){if(fail)throw new Error('unavailable');records.set(value.operationId,structuredClone(value));},async inspect(id){return records.get(id)??null;}},
    {operationId:'i',epoch:'e',tenantId:'t',principalId:'p',kind:'job',requestDigest:'a'.repeat(64)});
  await journal.append({stage:'accepted',retainedUntil:100,effectBarrier:'0'});
  fail = true;
  await expect(journal.append({stage:'running',retainedUntil:100,effectBarrier:'0'})).rejects.toThrow('unavailable');
  fail = false;
  await expect(journal.append({stage:'io-settled',retainedUntil:100,effectBarrier:'0'})).rejects.toThrow();
  expect(await journal.inspect(0)).toMatchObject({stage:'accepted',sequence:'1'});
  // Reading retained evidence must not reopen admission after persistence loss.
  await expect(journal.append({stage:'running',retainedUntil:100,effectBarrier:'0'})).rejects.toThrow('unavailable');
});

it('records sandbox loss with explicit recovery and retains observed exit without claiming shell success',async()=>{
 const records=new Map();const store={async record(value:import('./admissions.js').AdmissionRecord){records.set(value.operationId,structuredClone(value));},async inspect(id:string){return records.get(id)??null;}};
 const identity={operationId:'i',epoch:'e',tenantId:'t',principalId:'p',kind:'job',requestDigest:'a'.repeat(64)};
 const first=createJobStateJournal(store,identity);await first.append({stage:'accepted',retainedUntil:100,effectBarrier:'0'});await first.append({stage:'running',retainedUntil:100,effectBarrier:'0'});await first.append({stage:'process-exited',retainedUntil:100,effectBarrier:'1',processOutcome:{kind:'exited',exitCode:0}});
 const recovery=await createJobStateJournal(store,identity).recover(10,'sandbox-lost');
 expect(recovery).toMatchObject({event:{stage:'sandbox-lost',sequence:'4',processOutcome:{kind:'exited',exitCode:0},outputComplete:false},actions:['inspect','recover-partial-outputs','reauthorize','start-new-invocation']});
 expect(await createJobStateJournal(store,identity).inspect(10)).toMatchObject({stage:'sandbox-lost'});
});

it('records unavailable recovery after settlement and can refine unknown outcome to confirmed sandbox loss',async()=>{
 const records=new Map();const store={async record(value:import('./admissions.js').AdmissionRecord){records.set(value.operationId,structuredClone(value));},async inspect(id:string){return records.get(id)??null;}};
 const identity={operationId:'i',epoch:'e',tenantId:'t',principalId:'p',kind:'job',requestDigest:'a'.repeat(64)};const journal=createJobStateJournal(store,identity);
 for(const stage of ['accepted','running','process-exited','io-settled'] as const)await journal.append({stage,retainedUntil:100,effectBarrier:'1',...(stage==='process-exited'?{processOutcome:{kind:'exited' as const,exitCode:0}}:{}),...(stage==='io-settled'?{outputComplete:true,cleanup:'complete' as const}:{})});
 expect((await createJobStateJournal(store,identity).recover(10,'unknown-outcome')).event).toMatchObject({stage:'unknown-outcome',sequence:'5'});
 expect((await createJobStateJournal(store,identity).recover(10,'sandbox-lost')).event).toMatchObject({stage:'sandbox-lost',sequence:'6'});
});

it.each([
  {outputComplete:false},
  {cleanup:'pending' as const},
  {cleanup:'unknown' as const},
])('never retracts a completed durable settlement barrier: %j', async regression => {
  const records = new Map<string, import('./admissions.js').AdmissionRecord>();
  const journal = createJobStateJournal({
    async record(value) { records.set(value.operationId, structuredClone(value)); },
    async inspect(id) { return records.get(id) ?? null; },
  }, {operationId:'barriers',epoch:'e',tenantId:'t',principalId:'p',kind:'job',requestDigest:'a'.repeat(64)});
  await journal.append({stage:'accepted',retainedUntil:100,effectBarrier:'0'});
  await journal.append({stage:'running',retainedUntil:100,effectBarrier:'0'});
  await journal.append({stage:'process-exited',retainedUntil:100,effectBarrier:'1',processOutcome:{kind:'exited',exitCode:0},outputComplete:true,cleanup:'complete'});
  await expect(journal.append({stage:'unknown-outcome',retainedUntil:100,effectBarrier:'1',...regression})).rejects.toThrow('Completed settlement barrier cannot regress');
  expect(await journal.inspect(0)).toMatchObject({sequence:'3',outputComplete:true,cleanup:'complete'});
});

it.each(['stage','effectBarrier','processOutcome','outputComplete','cleanup','cancelRequested'] as const)('refuses contradictory retained %s during reconnect inspection', async field => {
  const records = new Map<string, import('./admissions.js').AdmissionRecord>();
  const store = {
    async record(value:import('./admissions.js').AdmissionRecord) { records.set(value.operationId, structuredClone(value)); },
    async inspect(id:string) { return records.get(id) ?? null; },
  };
  const identity = {operationId:'inspection',epoch:'e',tenantId:'t',principalId:'p',kind:'job',requestDigest:'a'.repeat(64)};
  const journal = createJobStateJournal(store, identity);
  await journal.append({stage:'accepted',retainedUntil:100,effectBarrier:'0'});
  await journal.append({stage:'running',retainedUntil:100,effectBarrier:'1',cancelRequested:true});
  await journal.append({stage:'process-exited',retainedUntil:100,effectBarrier:'2',processOutcome:{kind:'exited',exitCode:0},outputComplete:true,cleanup:'complete'});
  await journal.append({stage:'io-settled',retainedUntil:100,effectBarrier:'2',outputComplete:true,cleanup:'complete'});
  const final = [...records.values()].find(value => value.jobState?.sequence === '4')!;
  Object.assign(final.jobState!, {
    stage:{stage:'accepted'}, effectBarrier:{effectBarrier:'0'}, processOutcome:{processOutcome:{kind:'exited',exitCode:1}},
    outputComplete:{outputComplete:false}, cleanup:{cleanup:'unknown'}, cancelRequested:{cancelRequested:false},
  }[field]);
  const reconnected = createJobStateJournal(store, identity);
  await expect(reconnected.inspect(0)).rejects.toMatchObject({status:410});
  await expect(reconnected.recover(0,'unknown-outcome')).rejects.toMatchObject({status:410});
  expect(records.size).toBe(4);
});

it('does not mistake transitions racing reconnect inspection for a truncated durable prefix', async () => {
  const records = new Map<string, import('./admissions.js').AdmissionRecord>();
  let enter!: () => void; let release!: () => void;
  const entered = new Promise<void>(resolve => { enter = resolve; });
  const barrier = new Promise<void>(resolve => { release = resolve; });
  let paused = false;
  let reconnecting = false;
  const journal = createJobStateJournal({
    async record(value) { records.set(value.operationId, structuredClone(value)); },
    async inspect(id) {
      const value = structuredClone(records.get(id) ?? null);
      if (reconnecting && !paused && value === null) { paused = true; enter(); await barrier; }
      return value;
    },
  }, {operationId:'inspect-race',epoch:'e',tenantId:'t',principalId:'p',kind:'job',requestDigest:'a'.repeat(64)});
  await journal.append({stage:'accepted',retainedUntil:100,effectBarrier:'0'});
  reconnecting = true;
  const inspection = journal.inspect(0);
  // Observe the rejection immediately so the intentionally failing schedule
  // cannot introduce an unhandled promise rejection.
  const observed = inspection.then(value => ({value}), error => ({error}));
  await entered;
  const running = journal.append({stage:'running',retainedUntil:100,effectBarrier:'0'});
  const exit = journal.append({stage:'process-exited',retainedUntil:100,effectBarrier:'0',processOutcome:{kind:'exited',exitCode:0}});
  // Allow an uncoordinated writer to fill the missed slot and publish its tail.
  for (let turn = 0; turn < 10; turn++) await Promise.resolve();
  release();
  expect(await observed).toMatchObject({value:{stage:'accepted',sequence:'1'}});
  await Promise.all([running, exit]);
  expect(await journal.inspect(0)).toMatchObject({stage:'process-exited',sequence:'3'});
});

it.each([0, 1, 2])('recovers a contiguous prefix published while an independent reconnect reader scans after %i transitions', async initial => {
  const records = new Map<string, import('./admissions.js').AdmissionRecord>();
  let enter!: () => void; let release!: () => void;
  const entered = new Promise<void>(resolve => { enter = resolve; });
  const barrier = new Promise<void>(resolve => { release = resolve; });
  let paused = false; let reconnecting = false;
  const store = {
    async record(value: import('./admissions.js').AdmissionRecord) { records.set(value.operationId, structuredClone(value)); },
    async inspect(id: string) {
      const value = structuredClone(records.get(id) ?? null);
      if (reconnecting && !paused && value === null) { paused = true; enter(); await barrier; }
      return value;
    },
  };
  const identity = {operationId:'independent-reader',epoch:'e',tenantId:'t',principalId:'p',kind:'job',requestDigest:'a'.repeat(64)};
  const owner = createJobStateJournal(store, identity);
  if (initial >= 1) await owner.append({stage:'accepted',retainedUntil:100,effectBarrier:'0'});
  if (initial >= 2) await owner.append({stage:'running',retainedUntil:100,effectBarrier:'0'});
  reconnecting = true;
  const reader = createJobStateJournal(store, identity);
  const inspection = reader.inspect(0).then(value => ({value}), error => ({error}));
  await entered;
  if (initial < 1) await owner.append({stage:'accepted',retainedUntil:100,effectBarrier:'0'});
  if (initial < 2) await owner.append({stage:'running',retainedUntil:100,effectBarrier:'0'});
  await owner.append({stage:'process-exited',retainedUntil:100,effectBarrier:'1',processOutcome:{kind:'exited',exitCode:0}});
  release();
  // Without an observed later slot, the pre-publication snapshot remains valid.
  expect(await inspection).toMatchObject({value:initial === 2
    ? {stage:'running',sequence:'2',effectBarrier:'0'}
    : {stage:'process-exited',sequence:'3',effectBarrier:'1',processOutcome:{kind:'exited',exitCode:0}}});
  expect(await reader.inspect(0)).toMatchObject({stage:'process-exited',sequence:'3',processOutcome:{kind:'exited',exitCode:0}});
  expect(records.size).toBe(3);
  await expect(reader.append({stage:'accepted',retainedUntil:100,effectBarrier:'0'})).rejects.toMatchObject({status:410});
});
