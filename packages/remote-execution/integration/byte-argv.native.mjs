import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {setImmediate} from 'node:timers/promises';
import {createMediaServer,createNativeDriver} from '@poe-code/remote-execution/server';
import {createClient} from '../node_modules/@poe-code/remote-execution/dist/client.js';
import {createByteArgvLauncher} from '../byte-argv-launcher.js';
const helperExecutable='/app/rme-execve';
const helperDigest=createHash('sha256').update(await readFile(helperExecutable)).digest('hex');
const launcher=await createByteArgvLauncher({helperExecutable,helperDigest,maxHelperBytes:1048576});
const spec=(args,extra={})=>({executable:'/app/argv-probe',args,cwd:'/scratch',env:{VALUE:'literal'},inputChannels:[1],outputChannels:[2,3,4],maxFrameBytes:4096,maxArgvBytes:1048576,...extra});

test('execve preserves invalid UTF8, empty and shell-looking tokens, cwd/env and descriptor streams',async()=>{
 const args=[[],[255,192,175],[36,40,105,100,41],Array.from(Buffer.from('a b')),Array.from(Buffer.from('\ufeffliteral'))];
 const output={2:[],3:[],4:[]};const ended=[];
 const run=launcher.launch(spec(args),{async output(channel,bytes){assert.ok(bytes.length<=4096);output[channel].push(bytes.slice());},async end(channel){ended.push(channel);}});
 try{
  await run.write(1,new Uint8Array([0,255,128]));await run.end(1);
  assert.deepEqual(await run.exit,{kind:'exited',exitCode:23});await run.settled;
  assert.equal(Buffer.concat(output[2]).toString(),args.map(token=>token.length+':'+Buffer.from(token).toString('hex')+'\n').join(''));
  assert.equal(Buffer.concat(output[3]).toString(),'cwd=/scratch;VALUE=literal');
  assert.deepEqual(Buffer.concat(output[4]),Buffer.from([0,255,128]));assert.deepEqual(ended.sort(),[2,3,4]);
 }finally{await run.terminateGroup();await run.settled;}
});

test('argv transport does not double a large native token into an oversized encoded process argument',async()=>{
 const token=Array.from({length:100000},()=>255);let count=0;
 const run=launcher.launch(spec([token]),{async output(channel,bytes){if(channel===2)count+=bytes.length;},async end(){}});
 try{await run.end(1);assert.deepEqual(await run.exit,{kind:'exited',exitCode:23});await run.settled;assert.equal(count,200008);}
 finally{await run.terminateGroup();await run.settled;}
});

test('execve errors are native launch errors, with no protocol diagnostics in tool stderr',async()=>{
 for(const executable of ['/missing-native-tool','/scratch']){
  const output=[];
  const run=launcher.launch(spec([],{executable,inputChannels:[]}),{async output(channel,bytes){output.push({channel,bytes});},async end(){}});
  try{const outcome=await run.exit;assert.equal(outcome.kind,'spawnError');assert.equal(outcome.code,executable==='/scratch'?'EACCES':'ENOENT');await run.settled;assert.deepEqual(output,[]);}
  finally{await run.terminateGroup();await run.settled;}
 }
});

test('a byte argv process retains real signal termination and group cleanup',async()=>{
 let resolveReady;const ready=new Promise(resolve=>{resolveReady=resolve;});
 const run=launcher.launch(spec([Array.from(Buffer.from('--pause'))]),{async output(channel){if(channel===2)resolveReady();},async end(){}});
 try{await run.end(1);await ready;run.signal('SIGTERM');assert.deepEqual(await run.exit,{kind:'signaled',signal:'SIGTERM',signalNumber:15});await run.settled;}
 finally{await run.terminateGroup();await run.settled;}
});

test('byte argv launcher revision pins the observed disposable helper bytes',async()=>{
 assert.equal(launcher.argvProfile.revision,'posix-execve-v1:'+helperDigest);
 const runtimeFiles={};for(const path of ['/app/native-process.js','/app/native-driver.js','/app/byte-argv-launcher.js'])runtimeFiles[path]=createHash('sha256').update(await readFile(path)).digest('hex');
 console.log(JSON.stringify({kind:'disposable-byte-argv-qualification',imageDigest:process.env.REMOTE_MEDIA_IMAGE_DIGEST,helperDigest,launcherRevision:launcher.argvProfile.revision,runtimeFiles,productionCanonicalMediation:false}));
});

test('versioned HTTP, binary streams and SDK execute original byte argv on the pinned launcher',async()=>{
 const executable='/app/argv-probe';const digest=createHash('sha256').update(await readFile(executable)).digest('hex');
 const build={digest,imageDigest:process.env.REMOTE_MEDIA_IMAGE_DIGEST,os:'linux',architecture:'x86_64',executables:{probe:digest},librariesDigest:digest,inventoryDigest:digest,assetsDigest:digest,policyDigest:digest,configDigest:digest,launcherRevision:launcher.argvProfile.revision,bridgeRevision:'private-disposable-fixture',runtimeRequirements:[],runtimeEnvironment:{},policyDifferences:['Private process fixture; canonical mediation and production asset closure are NOT qualified.'],inventory:{codecs:[],coders:[],delegates:[],fonts:[],profiles:[]}};
 const limits={maxJobs:1,maxHandles:8,maxArgvBytes:8192,maxManifestEntries:8,maxFrameBytes:4096,maxInflightBytes:8192,maxBlobBytes:8192,maxReplayBytes:65536,maxCallbacks:8,maxNativeMemoryBytes:536870912,maxNativeProcesses:64,maxJobDurationMs:30000};
 let namespaces=0;
 const driver=createNativeDriver({launcher,backend:{features:[],async inspectBuild(){return build;},async admitSession(){namespaces++;return{async close(){},async prepare(){return{cwd:'/scratch',env:{},async close(){}};}};}}});
 const records=new Map();
 const server=createMediaServer({builds:[build],tools:[{id:'probe',buildDigest:digest,executable,requiredFeatures:[]}],driver,authenticate:async request=>request.headers.get('Authorization')==='Bearer fixture'?{tenantId:'tenant',principalId:'owner',expiresAt:Date.now()+60000}:null,
  admissions:{async record(record){records.set(record.operationId,structuredClone(record));},async inspect(id){return records.get(id)??null;}},storage:{async append(){},async read(){return new Uint8Array();},async remove(){}},limits,leaseMs:60000,retentionMs:10000,maxDocumentBytes:16384,maxRecords:32});
 const client=createClient({baseUrl:'https://fixture.test',token:async()=>'fixture',fetch:async(input,init)=>server.fetch(new Request(input,init))});let session;
 try{
  const capabilities=await client.capabilities();assert.ok(capabilities.features.includes('byte-argv'));assert.ok(!capabilities.features.includes('live-files'));
  session=await client.openSession({buildDigest:digest,requiredFeatures:['byte-argv'],bindings:[{namespaceId:'work',logicalRoot:'/scratch',rights:['read'],grantId:'fixture',profile:'snapshot'}],limits},'session');assert.equal(namespaces,1);
  const args=[[],[255,192,175],[36,40,105,100,41]];
  const job=await client.submitJob(session,{buildDigest:digest,toolId:'probe',args,namespaceId:'work',materializationRevision:null,cwd:'/scratch',env:{VALUE:'literal'},stdin:{kind:'stream',seekable:false},descriptors:[],grants:[],freshness:'snapshot',requiredFeatures:['byte-argv'],limits},'job');
  let status=await client.inspectJob(session,job.jobId);while(status.state==='accepted'){await setImmediate();status=await client.inspectJob(session,job.jobId);}
  const input=await client.attach(session,job.jobId,{direction:'input',consumerId:'stdin'},'input');
  await client.sendFrames(session,job.jobId,input.laneId,[{kind:'end',channelId:1,sequence:1n,offset:0n,correlationId:0n,payload:new Uint8Array()}],{maxFrameBytes:4096,maxControlBytes:4096,channels:[1]},'eof');
  const result=await client.waitJob(session,job.jobId);assert.deepEqual(result.processOutcome,{kind:'exited',exitCode:23});assert.equal(result.outputComplete,true);assert.equal(result.cleanup,'complete');
  const lane=await client.attach(session,job.jobId,{direction:'output',consumerId:'stdout-stderr'},'output');const output={2:[],3:[]};
  for await(const frame of client.readFrames(session,job.jobId,lane.laneId,1n,{maxFrameBytes:4096,maxControlBytes:4096,channels:[2,3]}))if(frame.kind==='data')output[frame.channelId].push(Buffer.from(frame.payload));
  assert.equal(Buffer.concat(output[2]).toString(),'0:\n3:ffc0af\n5:2428696429\n');assert.equal(Buffer.concat(output[3]).toString(),'cwd=/scratch;VALUE=literal');
 }finally{try{if(session)await client.closeSession(session,'close');}finally{await server.close();}}
});
