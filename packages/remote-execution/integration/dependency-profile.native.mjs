// Explicit disposable-container integration. Private immutable inputs only;
// this fixture does not qualify canonical live filesystem mediation.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash, randomUUID} from 'node:crypto';
import {mkdtemp, open, readFile, rm} from 'node:fs/promises';
import {setImmediate} from 'node:timers/promises';
import {createMediaServer, createNativeDriver} from '@poe-code/remote-execution/server';
import {createClient} from '../node_modules/@poe-code/remote-execution/dist/client.js';

const bytes=text=>Array.from(new TextEncoder().encode(text));
const sha=data=>createHash('sha256').update(data).digest('hex');
const limits={maxJobs:2,maxHandles:8,maxArgvBytes:8192,maxManifestEntries:8,maxFrameBytes:4096,maxInflightBytes:8192,maxBlobBytes:8192,maxReplayBytes:65536,maxCallbacks:8,maxNativeMemoryBytes:536870912,maxNativeProcesses:64,maxJobDurationMs:30000};

test('private dependency preparation uses the generic real-process and binary lifecycle',async()=>{
 const root=await mkdtemp('/scratch/dependency-');let leaseClosed=0;let namespaceClosed=0;
 const digest=sha(await readFile(process.execPath));
 const build={digest,imageDigest:process.env.REMOTE_MEDIA_IMAGE_DIGEST,os:'linux',architecture:'x86_64',executables:{node:digest},librariesDigest:digest,inventoryDigest:digest,assetsDigest:digest,policyDigest:digest,configDigest:digest,launcherRevision:'disposable-process-fixture',bridgeRevision:'private-immutable-fixture',runtimeRequirements:[],runtimeEnvironment:{},policyDifferences:['Private immutable fixture only; no qualified live filesystem bridge.'],inventory:{codecs:[],coders:[],delegates:[],fonts:[],profiles:[]}};
 const uploaded=new Map();const records=new Map();
 const driver=createNativeDriver({backend:{features:[{name:'dependency-manifest-v1',evidence:['this explicit private immutable fixture']}],inspectBuild:async()=>build,async admitSession(){return {
  dependencies:{
   async authorize({manifest,bindingId}){
    return bindingId==='fixture-binding'&&manifest.sourceAuthorityId==='fixture-source'&&manifest.namespaceId==='work'&&JSON.stringify(manifest.logicalRoot)===JSON.stringify(bytes(root))&&manifest.entries.every(entry=>entry.kind==='file'&&entry.source.freshness==='immutable'&&entry.source.snapshotId===entry.blob.blobId&&JSON.stringify(entry.path)===JSON.stringify([bytes('input')]));
   },
   async prepare(input){
    const file=await open(root+'/input','wx',0o600);
    try{
     const blob=input.blobs.get(input.manifest.entries[0].blob.blobId);let offset=0n;
     while(offset<blob.size){const chunk=await blob.read(offset,limits.maxFrameBytes,input.signal);let applied=0;while(applied<chunk.length){const result=await file.write(chunk,applied,chunk.length-applied);assert.ok(result.bytesWritten>0);applied+=result.bytesWritten;}offset+=BigInt(chunk.length);}
     await file.sync();
    }finally{await file.close();}
    return {result:{operationId:input.operationId,manifestId:input.request.manifestId,manifestRevision:input.request.manifestRevision,directoryRevision:'private-r1',state:'ready',entries:[{index:0,state:'applied',revision:'private-r1'}],callbackGrantIds:[]},async close(){leaseClosed++;await rm(root,{recursive:true,force:true});}};
   },
  },
  async prepare(input){assert.equal(input.request.dependencyBinding.bindingId,'fixture-binding');assert.equal(input.request.cwd,root);return {cwd:root,env:{},async close(){}};},
  async close(){namespaceClosed++;assert.equal(leaseClosed,1);},
 };}}});
 const server=createMediaServer({builds:[build],tools:[{id:'node',buildDigest:digest,executable:process.execPath,requiredFeatures:[]}],driver,authenticate:async request=>request.headers.get('Authorization')==='Bearer fixture'?{tenantId:'tenant',principalId:'owner',expiresAt:Date.now()+60000}:null,
  admissions:{async record(record){records.set(record.operationId,structuredClone(record));},async inspect(id){return records.get(id)??null;}},
  storage:{async append(id,offset,data){const previous=uploaded.get(id)??new Uint8Array();assert.equal(BigInt(previous.length),offset);const next=new Uint8Array(previous.length+data.length);next.set(previous);next.set(data,previous.length);uploaded.set(id,next);},async read(id,offset,count){return (uploaded.get(id)??new Uint8Array()).slice(Number(offset),Number(offset)+count);},async remove(id){uploaded.delete(id);}},limits,leaseMs:60000,retentionMs:10000,maxDocumentBytes:16384,maxRecords:32});
 const client=createClient({baseUrl:'https://fixture.test',token:async()=>'fixture',fetch:async(input,init)=>server.fetch(new Request(input,init))});let session;
 try{
  session=await client.openSession({buildDigest:digest,bindings:[{namespaceId:'work',logicalRoot:root,rights:['read'],grantId:'fixture',profile:'snapshot'}],limits},'session');
  const payload=new TextEncoder().encode('private input');const upload=await client.beginUpload(session,{size:String(payload.length),digest:sha(payload)},'upload');
  await client.uploadChunk(session,upload.uploadId,0n,payload,'sha-256=:'+createHash('sha256').update(payload).digest('base64')+':','chunk');const blob=await client.commitUpload(session,upload.uploadId,'commit');
  const manifest={version:1,sessionId:session.sessionId,epoch:session.epoch,namespaceId:'work',revision:'manifest-r1',logicalRoot:bytes(root),cwd:bytes(root),sourceAuthorityId:'fixture-source',entries:[{kind:'file',path:[bytes('input')],source:{authorityId:'fixture-source',path:bytes(root+'/input'),freshness:'immutable',snapshotId:blob.blobId,observedVersion:null,retainedIdentity:null},blob:{blobId:blob.blobId,size:blob.size,sha256:blob.digest}}]};
  const stored=await client.putDependencyManifest(session,manifest,'manifest');
  let materialization=await client.prepareDependencies(session,{sessionId:session.sessionId,epoch:session.epoch,manifestId:stored.manifestId,manifestRevision:stored.revision,bindingId:'fixture-binding',expectedDirectoryRevision:null,operationKey:'prepare'},'prepare');
  for(let n=0;n<100&&['accepted','applying'].includes(materialization.state);n++){await setImmediate();materialization=await client.inspectDependencies(session,materialization.operationId);}
  assert.equal(materialization.state,'ready');
  const program="process.stdin.resume();process.stdin.once('end',()=>{process.stdout.write(JSON.stringify({input:require('node:fs').readFileSync('input','utf8'),argv:process.argv.slice(1),env:process.env.EMPTY}));process.stderr.write('native diagnostic\\n');});";
  const args=[bytes('-e'),bytes(program),[],bytes('$(id)'),bytes('\ufeffname')];
  const job=await client.submitDependencyJob(session,{buildDigest:digest,toolId:'node',args,namespaceId:'work',materializationRevision:'private-r1',materializationBinding:{operationId:materialization.operationId,root},cwd:root,env:{EMPTY:''},stdin:{kind:'stream',seekable:false},descriptors:[],grants:[],freshness:'snapshot',limits,dependencyBinding:{bindingId:'fixture-binding',sourceAuthorityId:'fixture-source',materializationId:materialization.operationId,invocation:{manifestId:stored.manifestId,manifestRevision:stored.revision,directoryRevision:'private-r1',cwd:bytes(root),originalArgv:args}}},'job');
  let status=await client.inspectJob(session,job.jobId);for(let n=0;n<100&&status.state==='accepted';n++){await setImmediate();status=await client.inspectJob(session,job.jobId);}assert.equal(status.state,'running');
  const input=await client.attach(session,job.jobId,{direction:'input',consumerId:'stdin'},'input');
  await client.sendFrames(session,job.jobId,input.laneId,[{kind:'end',channelId:1,sequence:1n,offset:0n,correlationId:0n,payload:new Uint8Array()}],{maxFrameBytes:4096,maxControlBytes:4096,channels:[1]},'eof');
  const result=await client.waitJob(session,job.jobId);assert.deepEqual(result.processOutcome,{kind:'exited',exitCode:0});assert.equal(result.outputComplete,true);assert.equal(result.cleanup,'complete');
  const output=await client.attach(session,job.jobId,{direction:'output',consumerId:'stdout-stderr'},'output');const stdout=[];const stderr=[];
  for await(const frame of client.readFrames(session,job.jobId,output.laneId,1n,{maxFrameBytes:4096,maxControlBytes:4096,channels:[2,3]}))if(frame.kind==='data')(frame.channelId===2?stdout:stderr).push(Buffer.from(frame.payload));
  assert.deepEqual(JSON.parse(Buffer.concat(stdout).toString()),{input:'private input',argv:['','$(id)','\ufeffname'],env:''});assert.equal(Buffer.concat(stderr).toString(),'native diagnostic\n');
  await client.closeSession(session,'close');assert.equal(leaseClosed,1);assert.equal(namespaceClosed,1);assert.equal(uploaded.size,0,'session close must reclaim uploaded blobs before operator shutdown');session=undefined;
 }finally{try{if(session)await client.closeSession(session,randomUUID());await server.close();assert.equal(uploaded.size,0);}finally{await rm(root,{recursive:true,force:true});}}
});
