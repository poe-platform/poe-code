import {describe, expect, it, vi} from 'vitest';
import {createHash} from 'node:crypto';
import type {AdmissionStore} from './admissions.js';
import {createClient} from './client.js';
import {createMediaServer, type SessionAuthority} from './media-server.js';
import type {Build, DependencyJobRequest, Limits, Session} from './wire.generated.js';
import type {DependencyManifest, DependencyMaterializeRequest} from './protocol.js';

const digest='a'.repeat(64);
const build:Build={digest,imageDigest:'sha256:'+digest,os:'linux',architecture:'x86_64',executables:{tool:digest},librariesDigest:digest,inventoryDigest:digest,assetsDigest:digest,policyDigest:digest,configDigest:digest,launcherRevision:'fixture',bridgeRevision:'fixture',runtimeRequirements:[],runtimeEnvironment:{},policyDifferences:['fixture only'],inventory:{codecs:[],coders:[],delegates:[],fonts:[],profiles:[]}};
const limits:Limits={maxJobs:2,maxHandles:4,maxArgvBytes:128,maxManifestEntries:8,maxFrameBytes:4096,maxInflightBytes:8192,maxBlobBytes:8192,maxReplayBytes:65536,maxCallbacks:8,maxNativeMemoryBytes:8192,maxNativeProcesses:4,maxJobDurationMs:10000};
const bytes=(text:string)=>Array.from(new TextEncoder().encode(text));

function fixture(maxRecords=32){
 let now=Date.now();
 const retirement=vi.fn(async()=>{});
 const authorize=vi.fn(async()=>true);
 const install=vi.fn<NonNullable<SessionAuthority['dependencies']>['prepare']>(async input=>({
  result:{operationId:input.operationId,manifestId:input.request.manifestId,manifestRevision:input.request.manifestRevision,directoryRevision:'private-r1',state:'ready' as const,entries:input.manifest.entries.map((_,index)=>({index,state:'applied' as const,revision:'entry-r1'})),callbackGrantIds:[]},close:retirement,
 }));
 let end!:()=>void;
 const ended=new Promise<void>(resolve=>{end=resolve;});
 const prepare=vi.fn(async(_input:Parameters<SessionAuthority['prepare']>[0])=>({start(streams:import('./native-process.js').ProcessStreams){
  void (async()=>{await streams.output(2,new Uint8Array([7,8]));await streams.end(2);await streams.end(3);end();})();
  return {exit:ended.then(()=>({kind:'exited' as const,exitCode:0})),settled:ended,write:async()=>{},end:async()=>{},signal:()=>{}};
 },close:async()=>{}}));
 const authority:SessionAuthority={prepare,close:vi.fn(async()=>{}),dependencies:{authorize,prepare:install}};
 const retainedAdmissions=new Map<string,import('./admissions.js').AdmissionRecord>();
 const admissions={record:vi.fn<AdmissionStore['record']>(async()=>{}),inspect:vi.fn<AdmissionStore['inspect']>(async id=>structuredClone(retainedAdmissions.get(id)??null))};
 const durableAdmissions:AdmissionStore={inspect:admissions.inspect,async record(value){await admissions.record(value);retainedAdmissions.set(value.operationId,structuredClone(value));}};
 const server=createMediaServer({authenticate:async r=>({tenantId:r.headers.get('Authorization')??'',principalId:'owner',expiresAt:now+60000}),builds:[build],tools:[{id:'tool',buildDigest:digest,executable:'/tools/tool',requiredFeatures:[]}],driver:{features:[{name:'dependency-manifest-v1',evidence:['in-memory fixture']}],inspectBuild:async()=>build,admitSession:async()=>authority},admissions:durableAdmissions,storage:{append:async()=>{},read:async()=>new Uint8Array(),remove:async()=>{}},limits,leaseMs:10000,retentionMs:10000,maxDocumentBytes:16384,maxRecords,now:()=>now});
 const client=createClient({baseUrl:'https://media.test',token:async()=>'one',fetch:async(input,init)=>server.fetch(new Request(input,init))});
 async function open(){return client.openSession({buildDigest:digest,bindings:[{namespaceId:'work',logicalRoot:'/',rights:['read','write','metadata'],grantId:'host',profile:'snapshot'}],limits},'open');}
 function manifest(s:Session):DependencyManifest{return {version:1,sessionId:s.sessionId,epoch:s.epoch,namespaceId:'work',revision:'manifest-r1',logicalRoot:bytes('/'),cwd:bytes('/'),sourceAuthorityId:'source',entries:[]};}
 async function request(s:Session,path:string,input?:unknown,key='operation',profile='dependency-manifest-v1',token='one',method=input===undefined?'GET':'POST'){
  return server.fetch(new Request('https://media.test/v1/sessions/'+s.sessionId+'/'+path,{method,headers:{Authorization:'Bearer '+token,'Execution-Protocol':'1','Execution-Profile':profile,'Execution-Epoch':s.epoch,'Idempotency-Key':key,'Content-Type':'application/json'},body:input===undefined?undefined:JSON.stringify(input)}));
 }
 return {client,server,open,manifest,request,authorize,install,prepare,retirement,admissions,authority,advance:()=>{now+=20001;}};
}
async function prepared(f:ReturnType<typeof fixture>,s:Session){
 const m=f.manifest(s);const stored=await f.client.putDependencyManifest(s,m,'manifest');
 const input:DependencyMaterializeRequest={sessionId:s.sessionId,epoch:s.epoch,manifestId:stored.manifestId,manifestRevision:stored.revision,bindingId:'private-binding',expectedDirectoryRevision:null,operationKey:'prepare'};
 const accepted=await f.client.prepareDependencies(s,input,'prepare');
 let ready=await f.client.inspectDependencies(s,accepted.operationId);
 for(let n=0;n<10&&(ready.state==='accepted'||ready.state==='applying');n++)ready=await f.client.inspectDependencies(s,accepted.operationId);
 return {input,ready};
}
function invocation(ready:import('./protocol.js').DependencyMaterialization):DependencyJobRequest{
 const args=[[],bytes('$(id)'),bytes('\ufeffname')];
 return {buildDigest:digest,toolId:'tool',args,namespaceId:'work',cwd:'/',env:{EMPTY:''},stdin:{kind:'stream',seekable:false},descriptors:[],grants:[],freshness:'snapshot',limits,materializationRevision:'private-r1',materializationBinding:{operationId:ready.operationId,root:'/'},dependencyBinding:{bindingId:'private-binding',sourceAuthorityId:'source',materializationId:ready.operationId,invocation:{manifestId:ready.manifestId,manifestRevision:ready.manifestRevision,directoryRevision:'private-r1',cwd:bytes('/'),originalArgv:args}}};
}

describe('unified dependency HTTP profile',()=>{
 it('negotiates the profile and round trips exact manifest bytes through the SDK',async()=>{
  const f=fixture();expect((await f.client.capabilities()).features).toContain('dependency-manifest-v1');
  const s=await f.open();const m=f.manifest(s);
  const stored=await f.client.putDependencyManifest(s,m,'manifest');
  expect(stored.revision).toBe(m.revision);expect(await f.client.getDependencyManifest(s,stored.manifestId)).toEqual(m);
  expect(f.install).not.toHaveBeenCalled();expect(f.prepare).not.toHaveBeenCalled();
 });
 it('stores the exact submitted JSON bytes and refuses a second serialization of their revision',async()=>{
  const f=fixture();const s=await f.open();const m=f.manifest(s);const text=JSON.stringify(m,null,2)+'\n';
  const response=await f.server.fetch(new Request('https://media.test/v1/sessions/'+s.sessionId+'/manifests',{method:'POST',headers:{Authorization:'Bearer one','Execution-Protocol':'1','Execution-Epoch':s.epoch,'Execution-Profile':'dependency-manifest-v1','Idempotency-Key':'manifest','Content-Type':'application/json'},body:text}));
  expect(response.status).toBe(200);const receipt=await response.json();expect(receipt.sha256).toBe(createHash('sha256').update(text).digest('hex'));
  const read=await f.request(s,'manifests/'+receipt.manifestId);expect(await read.text()).toBe(text);
  expect((await f.request(s,'manifests',m,'reserialize')).status).toBe(409);
  expect((await f.request(s,'manifests/'+receipt.manifestId,undefined,'read','dependency-manifest-v1','other-tenant')).status).toBe(404);
 });
 it('prepares private dependencies and submits a streaming generic job with original argv',async()=>{
  const f=fixture();const s=await f.open();const {ready}=await prepared(f,s);
  expect(ready.state).toBe('ready');expect(f.authorize).toHaveBeenCalledOnce();
  const jobRequest=invocation(ready);
  const job=await f.client.submitDependencyJob(s,jobRequest,'job');
  const result=await f.client.waitJob(s,job.jobId);expect(result.processOutcome).toEqual({kind:'exited',exitCode:0});expect(result.outputComplete).toBe(true);
  expect(f.prepare.mock.calls[0][0].request.args).toEqual(jobRequest.args);
  const lane=await f.client.attach(s,job.jobId,{direction:'output',consumerId:'sdk-sink'},'attach');
  const output:number[]=[];const ended:number[]=[];
  for await(const frame of f.client.readFrames(s,job.jobId,lane.laneId,1n,{maxFrameBytes:limits.maxFrameBytes,maxControlBytes:limits.maxFrameBytes,channels:[2,3]})){
   if(frame.kind==='data'){expect(frame.channelId).toBe(2);output.push(...frame.payload);}
   if(frame.kind==='end')ended.push(frame.channelId);
  }
  expect(output).toEqual([7,8]);expect(ended).toEqual([2,3]);
  await f.client.closeSession(s,'close');expect(f.retirement).toHaveBeenCalledOnce();
 });
 it('refuses foreign manifest authority and revision reuse without private side effects',async()=>{
  const f=fixture();const s=await f.open();const m=f.manifest(s);
  expect((await f.request(s,'manifests',{...m,sessionId:'foreign'},'foreign')).status).toBe(403);
  expect((await f.request(s,'manifests',m,'manifest')).status).toBe(200);
  expect((await f.request(s,'manifests',{...m,cwd:bytes('/other')},'changed')).status).toBe(409);
  expect(f.install).not.toHaveBeenCalled();
 });
 it('does not allow a canonical request to reuse a dependency idempotency receipt',async()=>{
  const f=fixture();const s=await f.open();const m=f.manifest(s);
  expect((await f.request(s,'manifests',m,'same-key')).status).toBe(200);
  expect((await f.request(s,'manifests',m,'same-key','')).status).toBe(422);
  const canonical=await f.server.fetch(new Request('https://media.test/v1/sessions/'+s.sessionId+'/manifests',{method:'POST',headers:{Authorization:'Bearer one','Execution-Protocol':'1','Execution-Epoch':s.epoch,'Idempotency-Key':'same-key','Content-Type':'application/json'},body:JSON.stringify(m)}));
  expect(canonical.status).toBe(409);
 });
 it.each(['argv','cwd','binding','source','revision','root'] as const)('refuses a mismatched %s before process preparation',async change=>{
  const f=fixture();const s=await f.open();const {ready}=await prepared(f,s);const job=invocation(ready);
  if(change==='argv')job.dependencyBinding.invocation.originalArgv=[[120]];
  if(change==='cwd')job.dependencyBinding.invocation.cwd=bytes('/other');
  if(change==='binding')job.dependencyBinding.bindingId='other';
  if(change==='source')job.dependencyBinding.sourceAuthorityId='other';
  if(change==='revision')job.dependencyBinding.invocation.directoryRevision='other';
  if(change==='root')job.materializationBinding.root='/other';
  expect((await f.request(s,'jobs',job,'job')).status).toBe(409);expect(f.prepare).not.toHaveBeenCalled();
  await f.client.closeSession(s,'close');
 });
 it('reports a stale private revision as failed without retrying installation',async()=>{
  const f=fixture();const s=await f.open();const {input}=await prepared(f,s);
  const stale=await f.client.prepareDependencies(s,{...input,operationKey:'stale'},'stale');
  let result=await f.client.inspectDependencies(s,stale.operationId);
  for(let n=0;n<10&&(result.state==='accepted'||result.state==='applying');n++)result=await f.client.inspectDependencies(s,stale.operationId);
  expect(result).toMatchObject({state:'failed',error:'stale-revision'});expect(f.install).toHaveBeenCalledOnce();await f.client.closeSession(s,'close');
 });
 it('retains reported applied entries when preparation stream settlement is unknown',async()=>{
  const f=fixture();
  f.authority.grants=[{grantId:'owned-output',namespaceId:'work',operations:['write'],maxBytes:'128',maxOperations:4,expiresAt:new Date(Date.now()+60000).toISOString()}];
  const s=await f.open();const m=f.manifest(s);
  m.entries=[{kind:'directory',path:[bytes('dir')],source:{authorityId:'source',path:bytes('/dir'),freshness:'immutable',snapshotId:'snap',observedVersion:null,retainedIdentity:null}}];
  const receipt=await f.client.putDependencyManifest(s,m,'manifest');
  f.install.mockImplementation(async input=>{
   await input.hooks.openChannel({type:'ChannelOpen',channelId:5,correlationId:'1',direction:'write',resourceId:'owned-output',seekable:false});
   return {result:{operationId:input.operationId,manifestId:input.request.manifestId,manifestRevision:input.request.manifestRevision,directoryRevision:'private-r1',state:'ready',entries:[{index:0,state:'applied',revision:'entry-r1'}],callbackGrantIds:[]},close:f.retirement};
  });
  const accepted=await f.client.prepareDependencies(s,{sessionId:s.sessionId,epoch:s.epoch,manifestId:receipt.manifestId,manifestRevision:receipt.revision,bindingId:'private-binding',expectedDirectoryRevision:null,operationKey:'prepare'},'prepare');
  let result=await f.client.inspectDependencies(s,accepted.operationId);
  for(let n=0;n<10&&(result.state==='accepted'||result.state==='applying');n++)result=await f.client.inspectDependencies(s,accepted.operationId);
  expect(result.state).toBe('partial');expect(result.entries[0]).toEqual({index:0,state:'applied',revision:'entry-r1'});
  await f.client.closeSession(s,'close');expect(f.retirement).toHaveBeenCalledOnce();
 });
 it('requires prepared callback grants to be included in the invocation authority',async()=>{
  const f=fixture();
  f.authority.grants=[{grantId:'callback-grant',namespaceId:'work',root:'/',operations:['stat'],maxBytes:'0',maxOperations:4,expiresAt:new Date(Date.now()+60000).toISOString()}];
  const s=await f.open();
  f.install.mockImplementation(async input=>({result:{operationId:input.operationId,manifestId:input.request.manifestId,manifestRevision:input.request.manifestRevision,directoryRevision:'private-r1',state:'ready',entries:[],callbackGrantIds:['callback-grant']},close:f.retirement}));
  const {ready}=await prepared(f,s);expect(ready.state).toBe('ready');
  expect((await f.request(s,'jobs',invocation(ready),'job')).status).toBe(403);expect(f.prepare).not.toHaveBeenCalled();await f.client.closeSession(s,'close');
 });
 it('refuses canonical write callbacks during private preparation',async()=>{
  const f=fixture();
  f.authority.grants=[{grantId:'writer',namespaceId:'work',operations:['unlink'],maxBytes:'0',maxOperations:4,expiresAt:new Date(Date.now()+60000).toISOString()}];
  const s=await f.open();
  f.install.mockImplementation(async input=>{
   await expect(input.hooks.request('writer',{op:'unlink',path:'/canonical-file'})).rejects.toMatchObject({status:403});
   return {result:{operationId:input.operationId,manifestId:input.request.manifestId,manifestRevision:input.request.manifestRevision,directoryRevision:'private-r1',state:'ready',entries:[],callbackGrantIds:[]},close:f.retirement};
  });
  const {ready}=await prepared(f,s);expect(ready.state).toBe('ready');
  expect(f.admissions.record.mock.calls.some(([record])=>record.kind==='callback')).toBe(false);await f.client.closeSession(s,'close');
 });
 it('reclaims expired preparation journals and leases without requiring a native job',async()=>{
  const f=fixture(8);
  for(let n=0;n<9;n++){
   const s=await f.open();const {ready}=await prepared(f,s);expect(ready.state).toBe('ready');
   await f.client.closeSession(s,'close');f.advance();await f.server.sweep();
  }
  expect(f.retirement).toHaveBeenCalledTimes(9);expect(f.prepare).not.toHaveBeenCalled();
 });
 it.each(['accepted','applying'] as const)('does not claim completed preparation for a nonterminal adapter result %s',async state=>{
  const f=fixture();const s=await f.open();
  f.install.mockImplementation(async input=>({result:{operationId:input.operationId,manifestId:input.request.manifestId,manifestRevision:input.request.manifestRevision,directoryRevision:null,state,entries:[],callbackGrantIds:[]},close:f.retirement}));
  const {ready}=await prepared(f,s);expect(ready.state).toBe('unknown');await f.client.closeSession(s,'close');expect(f.retirement).toHaveBeenCalledOnce();
 });
 it('expires borrowed immutable blob reads with the preparation session lease',async()=>{
  const f=fixture();const s=await f.open();const sha256='e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
  const upload=await f.client.beginUpload(s,{size:'0',digest:sha256},'upload');const blob=await f.client.commitUpload(s,upload.uploadId,'commit');
  const m=f.manifest(s);m.entries=[{kind:'file',path:[bytes('empty')],blob:{blobId:blob.blobId,size:'0',sha256},source:{authorityId:'source',path:bytes('/empty'),freshness:'immutable',snapshotId:'snap',observedVersion:null,retainedIdentity:null}}];
  const receipt=await f.client.putDependencyManifest(s,m,'manifest');
  let retain:import('./media-server.js').InvocationBlob|undefined;
  f.install.mockImplementation(async input=>{retain=input.blobs.get(blob.blobId);return {result:{operationId:input.operationId,manifestId:input.request.manifestId,manifestRevision:input.request.manifestRevision,directoryRevision:'private-r1',state:'ready',entries:[{index:0,state:'applied',revision:'entry-r1'}],callbackGrantIds:[]},close:f.retirement};});
  const accepted=await f.client.prepareDependencies(s,{sessionId:s.sessionId,epoch:s.epoch,manifestId:receipt.manifestId,manifestRevision:receipt.revision,bindingId:'private-binding',expectedDirectoryRevision:null,operationKey:'prepare'},'prepare');
  for(let n=0;n<10&&!retain;n++)await f.client.inspectDependencies(s,accepted.operationId);
  expect(retain).toBeDefined();expect(await retain!.read(0n,1,new AbortController().signal)).toEqual(new Uint8Array());
  f.advance();await expect(retain!.read(0n,1,new AbortController().signal)).rejects.toMatchObject({status:410});await f.server.sweep();
 });
 it.each(['manifests','materializations','jobs'] as const)('does not admit %s creation through DELETE',async endpoint=>{
  const f=fixture();const s=await f.open();const {ready,input}=await prepared(f,s);
  const data=endpoint==='manifests'?f.manifest(s):endpoint==='materializations'?{...input,expectedDirectoryRevision:'private-r1',operationKey:'delete'}:invocation(ready);
  const response=await f.request(s,endpoint,data,'delete','dependency-manifest-v1','one','DELETE');
  expect(response.status).toBe(404);expect(f.prepare).not.toHaveBeenCalled();expect(f.install).toHaveBeenCalledOnce();await f.client.closeSession(s,'close');
 });
 it('does not turn live source preparation into readiness without its native callback grant',async()=>{
  const f=fixture();
  f.authority.grants=[{grantId:'source-grant',namespaceId:'work',operations:['stat'],maxBytes:'0',maxOperations:4,expiresAt:new Date(Date.now()+60000).toISOString()}];
  const s=await f.open();const m=f.manifest(s);
  m.entries=[{kind:'directory',path:[bytes('dir')],source:{authorityId:'source',path:bytes('/dir'),freshness:'live',callbackGrantId:'source-grant',observedVersion:null,retainedIdentity:null}}];
  const receipt=await f.client.putDependencyManifest(s,m,'manifest');
  const accepted=await f.client.prepareDependencies(s,{sessionId:s.sessionId,epoch:s.epoch,manifestId:receipt.manifestId,manifestRevision:receipt.revision,bindingId:'private-binding',expectedDirectoryRevision:null,operationKey:'prepare'},'prepare');
  let result=await f.client.inspectDependencies(s,accepted.operationId);
  for(let n=0;n<10&&(result.state==='accepted'||result.state==='applying');n++)result=await f.client.inspectDependencies(s,accepted.operationId);
  expect(result.state).toBe('unknown');await f.client.closeSession(s,'close');expect(f.retirement).toHaveBeenCalledOnce();
 });

 it('retires private preparation through the acquired lease owner',async()=>{
  const f=fixture();let acquired:Awaited<ReturnType<NonNullable<SessionAuthority['dependencies']>['prepare']>>;
  const replacement=vi.fn(async()=>{});
  f.install.mockImplementation(async input=>{
   acquired={result:{operationId:input.operationId,manifestId:input.request.manifestId,manifestRevision:input.request.manifestRevision,directoryRevision:'private-r1',state:'ready',entries:[],callbackGrantIds:[]},close:vi.fn(async function(this:unknown){expect(this).toBe(acquired);await f.retirement();})};
   return acquired;
  });
  const s=await f.open();const {ready}=await prepared(f,s);expect(ready.state).toBe('ready');
  const close=acquired!.close;acquired!.close=replacement;
  await f.client.closeSession(s,'close');
  expect(close).toHaveBeenCalledOnce();expect(f.retirement).toHaveBeenCalledOnce();expect(replacement).not.toHaveBeenCalled();
 });
 it.each(['pending-entry','missing-revision','duplicate-grant'] as const)('rejects a schema-shaped but impossible SDK readiness receipt: %s',async error=>{
  const receipt:import('./protocol.js').DependencyMaterialization={operationId:'op',manifestId:'manifest',manifestRevision:'m1',directoryRevision:'r1',state:'ready',entries:[{index:0,state:'applied',revision:'r1'}],callbackGrantIds:[]};
  if(error==='pending-entry')receipt.entries[0].state='pending';
  if(error==='missing-revision')receipt.directoryRevision=null;
  if(error==='duplicate-grant')receipt.callbackGrantIds=['g','g'];
  const client=createClient({baseUrl:'https://media.test',token:async()=>'one',fetch:async()=>Response.json(receipt,{headers:{'Execution-Epoch':'epoch','Execution-Profile':'dependency-manifest-v1'}})});
  await expect(client.inspectDependencies({sessionId:'session',epoch:'epoch'},'op')).rejects.toMatchObject({phase:'unknown',status:502});
 });
 it('reserves retained admission capacity before concurrent durable manifest writes',async()=>{
  const f=fixture(4);const s=await f.open();await f.client.putDependencyManifest(s,f.manifest(s),'original');
  let release!:()=>void;const barrier=new Promise<void>(resolve=>{release=resolve;});
  let admitted!:()=>void;const entered=new Promise<void>(resolve=>{admitted=resolve;});let count=0;
  f.admissions.record.mockImplementation(async()=>{if(++count===2)admitted();await barrier;});
  const first=f.request(s,'manifests',{...f.manifest(s),revision:'new-1'},'new-1');
  const second=f.request(s,'manifests',{...f.manifest(s),revision:'new-2'},'new-2');
  await entered;
  const overflow=f.request(s,'manifests',{...f.manifest(s),revision:'new-3'},'new-3');
  for(let n=0;n<100;n++)await Promise.resolve();release();
  const responses=await Promise.all([first,second,overflow]);expect(responses.map(r=>r.status)).toEqual([200,200,429]);expect(count).toBe(2);
 });
});
