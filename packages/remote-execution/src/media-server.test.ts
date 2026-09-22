import { describe, expect, it, vi } from 'vitest';
import { createMediaServer } from './media-server.js';
import type { Build, JobRequest, Limits, SessionRequest } from './wire.generated.js';
import type { NativeProcess } from './native-process.js';
import {createContainerExecutionDriver,createRemoteExecutionRoute} from './deployment.js';
import {createRestExecutionDriver} from './rest-driver.js';
import {createModalExecutionDriver} from './modal-driver.js';
import restProvider from './providers/rest.js';
import cloudflareProvider from './providers/cloudflare.js';
import modalProvider from './providers/modal.js';

// Every API assertion uses the identical server and JS client through each
// hosting driver. SDK-shaped fixtures do not qualify real cloud deployments.
describe.each(['REST','REST configuration','Cloudflare','Modal'] as const)('%s portable server conformance',hosting=>{
it('refuses session identities retained across a server restart',async()=>{
 const original=fixture();const session=await original.open();
 const restarted=fixture();
 const stale=await restarted.fetch(`sessions/${session.sessionId}`,'GET',undefined,session.epoch);
 expect([404,410]).toContain(stale.status);expect(restarted.admitSession).not.toHaveBeenCalled();
 const replacement=await restarted.open();expect(replacement.epoch).not.toBe(session.epoch);
});
const digest = 'a'.repeat(64);
const build: Build = { digest, imageDigest: 'sha256:'+digest, os: 'linux', architecture: 'x86_64', executables: { tool: digest }, librariesDigest: digest, grammarRevision: 'g1', sourceRevision: 's1', inventoryDigest: digest, assetsDigest: digest, launcherRevision: 'l1', bridgeRevision: 'b1', runtimeRequirements: [], runtimeEnvironment: {FIXED:'required'}, policyDigest: digest, configDigest: digest, policyDifferences: ['network denied'], inventory: { codecs: [], coders: [], delegates: [], fonts: [], profiles: [] } };
const limits: Limits = { maxJobs: 2, maxHandles: 4, maxArgvBytes: 64, maxManifestEntries: 8, maxFrameBytes: 4096, maxInflightBytes: 8192, maxBlobBytes: 8192, maxReplayBytes: 65536, maxCallbacks: 8, maxNativeMemoryBytes: 8192, maxNativeProcesses: 4, maxJobDurationMs: 10000 };
const request: SessionRequest = { buildDigest: digest, bindings: [{ namespaceId: 'work', logicalRoot: '/', rights: ['read','write','metadata'], grantId: 'host-issued', profile: 'live' }], limits };
function fixture(extra: {config?:Partial<import('./media-server.js').MediaServerOptions>;storage?:import('./server.js').UploadStorage;maxRecords?:number;features?:string[];files?:import('./media-server.js').SessionAuthority['files'];grants?: import('./wire.generated.js').Grant[]; materialize?: import('./media-server.js').SessionAuthority['materialize']} = {}) {
  let now = 1000; const close = vi.fn(async () => {}); const inspectBuild = vi.fn(async () => structuredClone(build));
  let resolveExit!: (value: import('./wire.generated.js').Outcome) => void; let resolveSettled!: () => void;
  const process: NativeProcess = { exit: new Promise(r => { resolveExit = r; }), settled: new Promise(r => { resolveSettled = r; }), write: vi.fn(async () => {}), end: vi.fn(async () => {}), signal: vi.fn() };
  const start = vi.fn((_streams:import('./native-process.js').ProcessStreams) => process); const prepare = vi.fn(async (_input:Parameters<import('./media-server.js').SessionAuthority['prepare']>[0]) => ({ start, close })); const admitSession = vi.fn(async () => ({ prepare, close, ...extra }));
  const retainedAdmissions=new Map<string,import('./admissions.js').AdmissionRecord>();
  const admissions={record:vi.fn(async(_value?:import('./admissions.js').AdmissionRecord)=>{}),inspect:vi.fn(async(id?:string)=>structuredClone(retainedAdmissions.get(id!)??null) as never)};
  const durableAdmissions={inspect:admissions.inspect,async record(value:import('./admissions.js').AdmissionRecord){await admissions.record(value);retainedAdmissions.set(value.operationId,structuredClone(value));}};
  const backend = createMediaServer({admissions:durableAdmissions, authenticate: async r => r.headers.get('Authorization')?.startsWith('Bearer ') ? { tenantId: r.headers.get('Authorization')!, principalId: 'p', expiresAt: 100000 } : null,
    builds: [build], tools: [{ id: 'tool', buildDigest: digest, executable: '/tools/tool', requiredFeatures: ['live-files'] }],
    driver: { features: [{ name: 'live-files', evidence: ['fixture-only'] }, ...(extra.features??[]).map(name=>({name,evidence:['fixture-only']})), ...(extra.materialize?[{name:'materialization',evidence:['fixture-only']}]:[])], inspectBuild, admitSession },
    storage: extra.storage ?? { async append() {}, async read() { return new Uint8Array(); }, async remove() {} }, limits, maxDocumentBytes: 16384, maxRecords: extra.maxRecords??32, leaseMs: 10000, retentionMs: 20000, now: () => now, ...extra.config,
  });
  const drivers={
    REST:()=>createRestExecutionDriver(restProvider,async()=>({origin:'https://media.test',expiresAt:Number.MAX_SAFE_INTEGER}),backend.fetch,()=>now),
    'REST configuration':()=>createRestExecutionDriver({...restProvider,endpoints:{
      'Bearer one':{origin:'https://media.test',expiresAt:Number.MAX_SAFE_INTEGER},
      'Bearer two':{origin:'https://media.test',expiresAt:Number.MAX_SAFE_INTEGER},
    }},undefined,backend.fetch,()=>now),
    Cloudflare:()=>createContainerExecutionDriver(cloudflareProvider,()=>({containerFetch:backend.fetch,destroy:async()=>{}})),
    Modal:()=>createModalExecutionDriver(modalProvider,async()=>({executionClass:modalProvider.executionClass,expiresAt:Number.MAX_SAFE_INTEGER,poll:async()=>null,waitUntilReady:async()=>{},tunnels:async()=>({[modalProvider.port]:{url:'https://media.test'}}),terminate:async()=>{}}),backend.fetch,()=>now),
  };
  const route=createRemoteExecutionRoute({driver:drivers[hosting](),now:()=>now,authenticate:async r=>{
    const token=r.headers.get('Authorization');
    return token?.startsWith('Bearer ')?{namespaceId:token,expiresAt:Number.MAX_SAFE_INTEGER}:null;
  }});
  const server={...backend,fetch:route.fetch};
  async function fetch(path: string, method = 'GET', body?: unknown, epoch?: string, key = 'key', token = 'one') {
    return server.fetch(new Request('https://media.test/v1/'+path, { method, headers: { Authorization: 'Bearer '+token, 'Execution-Epoch': epoch ?? '', 'Execution-Protocol': '1', 'Idempotency-Key': key, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }));
  }
  async function open() { const response = await fetch('sessions','POST',request); expect(response.status).toBe(200); return response.json(); }
  return { admissions,server, fetch, open, inspectBuild, admitSession, prepare, start, process, close, observeExit: (outcome: import('./wire.generated.js').Outcome) => resolveExit(outcome), finish() { resolveExit({ kind: 'exited', exitCode: 1 }); resolveSettled(); }, exit() { resolveExit({kind:'exited',exitCode:1}); }, settle: () => resolveSettled(), advance() { now = 12000; },expireCredential(){now=100001;},setNow(value:number){now=value;} };
}
function invocation(): JobRequest { return { buildDigest: digest, frontendContract: { grammarRevision: 'g1', sourceRevision: 's1' }, toolId: 'tool', args: [[], [36,40,105,100,41]], namespaceId: 'work', materializationRevision: null, cwd: '/', env: {FIXED:'required'}, stdin: {kind:'stream',seekable:false}, descriptors: [], grants: [], freshness:'live', limits }; }
it.each(['before receipt', 'after receipt'] as const)('preserves acknowledged effect evidence when a storage carrier changes %s', async schedule => {
 const f=fixture();const s=await f.open();
 let started!:()=>void;const running=new Promise<void>(resolve=>{started=resolve;});
 f.start.mockImplementation(()=>{started();return f.process;});
 const job=await(await f.fetch(`sessions/${s.sessionId}/jobs`,'POST',invocation(),s.epoch,'effect-evidence')).json();
 await running;
 let carrier:import('./wire.generated.js').EffectReceipt|undefined;
 f.admissions.record.mockImplementation(async record=>{
  if(record?.effectReceipt){
   carrier=record.effectReceipt;
   if(schedule==='before receipt')carrier.acknowledgedBytes='0';
  }
 });
 try{
  await f.prepare.mock.calls[0][0].hooks.effect({operationId:'completed-write',operation:'write',state:'applied',namespaceId:'work',path:'/output',acknowledgedBytes:'3',revision:'7'});
  carrier!.state='unknown';carrier!.acknowledgedBytes='0';carrier!.revision='8';
  const retained=await(await f.fetch(`sessions/${s.sessionId}/jobs/${job.jobId}`,'GET',undefined,s.epoch)).json();
  expect(retained.effectReceipts).toEqual([{operationId:'completed-write',sequence:'1',operation:'write',state:'applied',acknowledgedBytes:'3',revision:'7'}]);
  const effects=await(await f.fetch(`sessions/${s.sessionId}/jobs/${job.jobId}/effects`,'GET',undefined,s.epoch)).json();
  expect(effects.effects).toMatchObject([{operationId:'completed-write',state:'applied',acknowledgedBytes:'3',revision:'7'}]);
 }finally{f.finish();await f.server.close();}
});
it.each(['process-exited','io-settled'] as const)('preserves the observed native exit across provider mutation during durable %s publication', async stage => {
 const f=fixture();const s=await f.open();
 let entered!:()=>void;let release!:()=>void;
 const publishing=new Promise<void>(resolve=>{entered=resolve;});
 const gate=new Promise<void>(resolve=>{release=resolve;});
 let started!:()=>void;const running=new Promise<void>(resolve=>{started=resolve;});
 f.start.mockImplementation(()=>{started();return f.process;});
 f.admissions.record.mockImplementation(async value=>{
  if(value?.jobState?.stage===stage){entered();await gate;}
 });
 const job=await(await f.fetch(`sessions/${s.sessionId}/jobs`,'POST',invocation(),s.epoch,'immutable-exit')).json();
 await running;expect(f.start).toHaveBeenCalledOnce();
 const streams=f.start.mock.calls[0][0];await streams.end(2);await streams.end(3);
 const outcome={kind:'exited' as const,exitCode:7};
 f.observeExit(outcome);f.settle();await publishing;
 try {
  // A driver may reuse its result carrier after resolution. Its later writes
  // cannot revise the native observation while the durability receipt yields.
  outcome.exitCode=0;
  const pending=await(await f.fetch(`sessions/${s.sessionId}/jobs/${job.jobId}`,'GET',undefined,s.epoch)).json();
  expect(pending.processOutcome).toEqual({kind:'exited',exitCode:7});
 } finally {release();f.settle();}
 const final=await(await f.fetch(`sessions/${s.sessionId}/jobs/${job.jobId}/wait`,'GET',undefined,s.epoch)).json();
 expect(final).toMatchObject({state:'terminal',outputComplete:true,outcome:{kind:'exited',exitCode:7},
  processOutcome:{kind:'exited',exitCode:7},jobState:{stage:'io-settled',processOutcome:{kind:'exited',exitCode:7}}});
 await f.server.close();
});
it('admits the complete argv budget before attempting launcher decoding of earlier tokens',async()=>{
 const f=fixture();const session=await f.open();
 try{
  const data=invocation();data.args=[[255],new Array(limits.maxArgvBytes).fill(65)];
  const response=await f.fetch(`sessions/${session.sessionId}/jobs`,'POST',data,session.epoch,'oversized-argv');
  expect(response.status).toBe(413);
  expect(await response.json()).toMatchObject({category:'protocol',phase:'notAccepted'});
  expect(f.prepare).not.toHaveBeenCalled();expect(f.start).not.toHaveBeenCalled();
 }finally{await f.server.close();}
});
it.each(['tenantId','principalId','sessionId','epoch','invocationId'] as const)('rejects malformed credential %s before build inspection or session acquisition',async field=>{
 for(const value of ['',null,7,{},'bad\0identity','\ud800','a'.repeat(257)]) {
  const f=fixture({config:{authenticate:async()=>({tenantId:'tenant',principalId:'principal',expiresAt:100000,[field]:value}) as never}});
  const response=await f.fetch('sessions','POST',request);
  expect(response.status).toBe(401);
  expect(await response.json()).toMatchObject({category:'authorization',phase:'notAccepted'});
  expect(f.inspectBuild).not.toHaveBeenCalled();expect(f.admitSession).not.toHaveBeenCalled();
  await f.server.close();
 }
});
it.each(['sessionId','epoch','invocationId'] as const)('preserves inherited credential %s restrictions during authority retention',async field=>{
 const credential=Object.assign(Object.create({[field]:'restricted'}),{tenantId:'tenant',principalId:'principal',expiresAt:100000});
 const f=fixture({config:{authenticate:async()=>credential}});
 const response=await f.fetch('sessions','POST',request);
 expect(response.status).toBe(field==='epoch'?410:403);
 expect(f.inspectBuild).not.toHaveBeenCalled();expect(f.admitSession).not.toHaveBeenCalled();
 await f.server.close();
});
it('keeps build attestation and namespace admission bound to the configured driver',async()=>{
 const close=vi.fn(async()=>{});
 const driver={features:[{name:'live-files',evidence:['selected deployment']}],
  inspectBuild:vi.fn(async function(this:unknown){expect(this).toBe(driver);return structuredClone(build);}),
  admitSession:vi.fn(async function(this:unknown){expect(this).toBe(driver);return{prepare:vi.fn(),close};})};
 const inspectBuild=driver.inspectBuild;const admitSession=driver.admitSession;
 const f=fixture({config:{driver}});
 const replacementInspect=vi.fn(async()=>structuredClone(build));
 const replacementAdmit=vi.fn(async()=>({prepare:vi.fn(),close}));
 driver.inspectBuild=replacementInspect;driver.admitSession=replacementAdmit;
 await f.open();await f.server.close();
 expect(inspectBuild).toHaveBeenCalledOnce();expect(admitSession).toHaveBeenCalledOnce();
 expect(replacementInspect).not.toHaveBeenCalled();expect(replacementAdmit).not.toHaveBeenCalled();
 expect(close).toHaveBeenCalledOnce();
});
it('advertises driver allocation ceilings and refuses a wider session before acquiring authority',async()=>{
 const admitSession=vi.fn();
 const driver={limits:{maxArgvBytes:8,maxHandles:2},features:[{name:'live-files',evidence:['fixture']}],async inspectBuild(){return structuredClone(build);},admitSession};
 const f=fixture({config:{driver}});
 const capabilities=await(await f.fetch('capabilities')).json();expect(capabilities.limits.maxArgvBytes).toBe(8);expect(capabilities.limits.maxHandles).toBe(2);
 expect((await f.fetch('sessions','POST',request)).status).toBe(413);expect(admitSession).not.toHaveBeenCalled();
});
it('refuses malformed driver allocation ceilings before publishing capabilities or allocating sessions',()=>{
 for(const cap of [0,1.5,Number.POSITIVE_INFINITY])expect(()=>fixture({config:{driver:{limits:{maxArgvBytes:cap},features:[],inspectBuild:vi.fn(),admitSession:vi.fn()}}})).toThrow();
});
it('shares operator shutdown, retires native jobs and refuses further session acquisition',async()=>{
 const f=fixture();const s=await f.open();
 const response=await f.fetch(`sessions/${s.sessionId}/jobs`,'POST',invocation(),s.epoch,'shutdown-job');
 expect(response.status).toBe(200);
 await vi.waitFor(()=>expect(f.start).toHaveBeenCalledOnce());
 (f.process.signal as ReturnType<typeof vi.fn>).mockImplementation(()=>f.finish());
 const first=f.server.close();const second=f.server.close();expect(first).toBe(second);
 await first;
 expect(f.process.signal).toHaveBeenCalledWith('SIGTERM');
 expect(f.close).toHaveBeenCalledTimes(2);
 expect((await f.fetch('sessions','POST',request,undefined,'after-shutdown')).status).toBe(503);
 expect(f.admitSession).toHaveBeenCalledOnce();
});
it('drains late authentication without acquiring a namespace after operator shutdown',async()=>{
 let release!:()=>void;let entered!:()=>void;
 const ready=new Promise<void>(resolve=>{entered=resolve;});const gate=new Promise<void>(resolve=>{release=resolve;});
 const f=fixture({config:{authenticate:async()=>{entered();await gate;return{tenantId:'tenant',principalId:'owner',expiresAt:100000};}}});
 const opening=f.fetch('sessions','POST',request);await ready;
 let closed=false;const closing=f.server.close().then(()=>{closed=true;});
 await Promise.resolve();expect(closed).toBe(false);
 release();expect((await opening).status).toBe(503);await closing;
 expect(f.admitSession).not.toHaveBeenCalled();
});
it('operator shutdown preserves failed retirement of a late namespace acquisition',async()=>{
 const f=fixture();const failure=new Error('late namespace cleanup failed');
 let entered!:()=>void;let release!:()=>void;const ready=new Promise<void>(resolve=>{entered=resolve;});const gate=new Promise<void>(resolve=>{release=resolve;});
 f.close.mockRejectedValue(failure);
 f.admitSession.mockImplementation(async()=>{entered();await gate;return{prepare:f.prepare,close:f.close};});
 const opening=f.fetch('sessions','POST',request);await ready;
 const closing=f.server.close();release();await opening;
 await expect(closing).rejects.toMatchObject({errors:[failure]});
 expect(f.close).toHaveBeenCalledOnce();expect(f.server.close()).toBe(closing);
});
it('operator shutdown cannot report successful cleanup when an invocation retirement is unknown',async()=>{
 const f=fixture();const s=await f.open();
 const response=await f.fetch(`sessions/${s.sessionId}/jobs`,'POST',invocation(),s.epoch,'failed-job-cleanup');expect(response.status).toBe(200);
 f.close.mockRejectedValueOnce(new Error('invocation retirement failed'));
 (f.process.signal as ReturnType<typeof vi.fn>).mockImplementation(()=>f.finish());
 await expect(f.server.close()).rejects.toThrow('Media server retirement failed');
 expect(f.close).toHaveBeenCalledTimes(2);
});
it('retains configured capability ceilings before caller mutation can widen session authority', async()=>{
 const configuredLimits=structuredClone(limits);
 const f=fixture({config:{limits:configuredLimits}});
 configuredLimits.maxArgvBytes*=2;
 const capabilities=await (await f.fetch('capabilities')).json();
 expect(capabilities.limits.maxArgvBytes).toBe(limits.maxArgvBytes);
 const response=await f.fetch('sessions','POST',{...request,limits:configuredLimits});
 expect(response.status).toBe(413);
 expect(f.admitSession).not.toHaveBeenCalled();
});
it.each([false,true])('keeps failed admission receipts unknown before native launch (published: %s)', async published => {
 const f=fixture();const s=await f.open();
 const records=new Map<string,import('./admissions.js').AdmissionRecord>();
 f.admissions.inspect.mockImplementation(async(id?:string)=>structuredClone(records.get(id!)??null) as never);
 f.admissions.record.mockImplementation(async(value?:import('./admissions.js').AdmissionRecord)=>{
  if(published)records.set(value!.operationId,structuredClone(value!));
  throw new TypeError('Admission provider lost its receipt');
 });
 const response=await f.fetch(`sessions/${s.sessionId}/jobs`,'POST',invocation(),s.epoch,'admission-receipt');
 expect(response.status).toBe(503);
 expect(await response.json()).toMatchObject({category:'unknown',phase:'unknown',recovery:{sessionId:s.sessionId,epoch:s.epoch}});
 f.admissions.record.mockImplementation(async(value?:import('./admissions.js').AdmissionRecord)=>{records.set(value!.operationId,structuredClone(value!));});
 const retry=await f.fetch(`sessions/${s.sessionId}/jobs`,'POST',invocation(),s.epoch,'admission-receipt');
 expect(retry.status).toBe(published?410:200);
 if(published){expect(f.prepare).not.toHaveBeenCalled();expect(f.start).not.toHaveBeenCalled();}
 else{f.finish();await f.fetch(`sessions/${s.sessionId}/jobs/${(await retry.json()).jobId}/wait`,'GET',undefined,s.epoch);expect(f.start).toHaveBeenCalledOnce();}
});
it('keeps unavailable invocation admission inspection unknown rather than rejecting the payload',async()=>{
 const f=fixture();const s=await f.open();let reads=0;
 // The bounded state scan succeeds; the separate invocation admission lookup
 // cannot establish absence. A provider TypeError is not caller validation.
 f.admissions.inspect.mockImplementation(async()=>{if(++reads===17)throw new TypeError('Admission record unreadable');return null;});
 const response=await f.fetch(`sessions/${s.sessionId}/jobs`,'POST',invocation(),s.epoch,'unreadable-admission');
 expect(response.status).toBe(503);
 expect(await response.json()).toMatchObject({category:'unknown',phase:'unknown'});
 expect(f.prepare).not.toHaveBeenCalled();expect(f.start).not.toHaveBeenCalled();
});
it('keeps failed durable acceptance unknown and refuses native relaunch on keyed retry', async () => {
 const f=fixture();const s=await f.open();
 const records=new Map<string,import('./admissions.js').AdmissionRecord>();
 f.admissions.inspect.mockImplementation(async(id?:string)=>structuredClone(records.get(id!)??null) as never);
 f.admissions.record.mockImplementation(async(value?:import('./admissions.js').AdmissionRecord)=>{
  records.set(value!.operationId,structuredClone(value!));
  if(value?.jobState?.stage==='accepted')throw new TypeError('Ledger provider unavailable');
 });
 const response=await f.fetch(`sessions/${s.sessionId}/jobs`,'POST',invocation(),s.epoch,'publication-failure');
 expect(response.status).toBe(503);
 expect(await response.json()).toMatchObject({category:'unknown',phase:'unknown'});
 const retry=await f.fetch(`sessions/${s.sessionId}/jobs`,'POST',invocation(),s.epoch,'publication-failure');
 expect(retry.status).toBe(410);
 expect(f.start).not.toHaveBeenCalled();
 expect(f.prepare).not.toHaveBeenCalled();
});
it.each(['dependency-manifest-v1','unknown-v2',''])('refuses an unsupported explicit HTTP profile %j before session effects', async profile => {
 const f=fixture({features:['dependency-manifest-v1']});
 const response=await f.server.fetch(new Request('https://media.test/v1/sessions',{
  method:'POST',headers:{Authorization:'Bearer one','Execution-Protocol':'1','Execution-Profile':profile,'Idempotency-Key':'profile','Content-Type':'application/json'},body:JSON.stringify(request),
 }));
 expect(response.status).toBe(422);
 expect(await response.json()).toMatchObject({category:'protocol',code:'unsupported-profile',phase:'notAccepted'});
 expect(f.admissions.record).not.toHaveBeenCalled();expect(f.admitSession).not.toHaveBeenCalled();expect(f.inspectBuild).not.toHaveBeenCalled();
});
it('pins borrowed authentication authority before asynchronous build inspection',async()=>{
 const credential={tenantId:'original',principalId:'owner',expiresAt:100000};
 const f=fixture({config:{authenticate:async()=>credential}});
 f.inspectBuild.mockImplementation(async()=>{
  credential.tenantId='replacement';credential.principalId='other';return structuredClone(build);
 });
 const response=await f.fetch('sessions','POST',request);
 expect(response.status).toBe(200);
 expect(f.admitSession.mock.calls[0][0].principal).toMatchObject({tenantId:'original',principalId:'owner'});
 expect(f.admissions.record.mock.calls[0][0]).toMatchObject({tenantId:'original',principalId:'owner'});
});
it('refuses native session acquisition when credentials expire during durable admission',async()=>{
 const f=fixture({config:{authenticate:async()=>({tenantId:'one',principalId:'owner',expiresAt:1500})}});
 f.admissions.record.mockImplementation(async()=>{f.setNow(1600);});
 const response=await f.fetch('sessions','POST',request);
 expect(response.status).toBe(401);
 expect(f.admitSession).not.toHaveBeenCalled();
});
it.each(['inspection','admission','accepted-state'] as const)('refuses native job preparation when credentials expire during durable %s',async stage=>{
 const f=fixture({config:{authenticate:async()=>({tenantId:'one',principalId:'owner',expiresAt:1500})}});
 const s=await f.open();
 if(stage==='inspection')f.admissions.inspect.mockImplementation(async()=>{f.setNow(1600);return null;});
 else f.admissions.record.mockImplementation(async(value?:import('./admissions.js').AdmissionRecord)=>{
  if(stage==='admission'&&value?.kind==='job'||stage==='accepted-state'&&value?.jobState?.stage==='accepted')f.setNow(1600);
 });
 const response=await f.fetch(`sessions/${s.sessionId}/jobs`,'POST',invocation(),s.epoch,'expired-admission');
 expect(response.status).toBe(401);
 expect(f.prepare).not.toHaveBeenCalled();expect(f.start).not.toHaveBeenCalled();
});
it('does not relaunch durable acceptance after expired credentials are renewed',async()=>{
 let expiresAt=1500;
 const f=fixture({config:{authenticate:async()=>({tenantId:'one',principalId:'owner',expiresAt})}});
 const s=await f.open();const records=new Map<string,import('./admissions.js').AdmissionRecord>();
 f.admissions.inspect.mockImplementation(async(id?:string)=>structuredClone(records.get(id!)??null) as never);
 f.admissions.record.mockImplementation(async(value?:import('./admissions.js').AdmissionRecord)=>{
  records.set(value!.operationId,structuredClone(value!));
  if(value?.jobState?.stage==='accepted')f.setNow(1600);
 });
 expect((await f.fetch(`sessions/${s.sessionId}/jobs`,'POST',invocation(),s.epoch,'expired-retry')).status).toBe(401);
 expiresAt=3000;
 expect((await f.fetch(`sessions/${s.sessionId}/jobs`,'POST',invocation(),s.epoch,'expired-retry')).status).toBe(410);
 expect(f.prepare).not.toHaveBeenCalled();expect(f.start).not.toHaveBeenCalled();
});
it('returns unrecoverable transport after job cleanup while its session is renewed', async () => {
 const {createClient}=await import('./client.js');
 const f=fixture(); const s=await f.open(); const data=invocation();
 let launched!:()=>void; const started=new Promise<void>(resolve=>{launched=resolve;});
 f.start.mockImplementation(()=>{launched();return f.process;});
 const job=await(await f.fetch(`sessions/${s.sessionId}/jobs`,'POST',data,s.epoch,'invocation')).json();
 await started;
 const lane=await(await f.fetch(`sessions/${s.sessionId}/jobs/${job.jobId}/lanes`,'POST',{direction:'output',consumerId:'sink'},s.epoch,'lane')).json();
 await f.start.mock.calls[0][0].end(2); await f.start.mock.calls[0][0].end(3); f.finish();
 await f.fetch(`sessions/${s.sessionId}/jobs/${job.jobId}/wait`,'GET',undefined,s.epoch);
 for(const time of [9000,18000,27000]){
  f.setNow(time);
  expect((await f.fetch(`sessions/${s.sessionId}/lease`,'POST',{leaseMs:10000},s.epoch,'renew:'+time)).status).toBe(200);
 }
 f.setNow(31001); await f.server.sweep();
 const client=createClient({baseUrl:'https://media.test',token:async()=> 'one',fetch:async(url,init)=>f.server.fetch(new Request(url,init))});
 const identity={sessionId:s.sessionId,epoch:s.epoch};
 const cursor={...identity,jobId:job.jobId,laneId:lane.laneId,nextSequence:1n,offsets:new Map([[2,0n],[3,0n]]),endedChannels:new Set<number>()};
 const consume=vi.fn();
 for(const operation of [
  ()=>client.submitJob(identity,data,'invocation'),
  ()=>client.inspectJob(identity,job.jobId),
  ()=>client.waitJob(identity,job.jobId),
  ()=>client.cancelJob(identity,job.jobId,{reason:'stop'},'cancel'),
  ()=>client.resumeStream(cursor,{maxFrameBytes:4096,maxControlBytes:4096,channels:[2,3]},consume),
 ])await expect(operation()).rejects.toMatchObject({name:'UnrecoverableTransportError',category:'transport',code:'unrecoverable',recoveryActions:['inspect','recover-partial-outputs','reauthorize','start-new-invocation']});
 expect((await f.fetch(`sessions/${s.sessionId}/jobs`,'POST',{...data,args:[[1]]},s.epoch,'invocation')).status).toBe(409);
 expect((await f.fetch(`sessions/${s.sessionId}/jobs/never-accepted`,'GET',undefined,s.epoch)).status).toBe(404);
 expect(f.start).toHaveBeenCalledOnce(); expect(consume).not.toHaveBeenCalled();
 expect(cursor.nextSequence).toBe(1n); expect([...cursor.offsets.values()]).toEqual([0n,0n]);
 await f.fetch(`sessions/${s.sessionId}`,'DELETE',undefined,s.epoch,'close');
});
it('refuses duplicate HTTP job keys before persistence or namespace preparation',async()=>{
 const f=fixture();const s=await f.open();f.admissions.record.mockClear();
 const body=JSON.stringify(invocation()).slice(0,-1)+',"toolId":"tool"}';
 const response=await f.server.fetch(new Request(`https://media.test/v1/sessions/${s.sessionId}/jobs`,{method:'POST',body,headers:{Authorization:'Bearer one','Execution-Epoch':s.epoch,'Execution-Protocol':'1','Idempotency-Key':'duplicate','Content-Type':'application/json'}}));
 expect(response.status).toBe(400);expect(f.admissions.record).not.toHaveBeenCalled();expect(f.prepare).not.toHaveBeenCalled();
 await f.fetch(`sessions/${s.sessionId}`,'DELETE',undefined,s.epoch,'close');
});
it('refuses replay limits without reserved control credit before native admission', async () => {
 const f=fixture();const s=await f.open();
 f.admissions.record.mockClear();
 const data=invocation();data.limits={...data.limits,maxReplayBytes:4136};
 const response=await f.fetch(`sessions/${s.sessionId}/jobs`,'POST',data,s.epoch,'no-control-reserve');
 expect(response.status).toBe(413);expect(f.prepare).not.toHaveBeenCalled();expect(f.start).not.toHaveBeenCalled();
 expect(f.admissions.record).not.toHaveBeenCalled();
 await f.server.close();
});
it('persists native exit while unacknowledged output blocks state publication', async () => {
  const f = fixture(); const s = await f.open();
  let launched!: () => void;
  const retire=vi.fn(async()=>{}); f.process.terminateGroup=retire;
  const started = new Promise<void>(resolve => { launched = resolve; });
  f.prepare.mockImplementation(async input => {
    await input.hooks.effect({operationId:'earlier-write',namespaceId:'work',operation:'write',state:'applied',path:'/'+ 'a'.repeat(3400)});
    return {start:f.start,close:f.close};
  });
  f.start.mockImplementation(() => { launched(); return f.process; });
  const data = invocation(); data.limits = {...data.limits,maxReplayBytes:8272};
  const job = await (await f.fetch(`sessions/${s.sessionId}/jobs`, 'POST', data, s.epoch)).json();
  await started; f.exit();
  // Drain the scheduled exit observation without releasing any stream credit.
  await new Promise<void>(resolve => { setImmediate(resolve); });
  try {
    const inspected = await (await f.fetch(`sessions/${s.sessionId}/jobs/${job.jobId}`, 'GET', undefined, s.epoch)).json();
    expect(inspected).toMatchObject({state:'draining',outputComplete:false,jobState:{stage:'process-exited',processOutcome:{kind:'exited',exitCode:1}}});
    expect(f.close).not.toHaveBeenCalled();
    expect(retire).toHaveBeenCalledOnce();
  } finally {
    f.settle();
    await f.fetch(`sessions/${s.sessionId}`, 'DELETE', undefined, s.epoch, 'close');
  }
});
it.each(['rights','expiry','ranges','seekable'] as const)('refuses a dynamic channel with unsupported %s before publishing it',async condition=>{
 const grant:import('./wire.generated.js').Grant={grantId:'g',namespaceId:'work',handleId:'h',operations:condition==='rights'?['read']:['write'],maxBytes:'8',maxOperations:4,expiresAt:new Date(9000).toISOString(),...(condition==='ranges'?{ranges:[{start:'0',endExclusive:'8'}]}:{})};
 const f=fixture({grants:[grant]});const s=await f.open();
 const job=await(await f.fetch(`sessions/${s.sessionId}/jobs`,'POST',{...invocation(),grants:[grant]},s.epoch)).json();
 await vi.waitFor(()=>expect(f.prepare).toHaveBeenCalledOnce());
 if(condition==='expiry')f.setNow(9001);
 try{
  await expect(f.prepare.mock.calls[0][0].hooks.openChannel({type:'ChannelOpen',channelId:4,correlationId:'1',direction:'write',resourceId:'h',seekable:condition==='seekable'})).rejects.toMatchObject({status:condition==='seekable'?422:403});
 }finally{
  await f.start.mock.calls[0][0].end(2);await f.start.mock.calls[0][0].end(3);f.finish();
  await f.fetch(`sessions/${s.sessionId}/jobs/${job.jobId}/wait`,'GET',undefined,s.epoch);
 }
});
it('charges actual dynamic-channel byte spans against a shared grant across outputs',async()=>{
 const grant:import('./wire.generated.js').Grant={grantId:'g',namespaceId:'work',handleId:'h',operations:['write'],maxBytes:'3',maxOperations:4,expiresAt:new Date(9000).toISOString()};
 const f=fixture({grants:[grant]});const s=await f.open();
 const job=await(await f.fetch(`sessions/${s.sessionId}/jobs`,'POST',{...invocation(),grants:[grant]},s.epoch)).json();
 await vi.waitFor(()=>expect(f.prepare).toHaveBeenCalledOnce());
 const hooks=f.prepare.mock.calls[0][0].hooks;
 const first=await hooks.openChannel({type:'ChannelOpen',channelId:4,correlationId:'1',direction:'write',resourceId:'h',seekable:false});
 const second=await hooks.openChannel({type:'ChannelOpen',channelId:5,correlationId:'2',direction:'write',resourceId:'h',seekable:false});
 const a=first.writable!.getWriter();const b=second.writable!.getWriter();
 const bytes=Uint8Array.of(0,255);const length=vi.fn(()=>1);Object.defineProperty(bytes,'length',{get:length});
 try{
  await a.write(bytes);
  await expect(b.write(bytes)).rejects.toMatchObject({status:413});
  expect(length).not.toHaveBeenCalled();
 }finally{
  a.releaseLock();b.releaseLock();
  await f.start.mock.calls[0][0].end(2);await f.start.mock.calls[0][0].end(3);f.finish();
  await f.fetch(`sessions/${s.sessionId}/jobs/${job.jobId}/wait`,'GET',undefined,s.epoch);
 }
});
it('bounds dynamic channel writes against the frame and cumulative grant before retaining payloads',async()=>{
 const grant:import('./wire.generated.js').Grant={grantId:'g',namespaceId:'work',handleId:'h',operations:['write'],maxBytes:'3',maxOperations:4,expiresAt:new Date(9000).toISOString()};
 const f=fixture({grants:[grant]});const s=await f.open();
 const job=await(await f.fetch(`sessions/${s.sessionId}/jobs`,'POST',{...invocation(),grants:[grant]},s.epoch)).json();
 await vi.waitFor(()=>expect(f.prepare).toHaveBeenCalledOnce());
 const hooks=f.prepare.mock.calls[0][0].hooks;
 const first=await hooks.openChannel({type:'ChannelOpen',channelId:4,correlationId:'1',direction:'write',resourceId:'h',seekable:false});
 const second=await hooks.openChannel({type:'ChannelOpen',channelId:5,correlationId:'2',direction:'write',resourceId:'h',seekable:false});
 const a=first.writable!.getWriter();const b=second.writable!.getWriter();
 try{
  await a.write(Uint8Array.of(0,255));
  await expect(b.write(Uint8Array.of(1,2))).rejects.toMatchObject({status:413});
  await expect(hooks.request('g',{op:'write',handleId:'h',position:'0',length:'2',channelId:6})).rejects.toMatchObject({status:413});
 }finally{
  a.releaseLock();b.releaseLock();
  await f.start.mock.calls[0][0].end(2);await f.start.mock.calls[0][0].end(3);f.finish();
  await f.fetch(`sessions/${s.sessionId}/jobs/${job.jobId}/wait`,'GET',undefined,s.epoch);
 }
});
it('durably observes native exit before blocked process-group retirement without declaring I/O settled', async () => {
  const f = fixture(); const s = await f.open();
  let started!: () => void; let retiring!: () => void; let release!: () => void;
  const launched = new Promise<void>(resolve => { started = resolve; });
  const retirementEntered = new Promise<void>(resolve => { retiring = resolve; });
  const retirement = new Promise<void>(resolve => { release = resolve; });
  f.start.mockImplementation(() => { started(); return f.process; });
  f.process.terminateGroup = async () => { retiring(); await retirement; };
  const job = await (await f.fetch(`sessions/${s.sessionId}/jobs`, 'POST', invocation(), s.epoch)).json();
  await launched; f.exit(); await retirementEntered;
  try {
    const records = f.admissions.record.mock.calls.map(call => (call as unknown as [import('./admissions.js').AdmissionRecord])[0]);
    expect(records.at(-1)?.jobState).toMatchObject({stage:'process-exited',sequence:'3',processOutcome:{kind:'exited',exitCode:1},outputComplete:false,cleanup:'pending'});
    const inspected = await (await f.fetch(`sessions/${s.sessionId}/jobs/${job.jobId}`, 'GET', undefined, s.epoch)).json();
    expect(inspected).toMatchObject({state:'draining',outputComplete:false,jobState:{stage:'process-exited'}});
    expect(f.close).not.toHaveBeenCalled();
  } finally {
    release(); f.settle();
    await f.fetch(`sessions/${s.sessionId}/jobs/${job.jobId}/wait`, 'GET', undefined, s.epoch);
  }
});
it('retires delegates before awaiting inherited pipes while retaining the leader outcome',async()=>{
  const f=fixture();const s=await f.open();
  const terminateGroup=vi.fn(async()=>{f.settle();});
  f.process.terminateGroup=terminateGroup;
  const job=await(await f.fetch(`sessions/${s.sessionId}/jobs`,'POST',invocation(),s.epoch)).json();
  await vi.waitFor(()=>expect(f.start).toHaveBeenCalledOnce());
  f.exit();
  await new Promise<void>(resolve=>setImmediate(resolve));
  const retired=terminateGroup.mock.calls.length;
  if(!retired)f.settle();
  const terminal=await(await f.fetch(`sessions/${s.sessionId}/jobs/${job.jobId}/wait`,'GET',undefined,s.epoch)).json();
  expect(retired).toBe(1);
  expect(terminal.processOutcome).toEqual({kind:'exited',exitCode:1});
  expect(f.close).toHaveBeenCalledOnce();
});
it('retires native ownership even when an earlier output effect receipt fails', async () => {
  const f = fixture(); const s = await f.open();
  const job = await (await f.fetch(`sessions/${s.sessionId}/jobs`, 'POST', invocation(), s.epoch)).json();
  await vi.waitFor(() => expect(f.start).toHaveBeenCalledOnce());
  const failure = new Error('Effect receipt unavailable');
  f.admissions.record.mockRejectedValueOnce(failure);
  await expect(f.prepare.mock.calls[0][0].hooks.effect({operationId:'effect',namespaceId:'work',operation:'write',state:'applied'})).rejects.toMatchObject({status:503,cause:failure});
  f.finish();
  const terminal = await (await f.fetch(`sessions/${s.sessionId}/jobs/${job.jobId}/wait`, 'GET', undefined, s.epoch)).json();
  expect(f.close).toHaveBeenCalledOnce();
  expect(terminal.processOutcome).toEqual({kind:'exited',exitCode:1});
  expect(terminal.cleanup).toBe('unknown'); expect(terminal.outcome.kind).toBe('unknown');
});
it('admits a generic tool through the matching SDK without requiring media grammar identity', async () => {
  const f = fixture(); const s = await f.open();
  const generic = invocation(); delete generic.frontendContract;
  const {createClient} = await import('./client.js');
  const client = createClient({baseUrl:'https://media.test',token:async ()=>'one',fetch:(url,init)=>f.server.fetch(new Request(url,init))});
  const job = await client.submitJob(s, generic, 'generic-job');
  expect(job.state).toBe('accepted');
  await vi.waitFor(() => expect(f.start).toHaveBeenCalledOnce());
  expect(f.prepare.mock.calls[0][0].request.args).toEqual(generic.args);
  f.finish(); await client.waitJob(s, job.jobId);
});
it('requires frontend identity only when the registered tool declares it, before any job effects', async () => {
  const f = fixture({config:{tools:[{id:'tool',buildDigest:digest,executable:'/tools/tool',requiredFeatures:['live-files'],requiresFrontendContract:true} as import('./media-server.js').MediaTool]}});
  const s = await f.open();
  const generic = invocation(); delete generic.frontendContract;
  const result = await f.fetch(`sessions/${s.sessionId}/jobs`, 'POST', generic, s.epoch, 'missing-frontend');
  expect(result.status).toBe(409); expect(f.prepare).not.toHaveBeenCalled(); expect(f.start).not.toHaveBeenCalled();
  expect(f.admissions.record.mock.calls.some(call => (call as unknown as [import('./admissions.js').AdmissionRecord])[0].kind==='job')).toBe(false);
});
it('linearizes cancellation once across distinct keys and durably observes cancellation after exit', async () => {
  const f = fixture(); const s = await f.open();
  const job = await (await f.fetch(`sessions/${s.sessionId}/jobs`, 'POST', invocation(), s.epoch)).json();
  await vi.waitFor(() => expect(f.start).toHaveBeenCalledOnce());
  const route = `sessions/${s.sessionId}/jobs/${job.jobId}/cancel`;
  await f.fetch(route, 'POST', {reason:'stop'}, s.epoch, 'cancel-one');
  await f.fetch(route, 'POST', {reason:'stop'}, s.epoch, 'cancel-two');
  expect(f.process.signal).toHaveBeenCalledTimes(1);
  f.finish();
  await f.fetch(`sessions/${s.sessionId}/jobs/${job.jobId}/wait`, 'GET', undefined, s.epoch);
});

it.each([false, true])('joins concurrent cancellation replies to durable observation (persistence failure: %s)', async fail => {
  const f = fixture(); const s = await f.open();
  let started!: () => void;
  const running = new Promise<void>(resolve => { started = resolve; });
  f.start.mockImplementationOnce(() => { started(); return f.process; });
  const job = await (await f.fetch(`sessions/${s.sessionId}/jobs`, 'POST', invocation(), s.epoch)).json();
  await running;
  let entered!: () => void; let release!: () => void; let secondEntered!: () => void;
  const observing = new Promise<void>(resolve => { entered = resolve; });
  const barrier = new Promise<void>(resolve => { release = resolve; });
  const secondAdmitted = new Promise<void>(resolve => { secondEntered = resolve; });
  let cancellations = 0;
  f.admissions.record.mockImplementation(async (value?: import('./admissions.js').AdmissionRecord) => {
    if (value?.kind === 'cancel' && ++cancellations === 2) secondEntered();
    if (value?.jobState?.cancelRequested) {
      entered(); await barrier;
      if (fail) throw new Error('Durable cancellation observation unavailable');
    }
  });
  const route = `sessions/${s.sessionId}/jobs/${job.jobId}/cancel`;
  const first = f.fetch(route, 'POST', {reason:'stop'}, s.epoch, 'cancel-one');
  await observing;
  let replied = false;
  const second = f.fetch(route, 'POST', {reason:'stop'}, s.epoch, 'cancel-two').then(response => { replied = true; return response; });
  await secondAdmitted;
  // Drain the finite request continuations while the durable write is paused.
  for (let turn = 0; turn < 100; turn++) await Promise.resolve();
  const premature = replied;
  release();
  const replies = await Promise.all([first, second]);
  const retry = await f.fetch(route, 'POST', {reason:'stop'}, s.epoch, 'cancel-three');
  f.finish();
  await f.fetch(`sessions/${s.sessionId}/jobs/${job.jobId}/wait`, 'GET', undefined, s.epoch);
  expect(premature).toBe(false);
  expect(replies.map(response => response.status)).toEqual(fail ? [503,503] : [200,200]);
  expect(retry.status).toBe(fail ? 503 : 200);
  expect(f.process.signal).toHaveBeenCalledTimes(1);
  if (!fail) for (const response of replies) expect(await response.json()).toMatchObject({jobState:{cancelRequested:true,cancelActed:true}});
});

it('retains a failed cancellation action as transport uncertainty without claiming it acted', async () => {
  const f = fixture(); const s = await f.open();
  let started!: () => void;
  const running = new Promise<void>(resolve => { started = resolve; });
  f.start.mockImplementationOnce(() => { started(); return f.process; });
  const job = await (await f.fetch(`sessions/${s.sessionId}/jobs`, 'POST', invocation(), s.epoch)).json();
  await running;
  const cause = new Error('Provider signal delivery unavailable');
  (f.process.signal as ReturnType<typeof vi.fn>).mockImplementation(() => { throw cause; });
  const result = await f.fetch(`sessions/${s.sessionId}/jobs/${job.jobId}/cancel`, 'POST', {reason:'stop'}, s.epoch, 'cancel');
  expect(result.status).toBe(200);
  expect(await result.json()).toMatchObject({cancelRequested:true, jobState:{cancelRequested:true,cancelActed:false}});
  const terminal = await (await f.fetch(`sessions/${s.sessionId}/jobs/${job.jobId}/wait`, 'GET', undefined, s.epoch)).json();
  expect(terminal).toMatchObject({state:'terminal',outputComplete:false,outcome:{kind:'unknown'},jobState:{stage:'unknown-outcome',cancelActed:false}});
  await f.fetch(`sessions/${s.sessionId}/jobs/${job.jobId}/cancel`, 'POST', {reason:'stop'}, s.epoch, 'cancel-retry');
  expect(f.process.signal).toHaveBeenCalledOnce();
  expect(f.start).toHaveBeenCalledOnce();
});

it('persists cancellation requested after observed exit without signaling the exited leader', async () => {
  const f = fixture(); const s = await f.open();
  const job = await (await f.fetch(`sessions/${s.sessionId}/jobs`, 'POST', invocation(), s.epoch)).json();
  await vi.waitFor(() => expect(f.start).toHaveBeenCalledOnce());
  f.exit();
  await vi.waitFor(() => expect(f.admissions.record.mock.calls.some(call => (call as unknown as [import('./admissions.js').AdmissionRecord])[0].jobState?.stage === 'process-exited')).toBe(true));
  const result = await f.fetch(`sessions/${s.sessionId}/jobs/${job.jobId}/cancel`, 'POST', {reason:'stop'}, s.epoch, 'cancel');
  expect(result.status).toBe(200);
  const events = f.admissions.record.mock.calls.map(call => (call as unknown as [import('./admissions.js').AdmissionRecord])[0].jobState).filter(Boolean);
  expect(events.at(-1)).toMatchObject({stage:'process-exited', cancelRequested:true, cancelActed:false, processOutcome:{kind:'exited',exitCode:1}});
  expect(f.process.signal).not.toHaveBeenCalled(); f.settle();
  await f.fetch(`sessions/${s.sessionId}/jobs/${job.jobId}/wait`, 'GET', undefined, s.epoch);
});

it('refuses intact input received after credential expiry without classifying a native failure', async () => {
  const f = fixture(); const s = await f.open();
  const job = await (await f.fetch(`sessions/${s.sessionId}/jobs`, 'POST', invocation(), s.epoch)).json();
  await vi.waitFor(() => expect(f.start).toHaveBeenCalledOnce());
  const lane = await (await f.fetch(`sessions/${s.sessionId}/jobs/${job.jobId}/lanes`, 'POST', {direction:'input',consumerId:'owner'}, s.epoch, 'input')).json();
  const {encodeFrame,binaryContentType} = await import('./binary.js');
  const wire = encodeFrame({kind:'data',channelId:1,sequence:1n,offset:0n,correlationId:0n,payload:Uint8Array.of(0,255)}, {maxFrameBytes:4096,maxControlBytes:4096,channels:[1]});
  let release!: () => void; let entered!: () => void;
  const ready = new Promise<void>(resolve => { entered = resolve; });
  const barrier = new Promise<void>(resolve => { release = resolve; });
  const body = new ReadableStream<Uint8Array>({async pull(controller) { entered(); await barrier; controller.enqueue(wire); controller.close(); }}, {highWaterMark:0});
  const pending = f.server.fetch(new Request(`https://media.test/v1/sessions/${s.sessionId}/jobs/${job.jobId}/lanes/${lane.laneId}/frames`, {
    method:'POST', headers:{Authorization:'Bearer one','Execution-Protocol':'1','Execution-Epoch':s.epoch,'Content-Type':binaryContentType,'Execution-Cursor':'1'},body,duplex:'half',
  } as RequestInit));
  await ready; f.expireCredential(); release();
  expect((await pending).status).toBe(401);
  expect(f.process.write).not.toHaveBeenCalled(); f.finish();
});
it.each(['sha256:'+'z'.repeat(64), 'sha256:'+'A'.repeat(64), 'latest'])('refuses an unpinned OCI identity %s during server construction', imageDigest => {
  expect(() => fixture({config:{builds:[{...build,imageDigest}]}})).toThrow('pinned');
});
it.each(['tool', '/tools/\0tool', '/tools/\uD800'])('refuses an unrepresentable configured executable before any session acquisition', executable => {
  expect(() => fixture({config:{tools:[{id:'tool',buildDigest:digest,executable,requiredFeatures:['live-files']}]}})).toThrow('executable');
});
it('prevents session credentials from inspecting principal-scoped admission keys',async()=>{
  const principal:import('./media-server.js').MediaPrincipal={tenantId:'tenant',principalId:'owner',expiresAt:100000};
  const authenticate=vi.fn(async()=>({...principal}));const f=fixture({config:{authenticate}});const s=await f.open();
  principal.sessionId=s.sessionId;principal.epoch=s.epoch;
  expect((await f.fetch('operations/key')).status).toBe(403);
  expect((await f.fetch(`sessions/${s.sessionId}`,'GET',undefined,s.epoch)).status).toBe(200);
});
it('prevents credentials from an expired epoch from recovering current principal admissions',async()=>{
  const principal:import('./media-server.js').MediaPrincipal={tenantId:'tenant',principalId:'owner',expiresAt:100000};
  const f=fixture({config:{authenticate:async()=>({...principal})}});await f.open();principal.epoch='retired-epoch';
  expect((await f.fetch('operations/key')).status).toBe(410);
});
it('refuses required session and invocation features before resource acquisition',async()=>{
  const f=fixture();expect((await f.fetch('sessions','POST',{...request,requiredFeatures:['missing']})).status).toBe(422);expect(f.admitSession).not.toHaveBeenCalled();
  const s=await f.open();expect((await f.fetch(`sessions/${s.sessionId}/jobs`,'POST',{...invocation(),requiredFeatures:['missing']},s.epoch,'unsupported')).status).toBe(422);expect(f.prepare).not.toHaveBeenCalled();
});
it('keeps negotiated requirements out of session response models',async()=>{
  const f=fixture();const response=await f.fetch('sessions','POST',{...request,requiredFeatures:['live-files']});expect(response.status).toBe(200);
  const value=await response.json();expect(value).not.toHaveProperty('requiredFeatures');
});
it('refuses omission or widening of trusted host range authority',async()=>{
  const host={grantId:'range',namespaceId:'work',handleId:'h',operations:['read' as const],maxBytes:'8',maxOperations:4,expiresAt:new Date(90000).toISOString(),ranges:[{start:'10',endExclusive:'18'}]};
  const f=fixture({grants:[host]});const s=await f.open();
  for(const ranges of [undefined,[{start:'0',endExclusive:'18'}]])expect((await f.fetch(`sessions/${s.sessionId}/jobs`,'POST',{...invocation(),grants:[{...host,ranges}]},s.epoch,crypto.randomUUID())).status).toBe(403);
  expect(f.prepare).not.toHaveBeenCalled();
});
it('denies callback accesses outside a narrowed retained range before journaling or native effects',async()=>{
  const grant={grantId:'range',namespaceId:'work',handleId:'h',operations:['read' as const],maxBytes:'8',maxOperations:4,expiresAt:new Date(90000).toISOString(),ranges:[{start:'10',endExclusive:'18'}]};
  const f=fixture({grants:[grant]});const s=await f.open();
  try{
    expect((await f.fetch(`sessions/${s.sessionId}/jobs`,'POST',{...invocation(),grants:[grant]},s.epoch,'narrowed')).status).toBe(200);
    await vi.waitFor(()=>expect(f.prepare).toHaveBeenCalledOnce());const hooks=f.prepare.mock.calls[0][0].hooks;
    for(const operation of [{op:'read' as const,handleId:'h',position:'9',length:'1',channelId:4},{op:'read' as const,handleId:'other',position:'10',length:'1',channelId:4},{op:'read' as const,handleId:'h',length:'1',channelId:4},{op:'read' as const,handleId:'h',position:'17',length:'2',channelId:4}])await expect(hooks.request('range',operation)).rejects.toMatchObject({status:403});
    expect(f.admissions.record).not.toHaveBeenCalledWith(expect.objectContaining({kind:'callback'}));
    expect(f.admissions.record).not.toHaveBeenCalledWith(expect.objectContaining({kind:'effect-receipt'}));
  }finally{f.finish();}
});
it('binds every retained callback to its granted handle even without a range restriction',async()=>{
 const grant={grantId:'retain',namespaceId:'work',handleId:'h',operations:['stat' as const],maxBytes:'8',maxOperations:4,expiresAt:new Date(90000).toISOString()};
 const f=fixture({grants:[grant]});const s=await f.open();
 const job=await(await f.fetch(`sessions/${s.sessionId}/jobs`,'POST',{...invocation(),grants:[grant]},s.epoch,'retained')).json();
 await vi.waitFor(()=>expect(f.prepare).toHaveBeenCalledOnce());
 const response=f.prepare.mock.calls[0][0].hooks.request('retain',{op:'stat',handleId:'another-invocation-handle'}).catch(error=>error);
 await new Promise<void>(resolve=>setImmediate(resolve));
 f.finish();await f.fetch(`sessions/${s.sessionId}`,'DELETE',undefined,s.epoch,'close');
 expect(await response).toMatchObject({status:403});
 expect(f.admissions.record).not.toHaveBeenCalledWith(expect.objectContaining({kind:'callback'}));
 expect(job.jobId).toBeTruthy();
});
it('journals the admitted native access instead of a subsequently mutated callback request',async()=>{
 const grant={grantId:'retain',namespaceId:'work',handleId:'h',operations:['stat' as const],maxBytes:'8',maxOperations:4,expiresAt:new Date(90000).toISOString()};
 const f=fixture({grants:[grant]});const s=await f.open();
 const job=await(await f.fetch(`sessions/${s.sessionId}/jobs`,'POST',{...invocation(),grants:[grant]},s.epoch,'retained')).json();
 await vi.waitFor(()=>expect(f.prepare).toHaveBeenCalledOnce());
 const operation={op:'stat' as const,handleId:'h'};
 const response=f.prepare.mock.calls[0][0].hooks.request('retain',operation).catch(error=>error);
 operation.handleId='another-invocation-handle';
 await new Promise<void>(resolve=>setImmediate(resolve));
 const effects=await(await f.fetch(`sessions/${s.sessionId}/jobs/${job.jobId}/effects`,'GET',undefined,s.epoch)).json();
 f.finish();await f.fetch(`sessions/${s.sessionId}`,'DELETE',undefined,s.epoch,'close');await response;
 expect(effects.effects).toEqual([expect.objectContaining({state:'requested',operation:'stat',handleId:'h'})]);
});
it('refuses unqualified native descriptor mappings for range-limited handles',async()=>{
  const grant={grantId:'range',namespaceId:'work',handleId:'h',operations:['read' as const],maxBytes:'8',maxOperations:4,expiresAt:new Date(90000).toISOString(),ranges:[{start:'10',endExclusive:'18'}]};
  const f=fixture({grants:[grant],features:['descriptors','seekable-stdin']});const s=await f.open();
  try{
    const descriptor={fd:3,handleId:'h',openDescriptionId:'o',grantId:'range',rights:['read'],seekable:false};
    for(const extra of [{descriptors:[descriptor]},{stdin:{kind:'handle',handleId:'h',grantId:'range',position:'10',seekable:false}}])expect((await f.fetch(`sessions/${s.sessionId}/jobs`,'POST',{...invocation(),grants:[grant],...extra},s.epoch,crypto.randomUUID())).status).toBe(422);
    expect(f.prepare).not.toHaveBeenCalled();
  }finally{f.finish();}
});
it('rejects oversized document fragments using their actual byte span',async()=>{
 const f=fixture({config:{maxDocumentBytes:1024}});const s=await f.open();
 const chunk=new Uint8Array(1025);Object.defineProperty(chunk,'length',{value:1});
 const body=new ReadableStream<Uint8Array>({start(controller){controller.enqueue(chunk);controller.close();}});
 const response=await f.server.fetch(new Request(`https://media.test/v1/sessions/${s.sessionId}/manifests`,{
  method:'POST',body,duplex:'half',headers:{Authorization:'Bearer one','Execution-Epoch':s.epoch,'Execution-Protocol':'1','Idempotency-Key':'oversized-document'},
 } as RequestInit));
 expect(response.status).toBe(413);expect(f.prepare).not.toHaveBeenCalled();await f.server.close();
});
it('owns streamed Buffer document fragments before producer reuse', async () => {
  const f = fixture(); const s = await f.open();
  const bytes = Buffer.from('{"version":1,"capture":"observed-traversal","entries":[]}');
  const producer = Buffer.from(bytes.subarray(0, 12)); let part = 0;
  const body = new ReadableStream<Uint8Array>({ pull(controller) {
    if (part++ === 0) controller.enqueue(producer);
    else { producer.fill(120); controller.enqueue(bytes.subarray(12)); controller.close(); }
  } }, { highWaterMark: 0 });
  const response = await f.server.fetch(new Request(`https://media.test/v1/sessions/${s.sessionId}/manifests`, { method: 'POST', body, duplex: 'half', headers: { Authorization: 'Bearer one', 'Execution-Epoch': s.epoch, 'Execution-Protocol': '1', 'Idempotency-Key': 'buffer-manifest' } } as RequestInit));
  expect(response.status).toBe(200);
});
it('bounds shared job admission across sessions without waiting for running jobs', async () => {
  const f = fixture();
  const a = await f.open();
  const b = await (await f.fetch('sessions', 'POST', request, undefined, 'second-session')).json();
  try {
    expect((await f.fetch(`sessions/${a.sessionId}/jobs`, 'POST', invocation(), a.epoch, 'first')).status).toBe(200);
    expect((await f.fetch(`sessions/${b.sessionId}/jobs`, 'POST', invocation(), b.epoch, 'second')).status).toBe(200);
    expect((await f.fetch(`sessions/${b.sessionId}/jobs`, 'POST', invocation(), b.epoch, 'third')).status).toBe(429);
    expect(f.start).toHaveBeenCalledTimes(2);
  } finally { f.finish(); }
});
it('reserves shared capacity before delayed durable acceptance and releases failed reservations', async () => {
  const f = fixture(); const s = await f.open();
  let release!: () => void;
  const barrier = new Promise<void>(resolve => { release = resolve; });
  f.admissions.inspect.mockImplementation(async () => { await barrier; return null; });
  const first = f.fetch(`sessions/${s.sessionId}/jobs`, 'POST', invocation(), s.epoch, 'race-first');
  const second = f.fetch(`sessions/${s.sessionId}/jobs`, 'POST', invocation(), s.epoch, 'race-second');
  await vi.waitFor(() => expect(f.admissions.inspect).toHaveBeenCalledTimes(2));
  let response: Response | undefined;
  const third = f.fetch(`sessions/${s.sessionId}/jobs`, 'POST', invocation(), s.epoch, 'race-third').then(value => { response = value; });
  try {
    await vi.waitFor(() => expect(response?.status).toBe(429));
  } finally { release(); await Promise.all([first, second, third]); f.finish(); }
});
it('releases shared admission reservations when validation fails', async () => {
  const f = fixture(); const s = await f.open();
  for (let i = 0; i < 4; i++) expect((await f.fetch(`sessions/${s.sessionId}/jobs`, 'POST', { ...invocation(), cwd: 'relative' }, s.epoch, `invalid-${i}`)).status).toBe(400);
  try { expect((await f.fetch(`sessions/${s.sessionId}/jobs`, 'POST', invocation(), s.epoch, 'valid')).status).toBe(200); }
  finally { f.finish(); }
});
it('keeps capacity quarantined after unknown native cleanup', async () => {
  const f = fixture(); const s = await f.open();
  f.close.mockRejectedValue(new Error('provider cleanup lost'));
  const ids: string[] = [];
  for (let i = 0; i < 2; i++) ids.push((await (await f.fetch(`sessions/${s.sessionId}/jobs`, 'POST', invocation(), s.epoch, `uncertain-${i}`)).json()).jobId);
  f.finish();
  for (const id of ids) expect(await (await f.fetch(`sessions/${s.sessionId}/jobs/${id}/wait`, 'GET', undefined, s.epoch)).json()).toMatchObject({ state: 'terminal', cleanup: 'unknown' });
  expect((await f.fetch(`sessions/${s.sessionId}/jobs`, 'POST', invocation(), s.epoch, 'overcommit-unknown')).status).toBe(429);
});
describe('authenticated v1 media service', () => {
  it('advertises the revised shared and output-retention admission profile', async () => {
    const f = fixture();
    const capabilities = await (await f.fetch('capabilities')).json();
    expect(capabilities.features).toContain('server-resource-admission-v2');
  });
  it.each(['imageDigest', 'librariesDigest', 'inventoryDigest', 'assetsDigest', 'launcherRevision', 'bridgeRevision', 'policyDigest', 'configDigest', 'grammarRevision', 'sourceRevision'] as const)('refuses observed %s drift before namespace acquisition', async field => {
    const f = fixture(); f.inspectBuild.mockResolvedValueOnce({ ...build, [field]: field === 'imageDigest' ? 'sha256:' + 'b'.repeat(64) : 'b'.repeat(64) });
    expect((await f.fetch('sessions', 'POST', request)).status).toBe(409);
    expect(f.admitSession).not.toHaveBeenCalled();
  });
  it('checks the observed build before granting a namespace, and reports policy differences', async () => {
    const f = fixture(); f.inspectBuild.mockResolvedValueOnce({...build, configDigest:'b'.repeat(64)});
    expect((await f.fetch('sessions','POST',request)).status).toBe(409); expect(f.admitSession).not.toHaveBeenCalled();
    const caps = await (await f.fetch('capabilities')).json(); expect(caps.builds[0].policyDifferences).toEqual(['network denied']);
  });
  it('binds sessions to tenant/principal and epoch and recovers initial admission by key', async () => {
    const f = fixture(); const s = await f.open();
    expect((await f.fetch(`sessions/${s.sessionId}`,'GET',undefined,s.epoch,'key','two')).status).toBe(404);
    expect((await f.fetch(`sessions/${s.sessionId}`,'GET',undefined,'stale')).status).toBe(410);
    const recovered = await (await f.fetch('operations/key')).json(); expect(recovered.resourceId).toBe(s.sessionId);
    const again = await (await f.fetch('sessions','POST',request)).json(); expect(again.sessionId).toBe(s.sessionId); expect(f.admitSession).toHaveBeenCalledTimes(1);
    expect((await f.fetch('sessions','POST',{...request,buildDigest:'b'.repeat(64)})).status).toBe(409);
  });
  it('rejects frontend mismatch, argv overflow, unknown fields and unsupported descriptors before prepare', async () => {
    const f = fixture(); const s = await f.open();
    for (const input of [{...invocation(),frontendContract:{grammarRevision:'wrong',sourceRevision:'s1'}}, {...invocation(),args:[Array(65).fill(1)]}, {...invocation(),shell:'echo hi'}, {...invocation(), descriptors:[{fd:3,handleId:'h',openDescriptionId:'o',grantId:'g',rights:['read'],seekable:true}]}]) {
      expect((await f.fetch(`sessions/${s.sessionId}/jobs`,'POST',input,s.epoch,crypto.randomUUID())).status).toBeGreaterThanOrEqual(400);
    }
    expect(f.prepare).not.toHaveBeenCalled();
  });
  it('returns accepted metadata without waiting for exit, preserves argv and distinguishes draining from terminal', async () => {
    const f = fixture(); const s = await f.open(); const input = invocation();
    const job = await (await f.fetch(`sessions/${s.sessionId}/jobs`,'POST',input,s.epoch)).json();
    expect(job.jobId).toBeTruthy(); await vi.waitFor(() => expect(f.start).toHaveBeenCalledTimes(1));
    expect(f.prepare.mock.calls[0][0].request.args).toEqual(input.args);
    f.exit(); await vi.waitFor(async () => expect((await (await f.fetch(`sessions/${s.sessionId}/jobs/${job.jobId}`,'GET',undefined,s.epoch)).json()).state).toBe('draining'));
    await f.start.mock.calls[0][0].end(2);await f.start.mock.calls[0][0].end(3);f.settle(); await vi.waitFor(async () => { const status = await (await f.fetch(`sessions/${s.sessionId}/jobs/${job.jobId}/wait`,'GET',undefined,s.epoch)).json(); expect(status.state).toBe('terminal'); expect(status.outcome).toEqual({kind:'exited',exitCode:1}); });
    expect(f.close).toHaveBeenCalledTimes(1);
    const replay = await (await f.fetch(`sessions/${s.sessionId}/jobs`,'POST',input,s.epoch)).json(); expect(replay.jobId).toBe(job.jobId); expect(f.start).toHaveBeenCalledTimes(1);
  });
  it('records cancellation separately and closes admission on lease expiry', async () => {
    const f = fixture(); const s = await f.open(); const job = await (await f.fetch(`sessions/${s.sessionId}/jobs`,'POST',invocation(),s.epoch)).json();
    await vi.waitFor(() => expect(f.start).toHaveBeenCalled());
    const cancel = await (await f.fetch(`sessions/${s.sessionId}/jobs/${job.jobId}/cancel`,'POST',{reason:'stop'},s.epoch,'cancel')).json(); expect(cancel.cancelRequested).toBe(true); expect(f.process.signal).toHaveBeenCalledWith('SIGTERM');
    f.advance(); expect((await f.fetch(`sessions/${s.sessionId}/jobs`,'POST',invocation(),s.epoch,'later')).status).toBe(410);
    f.finish(); await f.server.sweep();
  });
});

it('refuses a concurrent duplicate admission before it can prepare a second native process', async () => {
  const f=fixture();const s=await f.open();let release!:()=>void;
  f.inspectBuild.mockImplementationOnce(async () => {await new Promise<void>(r=>{release=r;});return structuredClone(build);});
  const first=f.fetch(`sessions/${s.sessionId}/jobs`,'POST',invocation(),s.epoch);
  await vi.waitFor(()=>expect(release).toBeTypeOf('function'));
  const second=await f.fetch(`sessions/${s.sessionId}/jobs`,'POST',invocation(),s.epoch);expect(second.status).toBe(409);
  release();await first;f.finish();await vi.waitFor(()=>expect(f.start).toHaveBeenCalledTimes(1));
});
it('checks build mismatch again at job admission before driver preparation',async()=>{
  const f=fixture();const s=await f.open();f.inspectBuild.mockResolvedValueOnce({...build,assetsDigest:'b'.repeat(64)});
  expect((await f.fetch(`sessions/${s.sessionId}/jobs`,'POST',invocation(),s.epoch)).status).toBe(409);expect(f.prepare).not.toHaveBeenCalled();
});

it.each(['durable admission', 'namespace preparation', 'running publication'] as const)('refuses build drift during %s before the next native side effect', async boundary => {
 const f=fixture();const s=await f.open();let changed=false;
 f.inspectBuild.mockImplementation(async()=>structuredClone(changed?{...build,policyDigest:'b'.repeat(64)}:build));
 f.admissions.record.mockImplementation(async value=>{
  if(boundary==='durable admission'&&value?.kind==='job'
   ||boundary==='running publication'&&value?.jobState?.stage==='running')changed=true;
 });
 if(boundary==='namespace preparation')f.prepare.mockImplementation(async()=>{
  changed=true;return{start:f.start,close:f.close};
 });
 try{
  const response=await f.fetch(`sessions/${s.sessionId}/jobs`,'POST',invocation(),s.epoch,'drift');
  expect(response.status).toBe(200);const admitted=await response.json();
  await vi.waitFor(async()=>{
   const job=await(await f.fetch(`sessions/${s.sessionId}/jobs/${admitted.jobId}`,'GET',undefined,s.epoch)).json();
   expect(job.state).toBe('terminal');expect(job.outputComplete).toBe(false);
   expect(job.processOutcome).toBeUndefined();expect(job.outcome.kind).toBe('unknown');
  });
  expect(f.start).not.toHaveBeenCalled();
  if(boundary==='durable admission')expect(f.prepare).not.toHaveBeenCalled();
  else expect(f.close).toHaveBeenCalledOnce();
  const replay=await(await f.fetch(`sessions/${s.sessionId}/jobs`,'POST',invocation(),s.epoch,'drift')).json();
  expect(replay.jobId).toBe(admitted.jobId);expect(f.start).not.toHaveBeenCalled();
 }finally{f.finish();await f.server.close();}
});

it('stores exact manifest bytes with byte ordering and advertises unsupported materialization rather than applying snapshots',async()=>{
 const f=fixture();const s=await f.open();
 const manifest={version:1,capture:'observed-traversal',entries:[{type:'directory',path:'z'},{type:'directory',path:'é'}]};
 const receipt=await (await f.fetch(`sessions/${s.sessionId}/manifests`,'POST',manifest,s.epoch,'manifest')).json();expect(receipt.manifestId).toBeTruthy();
 const stored=await f.fetch(`sessions/${s.sessionId}/manifests/${receipt.manifestId}`,'GET',undefined,s.epoch);expect(await stored.text()).toBe(JSON.stringify(manifest));
 const response=await f.fetch(`sessions/${s.sessionId}/materializations`,'POST',{manifestId:receipt.manifestId,namespaceId:'work',root:'/',expectedRevision:null,conflictPolicy:'refuse',grantId:'host-issued'},s.epoch,'materialize');expect(response.status).toBe(422);
});

it('materialization callbacks are scoped to their operation and do not launch a native tool',async()=>{
 const grant:import('./wire.generated.js').Grant={grantId:'host-issued',namespaceId:'work',root:'/',operations:['stat'],maxBytes:'64',maxOperations:4,expiresAt:new Date(100000).toISOString()};
 const materialize=vi.fn(async({operationId,request,hooks}:Parameters<NonNullable<import('./media-server.js').SessionAuthority['materialize']>>[0])=>{
   const response=await hooks.request('host-issued',{op:'stat',path:'/x'});expect(response.state).toBe('failed');
   return {operationId,namespaceId:request.namespaceId,root:request.root,state:'failed' as const,revision:null,effects:[]};
 });
 const f=fixture({grants:[grant],materialize});const s=await f.open();
 const receipt=await (await f.fetch(`sessions/${s.sessionId}/manifests`,'POST',{version:1,capture:'observed-traversal',entries:[]},s.epoch,'manifest')).json();
 const op=await (await f.fetch(`sessions/${s.sessionId}/materializations`,'POST',{manifestId:receipt.manifestId,namespaceId:'work',root:'/',expectedRevision:null,conflictPolicy:'refuse',grantId:'host-issued'},s.epoch,'materialize')).json();
 const laneResponse=await f.fetch(`sessions/${s.sessionId}/materializations/${op.operationId}/lanes`,'POST',{direction:'output',consumerId:'owner'},s.epoch,'lane');expect(laneResponse.status).toBe(200);const lane=await laneResponse.json();
 const response=await f.fetch(`sessions/${s.sessionId}/materializations/${op.operationId}/lanes/${lane.laneId}/frames`,'GET',undefined,s.epoch);
 const {decodeFrames}=await import('./binary.js');const {validateWire}=await import('./wire-validation.js');
 const frames=decodeFrames(response.body!,{maxFrameBytes:4096,maxControlBytes:4096,channels:[],validateControl:v=>validateWire('Control',v)});const frame=await frames.next();
 let callback=JSON.parse(new TextDecoder().decode(frame.value!.payload));if(callback.type==='Effect')callback=JSON.parse(new TextDecoder().decode((await frames.next()).value!.payload));expect(callback.owner).toEqual({kind:'materialization',id:op.operationId});
 const answer={type:'CallbackResult',callbackId:callback.callbackId,operationId:callback.operationId,state:'failed',error:{category:'filesystem',code:'ENOENT',message:'not found',phase:'notAccepted'}};
 expect((await f.fetch(`sessions/${s.sessionId}/materializations/${op.operationId}/callbacks/${callback.callbackId}/result`,'POST',answer,s.epoch,'answer')).status).toBe(200);
 await frames.return();await vi.waitFor(async()=>expect((await (await f.fetch(`sessions/${s.sessionId}/materializations/${op.operationId}`,'GET',undefined,s.epoch)).json()).state).toBe('failed'));
 expect(f.start).not.toHaveBeenCalled();
});
it('rejects unsupported argv byte encoding before any preparation effect',async()=>{
 const f=fixture();const s=await f.open();expect((await f.fetch(`sessions/${s.sessionId}/jobs`,'POST',{...invocation(),args:[[255]]},s.epoch)).status).toBe(422);expect(f.prepare).not.toHaveBeenCalled();
});
it('replays acknowledged input frames without writing stdin twice after a dropped response',async()=>{
 const f=fixture();const s=await f.open();const job=await(await f.fetch(`sessions/${s.sessionId}/jobs`,'POST',invocation(),s.epoch)).json();await vi.waitFor(()=>expect(f.start).toHaveBeenCalled());
 const lane=await(await f.fetch(`sessions/${s.sessionId}/jobs/${job.jobId}/lanes`,'POST',{direction:'input',consumerId:'owner'},s.epoch,'lane')).json();const {encodeFrame,binaryContentType}=await import('./binary.js');
 const wire=encodeFrame({kind:'data',channelId:1,sequence:1n,offset:0n,correlationId:0n,payload:new Uint8Array([0,255])},{maxFrameBytes:4096,maxControlBytes:4096,channels:[1]});
 const send=()=>f.server.fetch(new Request(`https://media.test/v1/sessions/${s.sessionId}/jobs/${job.jobId}/lanes/${lane.laneId}/frames`,{method:'POST',headers:{Authorization:'Bearer one','Execution-Protocol':'1','Execution-Epoch':s.epoch,'Content-Type':binaryContentType,'Execution-Cursor':'1','Idempotency-Key':'input'},body:wire}));
 expect((await send()).status).toBe(200);expect((await send()).status).toBe(200);expect(f.process.write).toHaveBeenCalledTimes(1);f.finish();
});
it('binds lane mutation keys to their exact request and permits a fresh retained-output consumer',async()=>{
 const f=fixture();const s=await f.open();const job=await(await f.fetch(`sessions/${s.sessionId}/jobs`,'POST',invocation(),s.epoch)).json();
 const lanePath=`sessions/${s.sessionId}/jobs/${job.jobId}/lanes`;const first=await(await f.fetch(lanePath,'POST',{direction:'output',consumerId:'one'},s.epoch,'lane')).json();expect(first.laneId).toBeTruthy();
 expect((await f.fetch(lanePath,'POST',{direction:'input',consumerId:'one'},s.epoch,'lane')).status).toBe(409);
 expect((await f.fetch(lanePath,'POST',{direction:'output',consumerId:'two'},s.epoch,'second-lane')).status).toBe(200);f.finish();
});

it('records admission before native preparation and does not launch when durable recording fails',async()=>{
 const f=fixture();const s=await f.open();f.admissions.record.mockRejectedValueOnce(new Error('storage unavailable'));
 expect((await f.fetch(`sessions/${s.sessionId}/jobs`,'POST',invocation(),s.epoch)).status).toBe(503);expect(f.prepare).not.toHaveBeenCalled();expect(f.start).not.toHaveBeenCalled();
});
it('does not deliver retained output after an established stream credential/session expires',async()=>{
 const f=fixture();const s=await f.open();const job=await(await f.fetch(`sessions/${s.sessionId}/jobs`,'POST',invocation(),s.epoch)).json();await vi.waitFor(()=>expect(f.start).toHaveBeenCalled());
 const lane=await(await f.fetch(`sessions/${s.sessionId}/jobs/${job.jobId}/lanes`,'POST',{direction:'output',consumerId:'owner'},s.epoch,'lane')).json();
 const response=await f.fetch(`sessions/${s.sessionId}/jobs/${job.jobId}/lanes/${lane.laneId}/frames`,'GET',undefined,s.epoch);const reader=response.body!.getReader();expect((await reader.read()).done).toBe(false);
 f.expireCredential();await f.start.mock.calls[0][0].output(2,new Uint8Array([9]));await expect(reader.read()).rejects.toThrow();f.finish();
});

it('preserves one effect sequence across native operation transitions',async()=>{
 const f=fixture();const s=await f.open();
 const job=await(await f.fetch(`sessions/${s.sessionId}/jobs`,'POST',invocation(),s.epoch)).json();
 await vi.waitFor(()=>expect(f.start).toHaveBeenCalledOnce());
 const hooks=f.prepare.mock.calls[0][0].hooks;
 const operation={operationId:'native-write',namespaceId:'work',operation:'write' as const,path:'/output',length:'3'};
 try{
  await hooks.effect({...operation,state:'requested'});
  await hooks.effect({...operation,state:'applied',acknowledgedBytes:'3'});
  const effects=await(await f.fetch(`sessions/${s.sessionId}/jobs/${job.jobId}/effects`,'GET',undefined,s.epoch)).json();
  expect(effects.effects.map((effect:import('./wire.generated.js').Effect)=>[effect.state,effect.sequence])).toEqual([['requested','1'],['applied','1']]);
  expect(effects.effectBarrier).toBe('1');
 }finally{
  await f.start.mock.calls[0][0].end(2);await f.start.mock.calls[0][0].end(3);f.finish();
  await f.fetch(`sessions/${s.sessionId}/jobs/${job.jobId}/wait`,'GET',undefined,s.epoch);
 }
});
it('keeps native exit separate from unresolved file effects at settlement',async()=>{
 const f=fixture();const s=await f.open();
 const job=await(await f.fetch(`sessions/${s.sessionId}/jobs`,'POST',invocation(),s.epoch)).json();
 await vi.waitFor(()=>expect(f.start).toHaveBeenCalledOnce());
 await f.prepare.mock.calls[0][0].hooks.effect({operationId:'native-write',namespaceId:'work',operation:'write',state:'requested',path:'/output'});
 await f.start.mock.calls[0][0].end(2);await f.start.mock.calls[0][0].end(3);f.finish();
 const final=await(await f.fetch(`sessions/${s.sessionId}/jobs/${job.jobId}/wait`,'GET',undefined,s.epoch)).json();
 expect(final).toMatchObject({processOutcome:{kind:'exited',exitCode:1},outcome:{kind:'unknown'},outputComplete:false});
 const effects=await(await f.fetch(`sessions/${s.sessionId}/jobs/${job.jobId}/effects`,'GET',undefined,s.epoch)).json();
 expect(effects.effects.at(-1)).toMatchObject({operationId:'native-write',sequence:'1',state:'unknown'});
});
it('refuses file effects after invocation settlement',async()=>{
 const f=fixture();const s=await f.open();
 const job=await(await f.fetch(`sessions/${s.sessionId}/jobs`,'POST',invocation(),s.epoch)).json();
 await vi.waitFor(()=>expect(f.start).toHaveBeenCalledOnce());
 const hooks=f.prepare.mock.calls[0][0].hooks;
 await f.start.mock.calls[0][0].end(2);await f.start.mock.calls[0][0].end(3);f.finish();
 await f.fetch(`sessions/${s.sessionId}/jobs/${job.jobId}/wait`,'GET',undefined,s.epoch);
 await expect(hooks.effect({operationId:'late-write',namespaceId:'work',operation:'write',state:'applied'})).rejects.toMatchObject({status:410});
 const effects=await(await f.fetch(`sessions/${s.sessionId}/jobs/${job.jobId}/effects`,'GET',undefined,s.epoch)).json();
 expect(effects.effects).toEqual([]);expect(effects.effectBarrier).toBe('0');
});
it('does not complete materialization with an unresolved native file effect',async()=>{
 const f=fixture({materialize:async({operationId,request,hooks})=>{
  await hooks.effect({operationId:'pending-write',operation:'write',state:'requested',namespaceId:request.namespaceId,path:'/x'});
  return {operationId,namespaceId:request.namespaceId,root:request.root,state:'complete',revision:'1',effects:[]};
 }});
 const s=await f.open();
 const manifestResponse=await f.fetch(`sessions/${s.sessionId}/manifests`,'POST',{version:1,capture:'observed-traversal',entries:[]},s.epoch,'manifest');
 expect(manifestResponse.status).toBe(200);const manifest=await manifestResponse.json();
 const op=await(await f.fetch(`sessions/${s.sessionId}/materializations`,'POST',{manifestId:manifest.manifestId,namespaceId:'work',grantId:'host-issued',root:'/',expectedRevision:null,conflictPolicy:'refuse'},s.epoch,'materialize')).json();
 await vi.waitFor(async()=>{
  const result=await(await f.fetch(`sessions/${s.sessionId}/materializations/${op.operationId}`,'GET',undefined,s.epoch)).json();
  expect(result.state).toBe('partial');
  expect(result.effects.at(-1)).toMatchObject({operationId:'pending-write',sequence:'1',state:'unknown'});
 });
 expect(f.start).not.toHaveBeenCalled();
});
it('never publishes a completed terminal stream when a driver omits channel END',async()=>{
 const f=fixture();const s=await f.open();const job=await(await f.fetch(`sessions/${s.sessionId}/jobs`,'POST',invocation(),s.epoch)).json();f.finish();
 const final=await(await f.fetch(`sessions/${s.sessionId}/jobs/${job.jobId}/wait`,'GET',undefined,s.epoch)).json();expect(final.outputComplete).toBe(false);expect(final.outcome.kind).toBe('unknown');
});
it('reports an unknown outcome at the deadline when native does not confirm termination',async()=>{
 vi.useFakeTimers();try{const f=fixture();const s=await f.open();const job=await(await f.fetch(`sessions/${s.sessionId}/jobs`,'POST',invocation(),s.epoch)).json();await vi.advanceTimersByTimeAsync(10001);
 const status=await(await f.fetch(`sessions/${s.sessionId}/jobs/${job.jobId}`,'GET',undefined,s.epoch)).json();expect(status.state).toBe('terminal');expect(status.outcome.kind).toBe('unknown');expect(status.outputComplete).toBe(false);
 f.finish();}finally{vi.useRealTimers();}
});

it.each([null,'bytes=0-3'])('reports a truncated advertised file body (range: %s) after preserving its delivered prefix',async range=>{
 const close=vi.fn(async()=>{});
 const f=fixture({files:{async open(){return{async stat(){return{type:'file' as const,size:8n};},async read(position){return position===0n?Uint8Array.of(7):new Uint8Array();},close};},async list(){return[];}}});
 const s=await f.open();
 const handle=await(await f.fetch(`sessions/${s.sessionId}/file-handles`,'POST',{namespaceId:'work',grantId:'host-issued',path:'/live'},s.epoch,'short-range')).json();
 const response=await f.server.fetch(new Request(`https://media.test/v1/sessions/${s.sessionId}/file-handles/${handle.handleId}/bytes`,{headers:{Authorization:'Bearer one','Execution-Epoch':s.epoch,'Execution-Protocol':'1',...(range?{Range:range}:{})}}));
 expect(response.status).toBe(range?206:200);expect(response.headers.get('Content-Length')).toBe(range?'4':'8');
 const reader=response.body!.getReader();
 try{
  expect((await reader.read()).value).toEqual(Uint8Array.of(7));
  await expect(reader.read()).rejects.toThrow('Incomplete HTTP byte body');
 }finally{await reader.cancel().catch(()=>{});await f.server.close();}
 expect(close).toHaveBeenCalledOnce();
});
it('exposes authenticated retained metadata, listings and raw range reads through the matching SDK',async()=>{
 const read=vi.fn(async(position:bigint,count:number)=>new Uint8Array([0,255,128,7]).slice(Number(position),Number(position)+count));const close=vi.fn(async()=>{});
 const f=fixture({files:{async open(){return {async stat(){return {size:4n,type:'file' as const,mode:0o600};},read,close};},async list(){return [{name:'x',type:'file'}];}}});
 const {createClient}=await import('./client.js');const client=createClient({baseUrl:'https://media.test',token:async()=> 'one',fetch:async(url,init)=>f.server.fetch(new Request(url,init))});
 const s=await client.openSession(request,'session');const handle=await client.openFile(s,{namespaceId:'work',grantId:'host-issued',path:'/x'},'file');expect((await client.fileMetadata(s,handle.handleId)).size).toBe('4');
 const result=await client.readFileRange(s,handle.handleId,1n,2n);expect(result.status).toBe(206);expect(result.headers.get('Content-Range')).toBe('bytes 1-2/4');const reader=result.body!.getReader();expect((await reader.read()).value).toEqual(new Uint8Array([255,128]));expect((await reader.read()).done).toBe(true);
 expect(await client.listFiles(s,{namespaceId:'work',grantId:'host-issued',path:'/',maxEntries:1},'listing')).toEqual([{name:'x',type:'file'}]);await client.closeFile(s,handle.handleId,'close-file');expect(close).toHaveBeenCalledTimes(1);
});
it('never replays a failed retained close as successful cleanup',async()=>{
 const close=vi.fn(async()=>{throw new Error('close failed');});
 const f=fixture({files:{async open(){return {async stat(){return {size:0n,type:'file' as const};},async read(){return new Uint8Array();},close};},async list(){return [];}}});
 const s=await f.open();const handle=await(await f.fetch(`sessions/${s.sessionId}/file-handles`,'POST',{namespaceId:'work',grantId:'host-issued',path:'/x'},s.epoch,'open')).json();
 for(let attempt=0;attempt<2;attempt++)expect((await f.fetch(`sessions/${s.sessionId}/file-handles/${handle.handleId}`,'DELETE',undefined,s.epoch,'close')).status).toBe(503);
 expect(close).toHaveBeenCalledOnce();expect((await f.fetch(`sessions/${s.sessionId}/file-handles/${handle.handleId}`,'GET',undefined,s.epoch)).status).toBe(404);
});
it('allows invocation credentials to read only file handles owned by that invocation',async()=>{
 const credential={invocationId:undefined as string|undefined};
 const f=fixture({config:{authenticate:async()=>({tenantId:'tenant',principalId:'p',expiresAt:100000,...credential})},files:{async open(){return {async stat(){return {size:1n,type:'file' as const};},async read(){return new Uint8Array([7]);},async close(){}};},async list(){return [];}}});
 const s=await f.open();const own=await(await f.fetch(`sessions/${s.sessionId}/jobs`,'POST',invocation(),s.epoch,'own')).json();
 const other=await(await f.fetch(`sessions/${s.sessionId}/jobs`,'POST',invocation(),s.epoch,'other')).json();
 const handles=[];
 for(const job of [own,other])handles.push(await(await f.fetch(`sessions/${s.sessionId}/file-handles`,'POST',{namespaceId:'work',grantId:'host-issued',path:'/x',jobId:job.jobId},s.epoch,'file:'+job.jobId)).json());
 credential.invocationId=own.jobId;
 expect((await f.fetch(`sessions/${s.sessionId}/file-handles/${handles[0].handleId}`,'GET',undefined,s.epoch)).status).toBe(200);
 const bytes=await f.fetch(`sessions/${s.sessionId}/file-handles/${handles[0].handleId}/bytes`,'GET',undefined,s.epoch);expect(bytes.status).toBe(200);expect(new Uint8Array(await bytes.arrayBuffer())).toEqual(new Uint8Array([7]));
 expect((await f.fetch(`sessions/${s.sessionId}/file-handles/${handles[1].handleId}`,'GET',undefined,s.epoch)).status).toBe(404);
 expect((await f.fetch(`sessions/${s.sessionId}/file-handles/${handles[1].handleId}`,'DELETE',undefined,s.epoch,'close-other')).status).toBe(404);
 expect((await f.fetch(`sessions/${s.sessionId}/file-handles/${handles[0].handleId}`,'DELETE',undefined,s.epoch,'close-own')).status).toBe(200);
 expect((await f.fetch(`sessions/${s.sessionId}/file-handles/${handles[0].handleId}`,'DELETE',undefined,s.epoch,'close-own')).status).toBe(200);
 expect((await f.fetch(`sessions/${s.sessionId}/file-handles`,'POST',{namespaceId:'work',grantId:'host-issued',path:'/x'},s.epoch,'forbidden')).status).toBe(403);
 expect((await f.fetch(`sessions/${s.sessionId}/jobs/${other.jobId}`,'GET',undefined,s.epoch)).status).toBe(403);
 f.finish();
});
it.each(['', '.', '..', 'a/b', 'a\0b', '\ud800'])('rejects malformed backend listing component %j without publishing it',async name=>{
 const f=fixture({files:{async open(){throw new Error('unused');},async list(){return [{name,type:'file'}];}}});
 const s=await f.open();
 const response=await f.fetch(`sessions/${s.sessionId}/file-listings`,'POST',{namespaceId:'work',grantId:'host-issued',path:'/',maxEntries:1},s.epoch,'listing');
 expect(response.status).toBe(503);
 expect(await response.json()).toMatchObject({category:'filesystem',code:'EIO'});
});
it('snapshots listing entries once and ignores backend JSON hooks',async()=>{
 let reads=0;
 const entry={get name(){return ++reads===1?'safe':'../escape';},type:'file' as const};
 const entries=[entry];Object.defineProperty(entries,'toJSON',{value:()=>[{name:'../escape',type:'file'}]});
 const f=fixture({files:{async open(){throw new Error('unused');},async list(){return entries;}}});
 const s=await f.open();
 const response=await f.fetch(`sessions/${s.sessionId}/file-listings`,'POST',{namespaceId:'work',grantId:'host-issued',path:'/',maxEntries:1},s.epoch,'listing');
 expect(response.status).toBe(200);expect(await response.json()).toEqual([{name:'safe',type:'file'}]);expect(reads).toBe(1);
});
it('refuses listing count and aggregate metadata overflow without truncated success',async()=>{
 for(const entries of [[{name:'a',type:'file' as const},{name:'b',type:'file' as const}],[{name:'x'.repeat(16384),type:'file' as const}]]){
  const f=fixture({files:{async open(){throw new Error('unused');},async list(){return entries;}}});const s=await f.open();
  const response=await f.fetch(`sessions/${s.sessionId}/file-listings`,'POST',{namespaceId:'work',grantId:'host-issued',path:'/',maxEntries:1},s.epoch,'listing');
  expect(response.status).toBe(413);expect(await response.json()).toMatchObject({category:'filesystem',code:'EFBIG'});
 }
});
it('journals callback access before native acknowledgement and retains the same effect sequence on settlement',async()=>{
 const grant:import('./wire.generated.js').Grant={grantId:'host-issued',namespaceId:'work',root:'/',operations:['stat'],maxBytes:'64',maxOperations:4,expiresAt:new Date(100000).toISOString()};const f=fixture({grants:[grant]});const s=await f.open();
 f.prepare.mockImplementationOnce(async input=>{await input.hooks.request('host-issued',{op:'stat',path:'/x'});return {start:f.start,close:f.close};});
 const job=await(await f.fetch(`sessions/${s.sessionId}/jobs`,'POST',{...invocation(),grants:[grant]},s.epoch)).json();
 const lane=await(await f.fetch(`sessions/${s.sessionId}/jobs/${job.jobId}/lanes`,'POST',{direction:'output',consumerId:'owner'},s.epoch,'lane')).json();const response=await f.fetch(`sessions/${s.sessionId}/jobs/${job.jobId}/lanes/${lane.laneId}/frames`,'GET',undefined,s.epoch);
 const {decodeFrames}=await import('./binary.js');const {validateWire}=await import('./wire-validation.js');const frames=decodeFrames(response.body!,{maxFrameBytes:4096,maxControlBytes:4096,channels:[2,3],validateControl:v=>validateWire('Control',v)});
 const initial=JSON.parse(new TextDecoder().decode((await frames.next()).value!.payload));expect(initial.type).toBe('Effect');expect(initial.effect.state).toBe('requested');expect(initial.effect.sequence).toBe('1');
 const callback=JSON.parse(new TextDecoder().decode((await frames.next()).value!.payload));const answer={type:'CallbackResult',callbackId:callback.callbackId,operationId:callback.operationId,state:'failed',error:{category:'filesystem',code:'ENOENT',message:'not found',phase:'notAccepted'}};
 expect((await f.fetch(`sessions/${s.sessionId}/jobs/${job.jobId}/callbacks/${callback.callbackId}/result`,'POST',answer,s.epoch,'answer')).status).toBe(200);
 const settled=JSON.parse(new TextDecoder().decode((await frames.next()).value!.payload));expect(settled.effect.state).toBe('failed');expect(settled.effect.sequence).toBe('1');expect(settled.effect.error).toEqual(answer.error);await frames.return();f.finish();
});

it.each([false, true])('keeps an unavailable effect settlement receipt unknown across retries (published: %s)', async published => {
 const grant:import('./wire.generated.js').Grant={grantId:'host-issued',namespaceId:'work',root:'/',operations:['stat'],maxBytes:'64',maxOperations:4,expiresAt:new Date(100000).toISOString()};
 const f=fixture({grants:[grant]});const s=await f.open();
 let started!:()=>void;const launched=new Promise<void>(resolve=>{started=resolve;});
 f.start.mockImplementation(()=>{started();return f.process;});
 const job=await(await f.fetch(`sessions/${s.sessionId}/jobs`,'POST',{...invocation(),grants:[grant]},s.epoch)).json();await launched;
 const pending=f.prepare.mock.calls[0][0].hooks.request('host-issued',{op:'stat',path:'/x'});void pending.catch(()=>{});
 const lane=await(await f.fetch(`sessions/${s.sessionId}/jobs/${job.jobId}/lanes`,'POST',{direction:'output',consumerId:'owner'},s.epoch,'lane')).json();
 const response=await f.fetch(`sessions/${s.sessionId}/jobs/${job.jobId}/lanes/${lane.laneId}/frames`,'GET',undefined,s.epoch);
 const {decodeFrames}=await import('./binary.js');const {validateWire}=await import('./wire-validation.js');const frames=decodeFrames(response.body!,{maxFrameBytes:4096,maxControlBytes:4096,channels:[2,3],validateControl:value=>validateWire('Control',value)});
 let callback:import('./wire.generated.js').Callback|undefined;
 while(!callback){const frame=await frames.next();const value=JSON.parse(new TextDecoder().decode(frame.value!.payload));if(value.type==='Callback')callback=value;}
 const cause=new TypeError('Durable receipt provider unavailable');let attempts=0;const records=new Map<string,import('./admissions.js').AdmissionRecord>();
 f.exit();
 f.admissions.record.mockImplementation(async(value?:import('./admissions.js').AdmissionRecord)=>{
  if(value?.effectReceipt?.state==='applied'){attempts++;if(published)records.set(value.operationId,structuredClone(value));throw cause;}
 });
 const answer={type:'CallbackResult',callbackId:callback.callbackId,operationId:callback.operationId,state:'applied',stat:{type:'file',size:0,mode:0o644,mtimeMs:0,atimeMs:0,ctimeMs:0}};
 try{
  for(const key of ['answer','answer','another-answer']){
   const result=await f.fetch(`sessions/${s.sessionId}/jobs/${job.jobId}/callbacks/${callback.callbackId}/result`,'POST',answer,s.epoch,key);
   expect(result.status).toBe(503);expect(await result.json()).toMatchObject({category:'unknown',phase:'unknown'});
  }
  expect(attempts).toBe(1);expect(records.size).toBe(published?1:0);expect(f.start).toHaveBeenCalledOnce();
 }finally{await frames.return();f.finish();}
 const terminal=await(await f.fetch(`sessions/${s.sessionId}/jobs/${job.jobId}/wait`,'GET',undefined,s.epoch)).json();
 expect(terminal).toMatchObject({outputComplete:false,outcome:{kind:'unknown'},processOutcome:{kind:'exited',exitCode:1}});
 await expect(pending).rejects.toMatchObject({status:503,cause});
});

it('bounds callback admission retention and classifies provider rejection independently from caller input', async()=>{
 const grant:import('./wire.generated.js').Grant={grantId:'host-issued',namespaceId:'work',root:'/',operations:['stat'],maxBytes:'64',maxOperations:4,expiresAt:new Date(100000).toISOString()};
 const f=fixture({grants:[grant]});const s=await f.open();
 let started!:()=>void;const launched=new Promise<void>(resolve=>{started=resolve;});f.start.mockImplementation(()=>{started();return f.process;});
 const job=await(await f.fetch(`sessions/${s.sessionId}/jobs`,'POST',{...invocation(),grants:[grant]},s.epoch)).json();await launched;
 const cause=new TypeError('Callback ledger unavailable');
 f.admissions.record.mockImplementation(async(value?:import('./admissions.js').AdmissionRecord)=>{if(value?.kind==='callback')throw cause;});
 try{
  await expect(f.prepare.mock.calls[0][0].hooks.request('host-issued',{op:'stat',path:'/x'})).rejects.toMatchObject({status:503,cause});
  const admission=f.admissions.record.mock.calls.map(([value])=>value as import('./admissions.js').AdmissionRecord|undefined).find(value=>value?.kind==='callback');
  expect(admission).toMatchObject({retainedUntil:Date.parse(job.retainedUntil),buildDigest:job.buildDigest});
 }finally{f.finish();}
});

it('reclaims durable callback admissions with their invocation TTL without discarding them early', async()=>{
 const {createFsFromVolume,Volume}=await import('memfs');const {createDiskAdmissionStore}=await import('./admissions.js');
 const fs=createFsFromVolume(Volume.fromJSON({'/ledger':null})).promises;await fs.chmod('/ledger',0o700);
 const store=createDiskAdmissionStore({root:'/ledger',fs:fs as never,ownerId:(await fs.lstat('/ledger')).uid,maxRecordBytes:16384});
 const grant:import('./wire.generated.js').Grant={grantId:'host-issued',namespaceId:'work',root:'/',operations:['stat'],maxBytes:'64',maxOperations:4,expiresAt:new Date(100000).toISOString()};
 const f=fixture({grants:[grant]});const s=await f.open();
 f.admissions.inspect.mockImplementation(async(id?:string)=>await store.inspect(id!) as never);
 let admitted!:()=>void;const callbackAdmission=new Promise<void>(resolve=>{admitted=resolve;});
 f.admissions.record.mockImplementation(async(value?:import('./admissions.js').AdmissionRecord)=>{await store.record(value!);if(value?.kind==='callback')admitted();});
 let started!:()=>void;const launched=new Promise<void>(resolve=>{started=resolve;});f.start.mockImplementation(()=>{started();return f.process;});
 const job=await(await f.fetch(`sessions/${s.sessionId}/jobs`,'POST',{...invocation(),grants:[grant]},s.epoch)).json();await launched;
 const pending=f.prepare.mock.calls[0][0].hooks.request('host-issued',{op:'stat',path:'/x'});void pending.catch(()=>{});await callbackAdmission;
 const callback=f.admissions.record.mock.calls.map(([value])=>value as import('./admissions.js').AdmissionRecord|undefined).find(value=>value?.kind==='callback')!;
 const lane=await(await f.fetch(`sessions/${s.sessionId}/jobs/${job.jobId}/lanes`,'POST',{direction:'output',consumerId:'owner'},s.epoch,'lane')).json();
 const response=await f.fetch(`sessions/${s.sessionId}/jobs/${job.jobId}/lanes/${lane.laneId}/frames`,'GET',undefined,s.epoch);
 const {decodeFrames}=await import('./binary.js');const {validateWire}=await import('./wire-validation.js');
 const frames=decodeFrames(response.body!,{maxFrameBytes:4096,maxControlBytes:4096,channels:[2,3],validateControl:value=>validateWire('Control',value)});
 for await(const frame of frames){const value=JSON.parse(new TextDecoder().decode(frame.payload));if(value.type==='Callback')break;}
 await f.server.close();
 await expect(pending).rejects.toMatchObject({status:410});
 const deadline=Date.parse(job.retainedUntil);
 await store.sweep!(deadline-1);expect(await store.inspect(callback.operationId)).toMatchObject({kind:'callback',retainedUntil:deadline});
 await store.sweep!(deadline);expect(await store.inspect(callback.operationId)).toBeNull();expect(await fs.readdir('/ledger')).toEqual([]);
});

it('refuses an impossible callback result before recording settlement and permits a corrected answer',async()=>{
 const grant={grantId:'host-issued',namespaceId:'work',root:'/',operations:['stat' as const],maxBytes:'64',maxOperations:4,expiresAt:new Date(100000).toISOString()};
 const f=fixture({grants:[grant]});const s=await f.open();
 f.prepare.mockImplementationOnce(async input=>{await input.hooks.request('host-issued',{op:'stat',path:'/x'});return {start:f.start,close:f.close};});
 const job=await(await f.fetch(`sessions/${s.sessionId}/jobs`,'POST',{...invocation(),grants:[grant]},s.epoch)).json();
 const lane=await(await f.fetch(`sessions/${s.sessionId}/jobs/${job.jobId}/lanes`,'POST',{direction:'output',consumerId:'owner'},s.epoch,'lane')).json();
 const response=await f.fetch(`sessions/${s.sessionId}/jobs/${job.jobId}/lanes/${lane.laneId}/frames`,'GET',undefined,s.epoch);
 const {decodeFrames}=await import('./binary.js');const {validateWire}=await import('./wire-validation.js');const frames=decodeFrames(response.body!,{maxFrameBytes:4096,maxControlBytes:4096,channels:[2,3],validateControl:value=>validateWire('Control',value)});
 await frames.next();const callback=JSON.parse(new TextDecoder().decode((await frames.next()).value!.payload));
 const path=`sessions/${s.sessionId}/jobs/${job.jobId}/callbacks/${callback.callbackId}/result`;
 const answer={type:'CallbackResult',callbackId:callback.callbackId,operationId:callback.operationId,state:'applied',acknowledgedBytes:'999'};
 const invalid=await f.fetch(path,'POST',answer,s.epoch,'invalid');
 const effects=await(await f.fetch(`sessions/${s.sessionId}/jobs/${job.jobId}/effects`,'GET',undefined,s.epoch)).json();
 const corrected=await f.fetch(path,'POST',{...answer,state:'failed',acknowledgedBytes:undefined,error:{category:'filesystem',code:'ENOENT',message:'not found',phase:'notAccepted'}},s.epoch,'corrected');
 await frames.return();f.finish();await f.fetch(`sessions/${s.sessionId}`,'DELETE',undefined,s.epoch,'close');
 expect(invalid.status).toBe(400);expect(effects.effects[0].state).toBe('requested');expect(corrected.status).toBe(200);
});
it('rejects malformed cwd/env and runtime environment conflicts before preparation',async()=>{
 const f=fixture();const s=await f.open();
 for(const changes of [{cwd:'relative'},{cwd:'/bad\0'},{cwd:'/\ud800'},{env:{'':'value'}},{env:{'a=b':'value'}},{env:{KEY:'\ud800'}},{env:{KEY:'bad\0'}}]){
  expect((await f.fetch(`sessions/${s.sessionId}/jobs`,'POST',{...invocation(),...changes},s.epoch,crypto.randomUUID())).status).toBe(400);
 }
 expect(f.prepare).not.toHaveBeenCalled();
});

it('rejects a conflicting declared runtime variable before preparation',async()=>{
 const f=fixture();const s=await f.open();
 expect((await f.fetch(`sessions/${s.sessionId}/jobs`,'POST',{...invocation(),env:{FIXED:'other'}},s.epoch)).status).toBe(409);expect(f.prepare).not.toHaveBeenCalled();
});

it('rejects an absent required runtime variable before preparation',async()=>{
 const f=fixture();const s=await f.open();
 expect((await f.fetch(`sessions/${s.sessionId}/jobs`,'POST',{...invocation(),env:{}},s.epoch)).status).toBe(409);
 expect(f.prepare).not.toHaveBeenCalled();
 await f.server.close();
});

it('rejects descriptor and stdin handle authority mismatches before preparation',async()=>{
 const grant:import('./wire.generated.js').Grant={grantId:'g',namespaceId:'work',root:'/',handleId:'h',operations:['read','stat'],maxBytes:'64',maxOperations:4,expiresAt:new Date(100000).toISOString()};
 const f=fixture({grants:[grant],features:['descriptors','seekable-stdin']});const s=await f.open();
 for(const changes of [
  {descriptors:[{fd:3,handleId:'other',openDescriptionId:'o',grantId:'g',rights:['read'],seekable:false}]},
  {descriptors:[{fd:3,handleId:'h',openDescriptionId:'o',grantId:'g',rights:['write'],seekable:false}]},
  {stdin:{kind:'handle',handleId:'other',grantId:'g',position:'0',seekable:false}},
 ])expect((await f.fetch(`sessions/${s.sessionId}/jobs`,'POST',{...invocation(),grants:[grant],...changes},s.epoch,crypto.randomUUID())).status).toBe(403);
 expect(f.prepare).not.toHaveBeenCalled();
});

it('retires invocation-owned file handles and refuses new handles after terminal settlement',async()=>{
 const close=vi.fn(async()=>{});const f=fixture({files:{async open(){return{async stat(){return{size:0n,type:'file' as const};},async read(){return new Uint8Array();},close};},async list(){return[];}}});const s=await f.open();
 const job=await(await f.fetch(`sessions/${s.sessionId}/jobs`,'POST',invocation(),s.epoch)).json();
 const input={namespaceId:'work',grantId:'host-issued',path:'/x',jobId:job.jobId};
 const handle=await(await f.fetch(`sessions/${s.sessionId}/file-handles`,'POST',input,s.epoch,'handle')).json();expect(handle.handleId).toBeTruthy();
 await vi.waitFor(()=>expect(f.start).toHaveBeenCalled());await f.start.mock.calls[0][0].end(2);await f.start.mock.calls[0][0].end(3);f.finish();
 await f.fetch(`sessions/${s.sessionId}/jobs/${job.jobId}/wait`,'GET',undefined,s.epoch);
 expect(close).toHaveBeenCalledTimes(1);expect((await f.fetch(`sessions/${s.sessionId}/file-handles`,'POST',input,s.epoch,'late')).status).toBe(410);
});

it('retains journaled materialization effects when the backend returns an empty effects array',async()=>{
 const f=fixture({materialize:async({operationId,request,hooks})=>{await hooks.effect({operationId:'write-1',namespaceId:'work',operation:'write',state:'applied',path:'/x'});return{operationId,namespaceId:request.namespaceId,root:request.root,state:'complete',revision:'1',effects:[]};}});const s=await f.open();
 const receipt=await(await f.fetch(`sessions/${s.sessionId}/manifests`,'POST',{version:1,capture:'observed-traversal',entries:[]},s.epoch,'manifest')).json();
 const op=await(await f.fetch(`sessions/${s.sessionId}/materializations`,'POST',{manifestId:receipt.manifestId,namespaceId:'work',root:'/',expectedRevision:null,conflictPolicy:'refuse',grantId:'host-issued'},s.epoch,'apply')).json();
 await vi.waitFor(async()=>{const status=await(await f.fetch(`sessions/${s.sessionId}/materializations/${op.operationId}`,'GET',undefined,s.epoch)).json();expect(status.state).toBe('complete');expect(status.effects).toEqual([expect.objectContaining({operationId:'write-1',sequence:'1',state:'applied'})]);});
});

it.each(['missing','wrong-root','wrong-revision','other-session'])('refuses %s materialization binding before job admission',async mismatch=>{
 const f=fixture({materialize:async({operationId,request})=>({operationId,namespaceId:request.namespaceId,root:request.root,state:'complete',revision:'1',effects:[]})});
 const s=await f.open();
 const manifest=await(await f.fetch(`sessions/${s.sessionId}/manifests`,'POST',{version:1,capture:'observed-traversal',entries:[]},s.epoch,'manifest')).json();
 const op=await(await f.fetch(`sessions/${s.sessionId}/materializations`,'POST',{manifestId:manifest.manifestId,namespaceId:'work',root:'/',expectedRevision:null,conflictPolicy:'refuse',grantId:'host-issued'},s.epoch,'apply')).json();
 await vi.waitFor(async()=>expect((await(await f.fetch(`sessions/${s.sessionId}/materializations/${op.operationId}`,'GET',undefined,s.epoch)).json()).state).toBe('complete'));
 const other=mismatch==='other-session'?await(await f.fetch('sessions','POST',request,undefined,'other-session')).json():s;
 const data={...invocation(),materializationRevision:mismatch==='wrong-revision'?'0':'1',materializationBinding:{operationId:mismatch==='missing'?'absent':op.operationId,root:mismatch==='wrong-root'?'/other':'/'}};
 const before=f.admissions.record.mock.calls.length;
 const response=await f.fetch(`sessions/${other.sessionId}/jobs`,'POST',data,other.epoch,'bound-job');
 expect(response.status).toBe(409);expect(f.prepare).not.toHaveBeenCalled();expect(f.admissions.record.mock.calls.length).toBe(before);
});
it('holds the prepared revision through native namespace installation',async()=>{
 const materialize=vi.fn(async({operationId,request}:Parameters<NonNullable<import('./media-server.js').SessionAuthority['materialize']>>[0])=>({operationId,namespaceId:request.namespaceId,root:request.root,state:'complete' as const,revision:String(materialize.mock.calls.length),effects:[]}));
 const f=fixture({materialize});const s=await f.open();
 const manifest=await(await f.fetch(`sessions/${s.sessionId}/manifests`,'POST',{version:1,capture:'observed-traversal',entries:[]},s.epoch,'manifest')).json();
 const apply={manifestId:manifest.manifestId,namespaceId:'work',root:'/',expectedRevision:null,conflictPolicy:'refuse',grantId:'host-issued'};
 const op=await(await f.fetch(`sessions/${s.sessionId}/materializations`,'POST',apply,s.epoch,'apply')).json();
 await vi.waitFor(async()=>expect((await(await f.fetch(`sessions/${s.sessionId}/materializations/${op.operationId}`,'GET',undefined,s.epoch)).json()).state).toBe('complete'));
 let install!:()=>void;const installed=new Promise<void>(r=>{install=r;});
 f.prepare.mockImplementation(async()=>{await installed;return{start:f.start,close:f.close};});
 const job=await f.fetch(`sessions/${s.sessionId}/jobs`,'POST',{...invocation(),materializationRevision:'1',materializationBinding:{operationId:op.operationId,root:'/'}},s.epoch,'bound-job');expect(job.status).toBe(200);
 await vi.waitFor(()=>expect(f.prepare).toHaveBeenCalledOnce());
 const next=await f.fetch(`sessions/${s.sessionId}/materializations`,'POST',{...apply,expectedRevision:'1'},s.epoch,'next');expect(next.status).toBe(200);
 expect(materialize).toHaveBeenCalledOnce();install();
 await vi.waitFor(()=>expect(materialize).toHaveBeenCalledTimes(2));
 const stale=await f.fetch(`sessions/${s.sessionId}/jobs`,'POST',{...invocation(),materializationRevision:'1',materializationBinding:{operationId:op.operationId,root:'/'}},s.epoch,'stale');expect(stale.status).toBe(409);
 f.finish();
});

it('publishes completed materialization only after its admitted effect barrier',async()=>{
 let settle!:()=>void;const settled=new Promise<void>(resolve=>{settle=resolve;});
 const f=fixture({materialize:async({operationId,request,hooks})=>{
  void hooks.effect({operationId:'write-before-completion',namespaceId:'work',operation:'write',state:'applied',path:'/x'}).catch(()=>{});
  return{operationId,namespaceId:request.namespaceId,root:request.root,state:'complete',revision:'1',effects:[]};
 }});const s=await f.open();
 f.admissions.record.mockImplementation(async(record)=>{if(record.kind==='effect-receipt')await settled;});
 const manifest=await(await f.fetch(`sessions/${s.sessionId}/manifests`,'POST',{version:1,capture:'observed-traversal',entries:[]},s.epoch,'manifest')).json();
 const op=await(await f.fetch(`sessions/${s.sessionId}/materializations`,'POST',{manifestId:manifest.manifestId,namespaceId:'work',root:'/',expectedRevision:null,conflictPolicy:'refuse',grantId:'host-issued'},s.epoch,'apply')).json();
 await vi.waitFor(()=>expect(f.admissions.record.mock.calls.some(([record])=>record.kind==='effect-receipt')).toBe(true));
 try{expect((await(await f.fetch(`sessions/${s.sessionId}/materializations/${op.operationId}`,'GET',undefined,s.epoch)).json()).state).toBe('applying');}finally{settle();}
 await vi.waitFor(async()=>expect((await(await f.fetch(`sessions/${s.sessionId}/materializations/${op.operationId}`,'GET',undefined,s.epoch)).json()).state).toBe('complete'));
});

it('releases installation readiness when namespace preparation throws synchronously',async()=>{
 const materialize=vi.fn(async({operationId,request}:Parameters<NonNullable<import('./media-server.js').SessionAuthority['materialize']>>[0])=>({operationId,namespaceId:request.namespaceId,root:request.root,state:'complete' as const,revision:String(materialize.mock.calls.length),effects:[]}));
 const f=fixture({materialize});const s=await f.open();
 const manifest=await(await f.fetch(`sessions/${s.sessionId}/manifests`,'POST',{version:1,capture:'observed-traversal',entries:[]},s.epoch,'manifest')).json();
 const apply={manifestId:manifest.manifestId,namespaceId:'work',root:'/',expectedRevision:null,conflictPolicy:'refuse',grantId:'host-issued'};
 const op=await(await f.fetch(`sessions/${s.sessionId}/materializations`,'POST',apply,s.epoch,'apply')).json();
 await vi.waitFor(async()=>expect((await(await f.fetch(`sessions/${s.sessionId}/materializations/${op.operationId}`,'GET',undefined,s.epoch)).json()).state).toBe('complete'));
 f.prepare.mockImplementation(()=>{throw new Error('Installation failed');});
 const response=await f.fetch(`sessions/${s.sessionId}/jobs`,'POST',{...invocation(),materializationRevision:'1',materializationBinding:{operationId:op.operationId,root:'/'}},s.epoch,'bound-job');expect(response.status).toBe(200);const job=await response.json();
 await f.fetch(`sessions/${s.sessionId}/jobs/${job.jobId}/wait`,'GET',undefined,s.epoch);
 const next=await f.fetch(`sessions/${s.sessionId}/materializations`,'POST',{...apply,expectedRevision:'1'},s.epoch,'next');expect(next.status).toBe(200);
 await vi.waitFor(()=>expect(materialize).toHaveBeenCalledTimes(2),{timeout:100,interval:1});expect(f.start).not.toHaveBeenCalled();
});

it('admits byte paths and detects aliases across text and byte manifest entries',async()=>{
 const f=fixture();const s=await f.open();
 const manifest={version:1,capture:'observed-traversal',entries:[{type:'directory',pathBytes:[255]}]};
 const response=await f.fetch(`sessions/${s.sessionId}/manifests`,'POST',manifest,s.epoch,'bytes');expect(response.status).toBe(200);
 const receipt=await response.json();
 expect(await(await f.fetch(`sessions/${s.sessionId}/manifests/${receipt.manifestId}`,'GET',undefined,s.epoch)).json()).toEqual(manifest);
 for(const [key,entries] of Object.entries({alias:[{type:'directory',path:'a'},{type:'directory',pathBytes:[97]}],parent:[{type:'directory',pathBytes:[46,46,47,255]}],unordered:[{type:'directory',pathBytes:[255]},{type:'directory',path:'a'}],unicode:[{type:'directory',path:'\ud800'}]})){
  const result=await f.fetch(`sessions/${s.sessionId}/manifests`,'POST',{...manifest,entries},s.epoch,key);expect(result.status).toBe(key==='alias'?409:400);
 }
});

it('renews staged upload authority along with the session lease',async()=>{
 const f=fixture();const s=await f.open();
 const upload=await(await f.fetch(`sessions/${s.sessionId}/uploads`,'POST',{size:'0',digest:'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'},s.epoch,'upload')).json();expect(upload.uploadId).toBeTruthy();
 f.setNow(9000);expect((await f.fetch(`sessions/${s.sessionId}/lease`,'POST',{leaseMs:10000},s.epoch,'renew')).status).toBe(200);f.setNow(12000);
 expect((await f.fetch(`sessions/${s.sessionId}/uploads/${upload.uploadId}`,'GET',undefined,s.epoch)).status).toBe(200);
});

it('refuses unknown blob stdin before native preparation',async()=>{
 const f=fixture({features:['seekable-stdin']});const s=await f.open();
 expect((await f.fetch(`sessions/${s.sessionId}/jobs`,'POST',{...invocation(),stdin:{kind:'blob',blobId:'missing',seekable:true}},s.epoch)).status).toBe(404);expect(f.prepare).not.toHaveBeenCalled();
});
it('supplies a bounded invocation-owned blob lease instead of a wire id as a native fd',async()=>{
 const f=fixture({features:['seekable-stdin']});const s=await f.open();
 const upload=await(await f.fetch(`sessions/${s.sessionId}/uploads`,'POST',{size:'0',digest:'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'},s.epoch,'upload')).json();
 const blob=await(await f.fetch(`sessions/${s.sessionId}/uploads/${upload.uploadId}/commit`,'POST',undefined,s.epoch,'commit')).json();expect(blob.blobId).toBeTruthy();
 const other=await(await f.fetch('sessions','POST',request,undefined,'other-session')).json();
 expect((await f.fetch(`sessions/${other.sessionId}/jobs`,'POST',{...invocation(),stdin:{kind:'blob',blobId:blob.blobId,seekable:true}},other.epoch,'wrong-session')).status).toBe(404);expect(f.prepare).not.toHaveBeenCalled();
 const job=await(await f.fetch(`sessions/${s.sessionId}/jobs`,'POST',{...invocation(),stdin:{kind:'blob',blobId:blob.blobId,seekable:true}},s.epoch,'job')).json();await vi.waitFor(()=>expect(f.prepare).toHaveBeenCalled());
 const lease=f.prepare.mock.calls[0][0].stdinBlob;expect(lease?.size).toBe(0n);expect(await lease!.read(0n,1,new AbortController().signal)).toEqual(new Uint8Array());await expect(lease!.read(0n,4097,new AbortController().signal)).rejects.toThrow();f.finish();
 await f.fetch(`sessions/${s.sessionId}/jobs/${job.jobId}/wait`,'GET',undefined,s.epoch);
  await expect(lease!.read(0n,1,new AbortController().signal)).rejects.toThrow();
});
it('owns native stdin blob ranges before storage producer reuse', async () => {
  const { createHash } = await import('node:crypto');
  const { createUploadClient } = await import('./uploads.js');
  const data = new Uint8Array([7, 8]); const producer = Buffer.alloc(2);
  const f = fixture({ features: ['seekable-stdin'], storage: { async append() {}, async remove() {}, async read(_id, position, count) { const part = data.subarray(Number(position), Number(position) + count); producer.set(part); return producer.subarray(0, part.length); } } });
  const s = await f.open();
  const client = createUploadClient({ baseUrl: 'https://media.test', sessionId: s.sessionId, epoch: s.epoch, token: () => 'one', maxChunkBytes: 2, fetch: async (url, init) => f.server.fetch(new Request(url, init)) });
  const upload = await client.beginUpload({ size: '2', digest: createHash('sha256').update(data).digest('hex') });
  await client.uploadChunk(upload.uploadId, '0', data); const blob = await client.commitUpload(upload.uploadId);
  await f.fetch(`sessions/${s.sessionId}/jobs`, 'POST', { ...invocation(), stdin: { kind: 'blob', blobId: blob.blobId, seekable: true } }, s.epoch, 'blob-reuse');
  await vi.waitFor(() => expect(f.prepare).toHaveBeenCalled());
  const lease = f.prepare.mock.calls[0][0].stdinBlob!;
  try {
    const first = await lease.read(0n, 1, new AbortController().signal);
    const second = await lease.read(1n, 1, new AbortController().signal);
    expect(Array.from(first)).toEqual([7]); expect(Array.from(second)).toEqual([8]);
  } finally { f.finish(); }
});

it('reclaims expired materializations and their journals with session cleanup',async()=>{
 const f=fixture({maxRecords:3,materialize:async({operationId,request})=>({operationId,namespaceId:request.namespaceId,root:request.root,state:'complete',revision:'1',effects:[]})});
 for(let generation=0;generation<4;generation++){
  const s=await f.open();const receipt=await(await f.fetch(`sessions/${s.sessionId}/manifests`,'POST',{version:1,capture:'observed-traversal',entries:[]},s.epoch,'manifest')).json();
  const response=await f.fetch(`sessions/${s.sessionId}/materializations`,'POST',{manifestId:receipt.manifestId,namespaceId:'work',root:'/',expectedRevision:null,conflictPolicy:'refuse',grantId:'host-issued'},s.epoch,'apply');expect(response.status).toBe(200);
  f.setNow(32000+generation*31000);await f.server.sweep();
 }
});

it('refuses a signal when no native process exists instead of silently dropping it',async()=>{
 const f=fixture();const s=await f.open();let release!:()=>void;f.prepare.mockImplementationOnce(async()=>{await new Promise<void>(resolve=>{release=resolve;});return{start:f.start,close:f.close};});
 const job=await(await f.fetch(`sessions/${s.sessionId}/jobs`,'POST',invocation(),s.epoch)).json();
 expect((await f.fetch(`sessions/${s.sessionId}/jobs/${job.jobId}/signal`,'POST',{signal:'SIGTERM'},s.epoch,'signal')).status).toBe(409);expect(f.process.signal).not.toHaveBeenCalled();release();f.finish();
});

it('linearizes observed exit before cancellation without signaling an exited process',async()=>{
 const f=fixture();const s=await f.open();const job=await(await f.fetch(`sessions/${s.sessionId}/jobs`,'POST',invocation(),s.epoch)).json();
 await vi.waitFor(()=>expect(f.start).toHaveBeenCalled());f.exit();
 await f.fetch(`sessions/${s.sessionId}/jobs/${job.jobId}`,'GET',undefined,s.epoch);
 const result=await(await f.fetch(`sessions/${s.sessionId}/jobs/${job.jobId}/cancel`,'POST',{reason:'late'},s.epoch,'cancel')).json();
 expect(result.cancelRequested).toBe(true);expect(f.process.signal).not.toHaveBeenCalled();f.settle();
});

it('interrupts a polling wait without changing the native deadline or canceling execution',async()=>{
 const f=fixture();const s=await f.open();const job=await(await f.fetch(`sessions/${s.sessionId}/jobs`,'POST',invocation(),s.epoch)).json();
 const controller=new AbortController();
 const wait=f.server.fetch(new Request(`https://media.test/v1/sessions/${s.sessionId}/jobs/${job.jobId}/wait`,{signal:controller.signal,headers:{Authorization:'Bearer one','Execution-Protocol':'1','Execution-Epoch':s.epoch}}));
 await Promise.resolve();controller.abort(new Error('poll interrupted'));
 // A hosting adapter may observe abort before the server installs its wait.
 // Both a rejected transport and an interrupted server reply must settle.
 const interrupted=await Promise.race([wait.then(()=>true,error=>{expect(error.message).toBe('poll interrupted');return true;}),Promise.resolve().then(()=>Promise.resolve()).then(()=>Promise.resolve()).then(()=>false)]);
 expect(interrupted).toBe(true);expect(f.process.signal).not.toHaveBeenCalled();f.finish();
});

it.each([
 {kind:'unknown',reason:'Missing native exit observation'},
 {kind:'spawnError',code:'ENOENT',stage:'spawn',message:'Launch unavailable'},
 {kind:'canceled',terminationConfirmed:false},
 {kind:'executionError',error:{category:'transport',code:'unavailable',message:'Provider unavailable',phase:'unknown'}},
] satisfies import('./wire.generated.js').Outcome[])('keeps unavailable native observations outside process-exited and io-settled: %j', async outcome => {
 const f=fixture();
 let started!: () => void;const ready=new Promise<void>(resolve=>{started=resolve;});
 f.start.mockImplementation(()=>{started();return f.process;});
 const s=await f.open();const job=await(await f.fetch(`sessions/${s.sessionId}/jobs`,'POST',invocation(),s.epoch)).json();
 await ready;
 await f.start.mock.calls[0][0].end(2);await f.start.mock.calls[0][0].end(3);
 f.observeExit(outcome);f.settle();
 const final=await(await f.fetch(`sessions/${s.sessionId}/jobs/${job.jobId}/wait`,'GET',undefined,s.epoch)).json();
 const events=f.admissions.record.mock.calls.map(call=>(call as unknown as [import('./admissions.js').AdmissionRecord])[0].jobState).filter(Boolean);
 expect(events.map(event=>event!.stage)).toEqual(['accepted','running','unknown-outcome']);
 expect(final).toMatchObject({outputComplete:false,outcome:{kind:'unknown'},jobState:{stage:'unknown-outcome'}});
 expect(final.processOutcome).toBeUndefined();
 expect(final.jobState.processOutcome).toBeUndefined();
 const retry=await f.fetch(`sessions/${s.sessionId}/jobs`,'POST',invocation(),s.epoch);
 expect(retry.status).toBe(200);
 expect(await retry.json()).toMatchObject({jobId:job.jobId,outputComplete:false,jobState:{stage:'unknown-outcome'}});
 const {createClient}=await import('./client.js');
 const client=createClient({baseUrl:'https://media.test',token:async()=> 'one',fetch:async(url,init)=>f.server.fetch(new Request(url,init))});
 expect(await client.inspectJob(s,job.jobId)).toMatchObject({jobId:job.jobId,outcome:{kind:'unknown'},outputComplete:false,jobState:{stage:'unknown-outcome'}});
 expect(f.start).toHaveBeenCalledTimes(1);
});

it('persists accepted, running, process-exited and io-settled observations in order',async()=>{
 const f=fixture();const s=await f.open();const job=await(await f.fetch(`sessions/${s.sessionId}/jobs`,'POST',invocation(),s.epoch)).json();
 expect(job.invocationId).toBe('key');expect(job.jobState).toMatchObject({version:1,sequence:'1',stage:'accepted'});
 await vi.waitFor(()=>expect(f.start).toHaveBeenCalled());f.exit();
 await f.start.mock.calls[0][0].end(2);await f.start.mock.calls[0][0].end(3);f.settle();
 const final=await(await f.fetch(`sessions/${s.sessionId}/jobs/${job.jobId}/wait`,'GET',undefined,s.epoch)).json();
 const events=f.admissions.record.mock.calls.map(call=>(call as unknown as [import('./admissions.js').AdmissionRecord])[0].jobState).filter(Boolean);
 expect(events.map(event=>event!.stage)).toEqual(['accepted','running','process-exited','io-settled']);
 expect(final.jobState).toMatchObject({sequence:'4',stage:'io-settled',processOutcome:{kind:'exited',exitCode:1}});
});

it.each(['buffered', 'blocked', 'unread'] as const)('expires an attached %s job stream independently of a renewed session and polling', async schedule => {
 vi.useFakeTimers();
 try {
  const f=fixture({config:{leaseMs:1000,retentionMs:1000}});const s=await f.open();
  const job=await(await f.fetch(`sessions/${s.sessionId}/jobs`,'POST',invocation(),s.epoch,'invocation')).json();
  await vi.advanceTimersByTimeAsync(0);
  const lane=await(await f.fetch(`sessions/${s.sessionId}/jobs/${job.jobId}/lanes`,'POST',{direction:'output',consumerId:'sink'},s.epoch,'lane')).json();
  // Consume the initial state so the blocked schedule waits for new frames.
  const initial=await f.fetch(`sessions/${s.sessionId}/jobs/${job.jobId}/lanes/${lane.laneId}/frames`,'GET',undefined,s.epoch);
  const initialReader=initial.body!.getReader();await initialReader.read();await initialReader.cancel();
  const response=await f.server.fetch(new Request(`https://media.test/v1/sessions/${s.sessionId}/jobs/${job.jobId}/lanes/${lane.laneId}/frames`,{headers:{Authorization:'Bearer one','Execution-Protocol':'1','Execution-Epoch':s.epoch,'Execution-Cursor':'2'}}));
  const reader=response.body!.getReader();
  if(schedule==='buffered')await f.start.mock.calls[0][0].output(2,Uint8Array.of(7));
  let observed:unknown;
  if(schedule==='blocked')void reader.read().then(value=>{observed={value};},error=>{observed={error};});
  for(const time of [1500,2200,2900]){
   f.setNow(time);expect((await f.fetch(`sessions/${s.sessionId}/lease`,'POST',{leaseMs:1000},s.epoch,'renew:'+time)).status).toBe(200);
  }
  f.setNow(3001);
  // The stream's original deadline survives session renewal; no sweep or poll.
  await vi.advanceTimersByTimeAsync(2001);
  try {
   if(schedule==='blocked')expect(observed).toMatchObject({error:{status:410}});
   else await expect(reader.read()).rejects.toMatchObject({status:410});
   expect(f.start).toHaveBeenCalledTimes(1);
  } finally {f.finish();await reader.cancel().catch(()=>{});}
 } finally {vi.useRealTimers();}
});

it('refuses relaunch when acceptance survives but the HTTP admission response is lost before local binding',async()=>{
 const f=fixture();const s=await f.open();const records=new Map<string,import('./admissions.js').AdmissionRecord>();
 f.admissions.inspect.mockImplementation(async(id?:string)=>records.get(id!) as never??null);
 f.admissions.record.mockImplementation(async(value?:import('./admissions.js').AdmissionRecord)=>{records.set(value!.operationId,structuredClone(value!));if(value!.kind==='job')throw new Error('lost acceptance completion');});
 expect((await f.fetch(`sessions/${s.sessionId}/jobs`,'POST',invocation(),s.epoch)).status).toBe(503);
 f.admissions.record.mockImplementation(async()=>{});
 expect((await f.fetch(`sessions/${s.sessionId}/jobs`,'POST',invocation(),s.epoch)).status).toBe(410);expect(f.start).not.toHaveBeenCalled();
});

it('records effect settlement receipts before returning a canonical callback result',async()=>{
 const grant:import('./wire.generated.js').Grant={grantId:'host-issued',namespaceId:'work',root:'/',operations:['write'],maxBytes:'64',maxOperations:4,expiresAt:new Date(100000).toISOString()};
 const f=fixture({grants:[grant]});const s=await f.open();await f.fetch(`sessions/${s.sessionId}/jobs`,'POST',{...invocation(),grants:[grant]},s.epoch);
 await vi.waitFor(()=>expect(f.start).toHaveBeenCalled());
 await f.prepare.mock.calls[0][0].hooks.effect({operationId:'write1',namespaceId:'work',operation:'write',state:'applied',acknowledgedBytes:'3'});
 expect(f.admissions.record.mock.calls.some(call=>(call as unknown as [import('./admissions.js').AdmissionRecord])[0].effectReceipt?.state==='applied')).toBe(true);f.finish();
});

it.each(['before acceptance','after acceptance before reply'])('recovers a disconnected create %s with the same identity',async phase=>{
 const f=fixture();const s=await f.open();const {createClient}=await import('./client.js');let dropped=false;
 const client=createClient({baseUrl:'https://media.test',token:async()=> 'one',fetch:async(url,init)=>{
  if(!dropped){dropped=true;if(phase==='after acceptance before reply')await f.server.fetch(new Request(url,init));throw new Error('disconnected');}
  return f.server.fetch(new Request(url,init));
 }});
 await expect(client.submitJob(s,invocation(),'client-invocation')).rejects.toMatchObject({category:'transport',phase:'unknown',recovery:{operationKey:'client-invocation'}});
 const recovered=await client.submitJob(s,invocation(),'client-invocation');expect(recovered.invocationId).toBe('client-invocation');
 await vi.waitFor(()=>expect(f.start).toHaveBeenCalledTimes(1));f.finish();
});

it.each(['admission','accepted-state'] as const)('retains native ownership when the create transport disconnects during durable %s',async stage=>{
 const f=fixture();const s=await f.open();
 const controller=new AbortController();
 let enter!:()=>void;let release!:()=>void;let launched!:()=>void;
 const entered=new Promise<void>(resolve=>{enter=resolve;});
 const barrier=new Promise<void>(resolve=>{release=resolve;});
 const started=new Promise<void>(resolve=>{launched=resolve;});
 const records=new Map<string,import('./admissions.js').AdmissionRecord>();
 f.admissions.inspect.mockImplementation(async(id?:string)=>structuredClone(records.get(id!)??null) as never);
 f.admissions.record.mockImplementation(async(value?:import('./admissions.js').AdmissionRecord)=>{
  records.set(value!.operationId,structuredClone(value!));
  if(stage==='admission'&&value?.kind==='job'||stage==='accepted-state'&&value?.jobState?.stage==='accepted'){enter();await barrier;}
 });
 f.start.mockImplementation(()=>{launched();return f.process;});
 const creating=f.server.fetch(new Request(`https://media.test/v1/sessions/${s.sessionId}/jobs`,{
  method:'POST',signal:controller.signal,
  headers:{Authorization:'Bearer one','Execution-Protocol':'1','Execution-Epoch':s.epoch,'Content-Type':'application/json','Idempotency-Key':'acceptance-disconnect'},
  body:JSON.stringify(invocation()),
 })).catch(()=>undefined);
 await entered;controller.abort(new Error('create transport disconnected'));release();
 // The transport result is deliberately discarded. Durable acceptance belongs
 // to the invocation, independently of the request carrying its lost reply.
 await creating;
 try{
  // Container transport cancellation can finish before server admission. Join
  // the independently owned native launch, rather than treating that reply as
  // a server completion barrier or using a timed polling wait.
  await started;
  const retry=await f.fetch(`sessions/${s.sessionId}/jobs`,'POST',invocation(),s.epoch,'acceptance-disconnect');
  expect(retry.status).toBe(200);
  const attached=await retry.json();
  expect(attached.invocationId).toBe('acceptance-disconnect');
  expect(f.start).toHaveBeenCalledOnce();
  expect([...records.values()].filter(record=>record.jobState?.stage==='accepted')).toHaveLength(1);
  const conflict=await f.fetch(`sessions/${s.sessionId}/jobs`,'POST',{...invocation(),args:[[120]]},s.epoch,'acceptance-disconnect');
  expect(conflict.status).toBe(409);
 }finally{f.finish();}
});

it('never writes a truncated input chunk and resumes its intact retry without altering bytes',async()=>{
 const f=fixture();const s=await f.open();const job=await(await f.fetch(`sessions/${s.sessionId}/jobs`,'POST',invocation(),s.epoch)).json();await vi.waitFor(()=>expect(f.start).toHaveBeenCalled());
 const lane=await(await f.fetch(`sessions/${s.sessionId}/jobs/${job.jobId}/lanes`,'POST',{direction:'input',consumerId:'owner'},s.epoch,'lane')).json();
 const {encodeFrame,binaryContentType}=await import('./binary.js');const wire=encodeFrame({kind:'data',channelId:1,sequence:1n,offset:0n,correlationId:0n,payload:new Uint8Array([0,255,128,7])},{maxFrameBytes:4096,maxControlBytes:4096,channels:[1]});
 const send=(body:Uint8Array)=>f.server.fetch(new Request(`https://media.test/v1/sessions/${s.sessionId}/jobs/${job.jobId}/lanes/${lane.laneId}/frames`,{method:'POST',headers:{Authorization:'Bearer one','Execution-Protocol':'1','Execution-Epoch':s.epoch,'Content-Type':binaryContentType,'Execution-Cursor':'1'},body}));
 expect((await send(wire.slice(0,42))).status).toBe(400);expect(f.process.write).not.toHaveBeenCalled();
 expect((await send(wire)).status).toBe(200);expect(f.process.write).toHaveBeenCalledExactlyOnceWith(1,new Uint8Array([0,255,128,7]));f.finish();
});

it('recovers an invalid input receipt by attaching and replaying intact frames without repeating native writes',async()=>{
 const f=fixture();const s=await f.open();
 let launched!:()=>void;const started=new Promise<void>(resolve=>{launched=resolve;});
 f.start.mockImplementation(()=>{launched();return f.process;});
 const {createClient}=await import('./client.js');let corrupt=true;
 const client=createClient({baseUrl:'https://media.test',token:async()=> 'one',fetch:async(url,init)=>{
  const response=await f.server.fetch(new Request(url,init));
  if(String(url).endsWith('/frames')&&init?.method==='POST'&&corrupt){
   corrupt=false;const receipt=await response.json();
   return Response.json({...receipt,laneId:'another-lane'},{headers:{'Execution-Epoch':s.epoch}});
  }
  return response;
 }});
 const job=await client.submitJob(s,invocation(),'input-invocation');await started;
 const lane=await client.attach(s,job.jobId,{direction:'input',consumerId:'owner'},'input-lane');
 const frames=[{kind:'data' as const,channelId:1,sequence:1n,offset:0n,correlationId:0n,payload:Uint8Array.of(0,255,128,7)}];
 const options={maxFrameBytes:4096,maxControlBytes:4096,channels:[1]};
 try{
  await expect(client.sendFrames(s,job.jobId,lane.laneId,frames,options,'input-batch')).rejects.toMatchObject({category:'transport',phase:'unknown',recovery:{jobId:job.jobId,laneId:lane.laneId}});
  expect((await client.submitJob(s,invocation(),'input-invocation')).jobId).toBe(job.jobId);
  await expect(client.sendFrames(s,job.jobId,lane.laneId,frames,options,'input-batch')).resolves.toMatchObject({sequence:'1'});
  expect(f.process.write).toHaveBeenCalledExactlyOnceWith(1,Uint8Array.of(0,255,128,7));
  expect(f.start).toHaveBeenCalledOnce();
 }finally{f.finish();}
});

it('recovers a dropped cancellation reply without acting on cancellation again',async()=>{
 const f=fixture();const s=await f.open();const job=await(await f.fetch(`sessions/${s.sessionId}/jobs`,'POST',invocation(),s.epoch)).json();await vi.waitFor(()=>expect(f.start).toHaveBeenCalled());
 const {createClient}=await import('./client.js');let drop=true;
 const client=createClient({baseUrl:'https://media.test',token:async()=> 'one',fetch:async(url,init)=>{const response=await f.server.fetch(new Request(url,init));if(drop){drop=false;throw new Error('cancel reply lost');}return response;}});
 await expect(client.cancelJob(s,job.jobId,{reason:'stop'},'cancel')).rejects.toMatchObject({category:'transport',phase:'unknown'});
 const recovered=await client.cancelJob(s,job.jobId,{reason:'stop'},'cancel');expect(recovered.cancelRequested).toBe(true);expect(f.process.signal).toHaveBeenCalledTimes(1);f.finish();
});

it('keeps exited output available through disconnect during final metadata publication',async()=>{
 const f=fixture();const s=await f.open();const job=await(await f.fetch(`sessions/${s.sessionId}/jobs`,'POST',invocation(),s.epoch)).json();await vi.waitFor(()=>expect(f.start).toHaveBeenCalled());
 await f.start.mock.calls[0][0].output(2,new Uint8Array([0,255]));await f.start.mock.calls[0][0].end(2);await f.start.mock.calls[0][0].end(3);f.finish();
 const {createClient}=await import('./client.js');let drop=true;
 const client=createClient({baseUrl:'https://media.test',token:async()=> 'one',fetch:async(url,init)=>{const response=await f.server.fetch(new Request(url,init));if(drop){drop=false;throw new Error('final reply lost');}return response;}});
 await expect(client.waitJob(s,job.jobId)).rejects.toMatchObject({category:'transport',recovery:{jobId:job.jobId}});
 const status=await client.inspectJob(s,job.jobId);expect(status.jobState?.stage).toBe('io-settled');
 const lane=await client.attach(s,job.jobId,{direction:'output',consumerId:'owner'},'out');const payload:number[]=[];
 for await(const frame of client.readFrames(s,job.jobId,lane.laneId,1n,{maxFrameBytes:4096,maxControlBytes:4096,channels:[2,3]})){if(frame.kind==='data')payload.push(...frame.payload);}
 expect(payload).toEqual([0,255]);expect(f.start).toHaveBeenCalledTimes(1);
});

it('rejects a conflicting payload when only orphaned durable acceptance remains',async()=>{
 const f=fixture();const s=await f.open();const records=new Map<string,import('./admissions.js').AdmissionRecord>();
 f.admissions.inspect.mockImplementation(async(id?:string)=>records.get(id!) as never??null);
 f.admissions.record.mockImplementation(async(value?:import('./admissions.js').AdmissionRecord)=>{records.set(value!.operationId,structuredClone(value!));throw new Error('lost completion');});
 expect((await f.fetch(`sessions/${s.sessionId}/jobs`,'POST',invocation(),s.epoch)).status).toBe(503);
 expect((await f.fetch(`sessions/${s.sessionId}/jobs`,'POST',{...invocation(),args:[[120]]},s.epoch)).status).toBe(409);expect(f.start).not.toHaveBeenCalled();
});

it.each(['during publication', 'after publication'] as const)('retires late native exit authority %s of unknown outcome', async schedule => {
 const f=fixture();const s=await f.open();
 let started!:()=>void;const running=new Promise<void>(resolve=>{started=resolve;});
 f.start.mockImplementation(()=>{started();return f.process;});
 let entered!:()=>void;let release!:()=>void;
 const publishing=new Promise<void>(resolve=>{entered=resolve;});
 const barrier=new Promise<void>(resolve=>{release=resolve;});
 f.admissions.record.mockImplementation(async value=>{
  if(value?.jobState?.stage==='unknown-outcome'){entered();await barrier;}
 });
 const job=await(await f.fetch(`sessions/${s.sessionId}/jobs`,'POST',invocation(),s.epoch,'late-exit')).json();
 await running;
 f.process.signal=vi.fn(()=>{throw new Error('Provider termination receipt lost');});
 try{
  await f.fetch(`sessions/${s.sessionId}/jobs/${job.jobId}/cancel`,'POST',{reason:'stop'},s.epoch,'late-cancel');
  await publishing;
  if(schedule==='after publication'){
   release();
   await f.fetch(`sessions/${s.sessionId}/jobs/${job.jobId}/wait`,'GET',undefined,s.epoch);
  }
  f.observeExit({kind:'exited',exitCode:0});
  await f.process.exit;
  const receipt=await(await f.fetch(`sessions/${s.sessionId}/jobs/${job.jobId}`,'GET',undefined,s.epoch)).json();
  expect(receipt.processOutcome).toBeUndefined();
  expect(receipt.outputComplete).toBe(false);
  expect(f.admissions.record.mock.calls.some(([value])=>value?.jobState?.stage==='process-exited')).toBe(false);
  release();
  const final=await(await f.fetch(`sessions/${s.sessionId}/jobs/${job.jobId}/wait`,'GET',undefined,s.epoch)).json();
  expect(final).toMatchObject({state:'terminal',outcome:{kind:'unknown'},jobState:{stage:'unknown-outcome'}});
  expect(final.processOutcome).toBeUndefined();
 }finally{release();f.finish();await f.server.close();}
});

it('does not expose terminal success while durable I/O settlement is still pending',async()=>{
 const f=fixture();const s=await f.open();let release!:()=>void;let enter!:()=>void;
 const entered=new Promise<void>(resolve=>{enter=resolve;});const barrier=new Promise<void>(resolve=>{release=resolve;});
 f.admissions.record.mockImplementation(async(value?:import('./admissions.js').AdmissionRecord)=>{if(value?.jobState?.stage==='io-settled'){enter();await barrier;}});
 const job=await(await f.fetch(`sessions/${s.sessionId}/jobs`,'POST',invocation(),s.epoch)).json();await vi.waitFor(()=>expect(f.start).toHaveBeenCalled());
 await f.start.mock.calls[0][0].end(2);await f.start.mock.calls[0][0].end(3);f.finish();await entered;
 const pending=await(await f.fetch(`sessions/${s.sessionId}/jobs/${job.jobId}`,'GET',undefined,s.epoch)).json();
 try{expect(pending.state).toBe('draining');expect(pending.outputComplete).toBe(false);expect(pending.jobState.stage).toBe('process-exited');}finally{release();}
 const final=await(await f.fetch(`sessions/${s.sessionId}/jobs/${job.jobId}/wait`,'GET',undefined,s.epoch)).json();expect(final.jobState.stage).toBe('io-settled');expect(final.state).toBe('terminal');
});

it('bounds final persistence waits independently from polling and reports unknown delivery',async()=>{
 vi.useFakeTimers();try{
  const f=fixture();const s=await f.open();let enter!:()=>void;let release!:()=>void;
  const entered=new Promise<void>(resolve=>{enter=resolve;});const barrier=new Promise<void>(resolve=>{release=resolve;});
  f.admissions.record.mockImplementation(async(value?:import('./admissions.js').AdmissionRecord)=>{if(value?.jobState?.stage==='io-settled'){enter();await barrier;}});
  const job=await(await f.fetch(`sessions/${s.sessionId}/jobs`,'POST',invocation(),s.epoch)).json();await vi.advanceTimersByTimeAsync(0);
  await f.start.mock.calls[0][0].end(2);await f.start.mock.calls[0][0].end(3);f.finish();await entered;await vi.advanceTimersByTimeAsync(5001);
  const final=await(await f.fetch(`sessions/${s.sessionId}/jobs/${job.jobId}`,'GET',undefined,s.epoch)).json();
  try{expect(final.state).toBe('terminal');expect(final.outcome.kind).toBe('unknown');expect(final.outputComplete).toBe(false);}finally{release();}
 }finally{vi.useRealTimers();}
});

it('preserves native exit and effect settlement when retained-output HTTP delivery is truncated',async()=>{
 const f=fixture();const s=await f.open();
 const job=await(await f.fetch(`sessions/${s.sessionId}/jobs`,'POST',invocation(),s.epoch)).json();
 await vi.waitFor(()=>expect(f.prepare).toHaveBeenCalled());const hooks=f.prepare.mock.calls[0][0].hooks;
 const close=vi.fn(async()=>{});
 await hooks.retainOutput('partial',{async stat(){return{type:'file' as const,size:4n};},async read(position){return position===1n?Uint8Array.of(255):new Uint8Array();},close});
 await hooks.effect({operationId:'partial-write',operation:'write',state:'applied',namespaceId:'work',path:'/partial',identityId:'partial',acknowledgedBytes:'4'});
 await f.start.mock.calls[0][0].end(2);await f.start.mock.calls[0][0].end(3);f.finish();
 await f.fetch(`sessions/${s.sessionId}/jobs/${job.jobId}/wait`,'GET',undefined,s.epoch);
 const response=await f.server.fetch(new Request(`https://media.test/v1/sessions/${s.sessionId}/jobs/${job.jobId}/outputs/partial/bytes`,{headers:{Authorization:'Bearer one','Execution-Epoch':s.epoch,'Execution-Protocol':'1',Range:'bytes=1-3'}}));
 expect(response.status).toBe(206);expect(response.headers.get('Content-Length')).toBe('3');
 const reader=response.body!.getReader();
 try{
  expect((await reader.read()).value).toEqual(Uint8Array.of(255));
  await expect(reader.read()).rejects.toThrow('Incomplete HTTP byte body');
  const effects=await(await f.fetch(`sessions/${s.sessionId}/jobs/${job.jobId}/effects`,'GET',undefined,s.epoch)).json();
  expect(effects.processOutcome).toEqual({kind:'exited',exitCode:1});expect(effects.effects).toMatchObject([{state:'applied',identityId:'partial'}]);
 }finally{await reader.cancel().catch(()=>{});await f.server.close();}
 expect(close).toHaveBeenCalledOnce();
});
it('inspects partial native effects and retrieves retained outputs after native failure', async () => {
  const f = fixture(); const s = await f.open();
  const job = await (await f.fetch(`sessions/${s.sessionId}/jobs`, 'POST', invocation(), s.epoch)).json();
  await vi.waitFor(() => expect(f.prepare).toHaveBeenCalled());
  const hooks = f.prepare.mock.calls[0][0].hooks;
  const bytes = Uint8Array.of(0, 255, 2, 3);
  const close = vi.fn(async () => {});
  await hooks.retainOutput('retained-a', { stat: async () => ({ type: 'file', size: 4n }), read: async (p, n) => bytes.slice(Number(p), Number(p) + n), close });
  await hooks.effect({ operationId: 'write-a', operation: 'write', state: 'applied', namespaceId: 'work', path: '/a', identityId: 'retained-a', acknowledgedBytes: '4' });
  await f.start.mock.calls[0][0].end(2); await f.start.mock.calls[0][0].end(3); f.finish();
  await f.fetch(`sessions/${s.sessionId}/jobs/${job.jobId}/wait`, 'GET', undefined, s.epoch);
  const manifestResponse = await f.fetch(`sessions/${s.sessionId}/jobs/${job.jobId}/effects`, 'GET', undefined, s.epoch);
  expect(manifestResponse.status).toBe(200);
  const manifest = await manifestResponse.json();
  expect(manifest.processOutcome).toEqual({ kind: 'exited', exitCode: 1 });
  expect(manifest.effects).toMatchObject([{ path: '/a', identityId: 'retained-a', state: 'applied' }]);
  const response = await f.server.fetch(new Request(`https://media.test/v1/sessions/${s.sessionId}/jobs/${job.jobId}/outputs/retained-a/bytes`, { headers: { Authorization: 'Bearer one', 'Execution-Epoch': s.epoch, 'Execution-Protocol': '1', Range: 'bytes=1-2' } }));
  expect(response.status).toBe(206);
  expect(new Uint8Array(await response.arrayBuffer())).toEqual(Uint8Array.of(255, 2));
  expect(close).not.toHaveBeenCalled();
});

it.each(['interrupted', 'changed', 'identity-changed', 'unqualified', 'quota', 'consumer-closed'] as const)('retrieves API-only outputs with %s source progress after native failure', async scenario => {
  const { createClient } = await import('./client.js');
  const { Volume } = await import('memfs');
  const f = fixture(); const s = await f.open();
  const job = await (await f.fetch(`sessions/${s.sessionId}/jobs`, 'POST', invocation(), s.epoch)).json();
  await vi.waitFor(() => expect(f.prepare).toHaveBeenCalled());
  const hooks = f.prepare.mock.calls[0][0].hooks;
  let interrupted = scenario !== 'quota' && scenario !== 'consumer-closed'; let version = 'original';
  let identity = {}; const starts: bigint[] = [];
  const bytes = Uint8Array.of(0, 255, 2, 3);
  await hooks.retainOutput('a', {
    identity,
    ...(scenario === 'unqualified' ? {} : { async freshness() {
      const observed = version;
      return { identity, version: observed, async assertCurrent() { if (version !== observed) throw new Error('Output changed'); } };
    } }),
    stat: async () => ({ type: 'file', size: 4n }),
    async read(position, length) { starts.push(position); if (interrupted && position >= 1n) throw new Error('delivery lost'); return bytes.slice(Number(position), Number(position) + (interrupted ? 1 : length)); },
    close: async () => {},
  });
  await hooks.effect({ operationId: 'a', operation: 'created', state: 'applied', namespaceId: 'work', path: '/a', identityId: 'a' });
  await f.start.mock.calls[0][0].end(2); await f.start.mock.calls[0][0].end(3); f.finish();
  await f.fetch(`sessions/${s.sessionId}/jobs/${job.jobId}/wait`, 'GET', undefined, s.epoch);
  const client = createClient({ baseUrl: 'https://media.test', token: async () => 'one', fetch: async (url, init) => f.server.fetch(new Request(url, init)) });
  const volume = Volume.fromJSON({ '/out/prior': 'unrelated' }); let opens = 0; let stop = true;
  const abort = new AbortController(); const reason = new Error('consumer closed');
  const destination = { async mkdir() {}, async open(path: string) {
    opens++; const fd = volume.openSync('/out/' + path, volume.existsSync('/out/' + path) ? 'r+' : 'w+');
    return { async write(position: bigint, data: Uint8Array) {
      if (stop && scenario === 'quota' && position > 0n) throw new Error('EDQUOT');
      const count = stop && (scenario === 'quota' || scenario === 'consumer-closed') ? 1 : data.length;
      const settled = volume.writeSync(fd, data, 0, count, Number(position));
      if (stop && scenario === 'consumer-closed') abort.abort(reason);
      return settled;
    }, async truncate(size: bigint) { volume.ftruncateSync(fd, Number(size)); }, async close() { volume.closeSync(fd); } };
  } };
  const first = await client.retrieveJobOutputs(s, job.jobId, '/', destination, undefined, abort.signal);
  expect(first.transfer.state).toBe('failed'); expect(first.transfer.cursor.offsets.get('a')).toBe(1n);
  expect(first.processOutcome).toEqual({ kind: 'exited', exitCode: 1 });
  if (scenario === 'consumer-closed') expect(first.transfer).toMatchObject({ error: reason });
  stop = false;
  interrupted = false; if (scenario === 'changed') version = 'replacement';
  if (scenario === 'identity-changed') identity = {};
  const resumed = await client.retrieveJobOutputs(s, job.jobId, '/', destination, first.transfer.cursor);
  expect(resumed.processOutcome).toEqual(first.processOutcome);
  if (scenario === 'interrupted' || scenario === 'quota' || scenario === 'consumer-closed') {
    expect(resumed.transfer.state).toBe('complete'); expect(starts.at(-1)).toBe(1n);
    expect(volume.readFileSync('/out/a')).toEqual(Buffer.from(bytes));
  } else {
    expect(resumed.transfer.state).toBe('failed'); expect(opens).toBe(1);
    expect(volume.readFileSync('/out/a')).toEqual(Buffer.from([0]));
  }
  expect(volume.readFileSync('/out/prior', 'utf8')).toBe('unrelated');
  await f.fetch(`sessions/${s.sessionId}`, 'DELETE', undefined, s.epoch, 'close');
});

it('keeps an output retention quota separate from native exit and exposes the retrieval failure', async () => {
  const f = fixture(); const s = await f.open();
  const job = await (await f.fetch(`sessions/${s.sessionId}/jobs`, 'POST', { ...invocation(), limits: { ...limits, maxHandles: 1 } }, s.epoch)).json();
  await vi.waitFor(() => expect(f.prepare).toHaveBeenCalled());
  const hooks = f.prepare.mock.calls[0][0].hooks;
  const resource = () => ({ stat: async () => ({ type: 'file' as const, size: 0n }), read: async () => new Uint8Array(), close: vi.fn(async () => {}) });
  await hooks.retainOutput('first', resource());
  const extra = resource();
  await expect(hooks.retainOutput('second', extra)).resolves.toBeUndefined();
  await hooks.effect({ operationId: 'second', operation: 'created', state: 'applied', namespaceId: 'work', path: '/second', identityId: 'second' });
  await f.start.mock.calls[0][0].end(2); await f.start.mock.calls[0][0].end(3); f.finish();
  await f.fetch(`sessions/${s.sessionId}/jobs/${job.jobId}/wait`, 'GET', undefined, s.epoch);
  const manifest = await (await f.fetch(`sessions/${s.sessionId}/jobs/${job.jobId}/effects`, 'GET', undefined, s.epoch)).json();
  expect(manifest.processOutcome).toEqual({ kind: 'exited', exitCode: 1 });
  expect(manifest.retrievalFailures).toMatchObject([{ identityId: 'second' }]); expect(extra.close).toHaveBeenCalledOnce();
});
it('bounds failure metadata under huge native output counts and closes every rejected retain', async () => {
  const f = fixture(); const s = await f.open();
  const job = await (await f.fetch(`sessions/${s.sessionId}/jobs`, 'POST', { ...invocation(), limits: { ...limits, maxHandles: 1 } }, s.epoch, 'many-outputs')).json();
  await vi.waitFor(() => expect(f.prepare).toHaveBeenCalled());
  const hooks = f.prepare.mock.calls[0][0].hooks;
  const close = vi.fn(async () => {});
  const resource = () => ({ stat: async () => ({ type: 'file' as const, size: 0n }), read: async () => new Uint8Array(), close });
  let rejected = 0;
  try {
    for (let i = 0; i < 1024; i++) { try { await hooks.retainOutput(`output-${i}`, resource()); } catch { rejected++; } }
    const manifest = await (await f.fetch(`sessions/${s.sessionId}/jobs/${job.jobId}/effects`, 'GET', undefined, s.epoch)).json();
    expect(manifest.retrievalFailures).toHaveLength(limits.maxCallbacks);
    expect(rejected).toBe(1024 - 1 - limits.maxCallbacks);
    expect(close).toHaveBeenCalledTimes(1023);
  } finally { f.finish(); }
});

});
