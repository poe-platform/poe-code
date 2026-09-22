import assert from 'node:assert/strict';
import {test} from 'node:test';
import {spawn} from 'node:child_process';
import {openSync,closeSync,fstatSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {createProcessConnection} from '../src/process-connection.js';
import {createNativeLauncher} from '../src/native-process.js';
import {executeRemoteProcess} from '../src/process.js';
import {connectHttpProcess,createProcessHttpHandler} from '../src/process-http.js';
import {toByteSource,type ByteSource} from '@poe-code/safe-fs/core';
import {createBytePipe} from '../../safe-bash/src/contracts/io.js';
import {getCommandArguments} from '../../safe-bash/src/contracts/command.js';
import {createProcessSignalChannel} from '../../safe-bash/src/contracts/process.js';
import {setup} from '../../safe-bash/tests/shell/helpers.js';

const executable=process.env.REMOTE_PROCESS_FFMPEG;
if(!executable?.startsWith('/'))throw new Error('Supply an absolute REMOTE_PROCESS_FFMPEG oracle executable');
const bytes=(value:string)=>Array.from(new TextEncoder().encode(value));
const synthesis=['-hide_banner','-f','lavfi','-i','sine=sample_rate=8000:duration=0.01','-f','s16le'];
function connection(args:string[],extra: {outputChannels?:number[]}={}) {
 const native=createProcessConnection({executable:executable!,cwd:'/',env:{},args:args.map(bytes),inputChannels:[1],outputChannels:[2,3],maxFrameBytes:4096,...extra});
 if(process.env.REMOTE_PROCESS_HTTP!=='1')return native;
 const identity={sessionId:'native-oracle',epoch:crypto.randomUUID(),jobId:crypto.randomUUID()};
 const handler=createProcessHttpHandler({identity,connection:native,authorize:async request=>request.headers.get('Authorization')==='Bearer oracle-only',maxRequests:1});
 // Qualifies authenticated Fetch handler/client framing against native FFmpeg.
 // This explicit loopback profile does not certify a deployed HTTPS service.
 return connectHttpProcess({identity,baseUrl:'https://oracle.test',token:async()=> 'oracle-only',fetch:async(input,init)=>handler(new Request(input,init))},new AbortController().signal);
}
async function run(args:string[],stdin:ByteSource=toByteSource(new Uint8Array())) {
 const stdout:Uint8Array[]=[];const stderr:Uint8Array[]=[];
 const result=await executeRemoteProcess({stdin,stdout:{async write(b){stdout.push(b.slice());}},stderr:{async write(b){stderr.push(b.slice());}},signal:new AbortController().signal},async()=>connection(args),(_name,number)=>128+number);
 return {result,stdout:Buffer.concat(stdout),stderr:Buffer.concat(stderr).toString()};
}
async function oracle(args:string[],input:string) {
 const child=spawn(executable!,args,{cwd:'/',env:{},stdio:['pipe','pipe','pipe'],shell:false});
 const observed=new Promise<number|null>((resolve,reject)=>{child.once('error',reject);child.once('close',resolve);});
 child.stdin.on('error',()=>{});child.stdout.resume();child.stderr.resume();child.stdin.end(input);return observed;
}
for(const response of ['y\n','n\n','yes\n','no\n','']) {
 test(`native overwrite stdin ${JSON.stringify(response)} without -nostdin`,{timeout:2000},async()=>{
  const args=[...synthesis,'/dev/null'];const status=await oracle(args,response);
  const result=await run(args,toByteSource(response));assert.equal(result.result.exitCode,status);assert.ok(result.stderr.includes('already exists'));
 });
}
for(const response of ['y\n','']) {
 test(`empty stdin fragment is not EOF before delayed ${response?'overwrite response':'EOF'}`,{timeout:2000},async()=>{
  const args=[...synthesis,'/dev/null'];
  const expected=await oracle(args,response);
  let prompted!:()=>void;const prompt=new Promise<void>(resolve=>{prompted=resolve;});
  let diagnostic='';
  const stdin:ByteSource={async *[Symbol.asyncIterator](){
   yield new Uint8Array();
   await prompt;
   if(response)yield new TextEncoder().encode(response);
  }};
  const result=await executeRemoteProcess({stdin,stdout:{async write(){}},stderr:{async write(chunk){
   diagnostic+=new TextDecoder().decode(chunk);
   if(diagnostic.includes('Overwrite?'))prompted();
  }},signal:new AbortController().signal},async()=>connection(args));
  assert.equal(result.exitCode,expected);assert.ok(diagnostic.includes('Overwrite?'));
  assert.equal((await run([...synthesis,'pipe:1'])).result.exitCode,0);
 });
}
test('supplied q response stops a noninteractive native encode without injected flags',{timeout:2000},async()=>{
 const result=await run(['-hide_banner','-re','-f','lavfi','-i','sine=sample_rate=8000:duration=60','-f','s16le','pipe:1'],toByteSource('q\n'));
 assert.equal(result.result.exitCode,0);assert.ok(result.stdout.length<960000);
});
test('stdin media bytes compete with native interactive input and progress remains stderr',{timeout:2000},async()=>{
 const media=Uint8Array.from([113,10,255,0,121,10,110,10]);
 const result=await run(['-hide_banner','-f','s16le','-ar','8000','-ac','1','-i','pipe:0','-progress','pipe:2','-f','s16le','pipe:1'],toByteSource(media));
 assert.equal(result.result.exitCode,0);assert.deepEqual(result.stdout,Buffer.from(media));assert.ok(result.stderr.includes('progress=end'));
});
for(const length of [8,262144]) {
 test(`stdin media competition matches a direct native oracle for ${length} bytes`,{timeout:3000},async()=>{
  const pattern=Uint8Array.from([113,10,255,0,121,10,110,10]);
  const media=Uint8Array.from({length},(_value,index)=>pattern[index%pattern.length]!);
  const args=['-hide_banner','-f','s16le','-ar','8000','-ac','1','-i','pipe:0','-progress','pipe:2','-f','s16le','pipe:1'];
  // Both runs receive q/y/n among the media bytes with native stdin enabled.
  // The native executable decides how stdin is consumed; the transport must
  // reproduce that decision rather than assuming interaction is disabled.
  const child=spawn(executable!,args,{cwd:'/',env:{},stdio:['pipe','pipe','pipe'],shell:false});
  const stdout:Uint8Array[]=[];const stderr:Uint8Array[]=[];
  const observed=new Promise<number|null>((resolve,reject)=>{child.once('error',reject);child.once('close',resolve);});
  child.stdin.on('error',()=>{});
  child.stdout.on('data',(chunk:Uint8Array)=>{stdout.push(chunk.slice());});
  child.stderr.on('data',(chunk:Uint8Array)=>{stderr.push(chunk.slice());});
  child.stdin.end(media);
  const status=await observed;
  const result=await run(args,toByteSource(media));
  assert.equal(result.result.exitCode,status);
  assert.deepEqual(result.stdout,Buffer.concat(stdout));
  assert.ok(Buffer.concat(stderr).toString().includes('progress=end'));
  assert.ok(result.stderr.includes('progress=end'));
  assert.equal((await run([...synthesis,'pipe:1'])).result.exitCode,0);
 });
}
test('a lost stdin receipt remains a failure after native FFmpeg exits successfully',{timeout:2000},async()=>{
 const native=await connection([...synthesis,'pipe:1']);
 const cause=new Error('Native accepted stdin but its transport receipt was lost');
 const stdout:Uint8Array[]=[];const stderr:Uint8Array[]=[];
 const execution=executeRemoteProcess({stdin:toByteSource('y\n'),stdout:{async write(chunk){stdout.push(chunk.slice());}},stderr:{async write(chunk){stderr.push(chunk.slice());}},signal:new AbortController().signal},async()=>({...native,
  async send(channel,frame,offset,signal){
   await native.send(channel,frame,offset,signal);
   await native.outcome;
   throw cause;
  },
 }));
 await assert.rejects(execution,error=>error===cause);
 assert.deepEqual(await native.outcome,{kind:'exited',exitCode:0});
 assert.equal(Buffer.concat(stdout).length,160);
 assert.ok(Buffer.concat(stderr).length>0);
 assert.equal((await run([...synthesis,'pipe:1'])).result.exitCode,0);
});
test('idle native overwrite stdin cancels, reaps and permits a subsequent invocation',{timeout:2000},async()=>{
 const controller=new AbortController();const cause=new Error('oracle cancellation');let entered!:()=>void;
 const ready=new Promise<void>(r=>{entered=r;});
 let prompted!:()=>void;const waitingForResponse=new Promise<void>(resolve=>{prompted=resolve;});
 let diagnostic='';
 const stdin:ByteSource={[Symbol.asyncIterator](){return {async next(){entered();await new Promise<void>((_,reject)=>{controller.signal.addEventListener('abort',()=>reject(cause),{once:true});});return {done:true as const,value:undefined};}};}};
 const execution=executeRemoteProcess({stdin,stdout:{async write(){}},stderr:{async write(bytes){
  diagnostic+=new TextDecoder().decode(bytes);
  if(diagnostic.includes('Overwrite?'))prompted();
 }},signal:controller.signal},async()=>connection([...synthesis,'/dev/null']));
 await Promise.all([ready,waitingForResponse]);controller.abort(cause);await assert.rejects(execution,error=>error===cause);
 assert.equal((await run([...synthesis,'pipe:1'])).result.exitCode,0);
});
test('cancellation drains a late authenticated remote dependency acquisition and allows reuse',{timeout:2000},async()=>{
 const controller=new AbortController();const cause=new Error('Cancel pending remote acquisition');
 let admitted!:()=>void;const acquired=new Promise<void>(resolve=>{admitted=resolve;});
 let release!:()=>void;const dependency=new Promise<void>(resolve=>{release=resolve;});
 const stdout:Uint8Array[]=[];let remote:Awaited<ReturnType<typeof connection>>|undefined;
 let cleaned=false;let cleanup:(()=>Promise<void>)|undefined;
 const execution=executeRemoteProcess({stdin:toByteSource(''),stdout:{async write(chunk){stdout.push(chunk.slice());}},stderr:{async write(){}},signal:controller.signal,
  registerCleanup(close){cleanup=close;},
 },async()=>{
  assert.ok(cleanup,'Cleanup must be registered before remote acquisition');
  remote=await connection([...synthesis,'pipe:1']);admitted();
  // A driver-owned dependency may finish after cancellation. Its admitted
  // native invocation still belongs to the enclosing acquisition barrier.
  await dependency;
  const close=remote.close.bind(remote);
  return {...remote,async close(){await close();cleaned=true;}};
 });
 const observation=execution.then(value=>({value}),error=>({error}));
 await acquired;controller.abort(cause);release();
 assert.deepEqual(await observation,{error:cause});assert.equal(cleaned,true);assert.equal(stdout.length,0);
 await cleanup!();assert.equal((await run([...synthesis,'pipe:1'])).result.exitCode,0);
});
test('concurrent ffmpeg producer and consumer drain a pipe smaller than a media frame',{timeout:3000},async()=>{
 const pipe=createBytePipe({highWaterMark:32});const output:Uint8Array[]=[];const signal=new AbortController().signal;
 const consumer=executeRemoteProcess({stdin:pipe.readable,stdout:{async write(b){output.push(b.slice());}},stderr:{async write(){}},signal},async()=>connection(['-hide_banner','-f','s16le','-ar','8000','-ac','1','-i','pipe:0','-f','s16le','pipe:1']));
 const producer=executeRemoteProcess({stdin:toByteSource(new Uint8Array()),stdout:pipe.writable,stderr:{async write(){}},signal},async()=>connection([...synthesis,'pipe:1'])).finally(()=>pipe.close());
 const results=await Promise.all([producer,consumer]);assert.deepEqual(results,[{exitCode:0},{exitCode:0}]);assert.equal(Buffer.concat(output).length,160);
});
test('pipe:3 uses an admitted descriptor lease and leaves stdout separate',{timeout:2000},async()=>{
 const descriptor:Uint8Array[]=[];const stdout:Uint8Array[]=[];let closed=false;
 const result=await executeRemoteProcess({stdin:toByteSource(new Uint8Array()),stdout:{async write(b){stdout.push(b);}},stderr:{async write(){}},signal:new AbortController().signal,
  admittedHandles:{async acquire(fd,rights){assert.equal(fd,3);assert.deepEqual(rights,['write']);return{async write(b){descriptor.push(b.slice(0,1));return 1;},async close(){closed=true;}};}}
 },async()=>connection([...synthesis,'pipe:3'],{outputChannels:[2,3,4]}));
 assert.equal(result.exitCode,0);assert.equal(Buffer.concat(descriptor).length,160);assert.equal(Buffer.concat(stdout).length,0);assert.equal(closed,true);
});
test('concurrent ffmpeg media exceeding native pipe capacity drains a slow consumer',{timeout:5000},async()=>{
 const pipe=createBytePipe({highWaterMark:1024});
 const signal=new AbortController().signal;let received=0;let writes=0;
 const consumer=executeRemoteProcess({stdin:pipe.readable,stdout:{async write(chunk){
  assert.ok(chunk.every(byte=>byte===0));received+=chunk.length;writes++;
  // Hold each canonical receipt briefly so output credit, native stdout,
  // media stdin and the upstream producer all encounter a slow destination.
  await new Promise<void>(resolve=>setTimeout(resolve,1));
 }},stderr:{async write(){}},signal},async()=>connection(['-hide_banner','-f','s16le','-ar','8000','-ac','1','-i','pipe:0','-f','s16le','pipe:1']));
 const producer=executeRemoteProcess({stdin:toByteSource(''),stdout:pipe.writable,stderr:{async write(){}},signal},async()=>connection([
  '-hide_banner','-f','lavfi','-i','anullsrc=sample_rate=8000:channel_layout=mono','-t','132','-f','s16le','pipe:1',
 ])).finally(()=>pipe.close());
 assert.deepEqual(await Promise.all([producer,consumer]),[{exitCode:0},{exitCode:0}]);
 assert.equal(received,2112000);assert.ok(writes>100);
 assert.equal((await run([...synthesis,'pipe:1'])).result.exitCode,0);
});
test('native signal handler status stays explicit rather than becoming 128+signal',{timeout:2000},async()=>{
 let ready!:()=>void;const started=new Promise<void>(r=>{ready=r;});
 const connection=createProcessConnection({executable:process.execPath,cwd:'/',env:{},args:['-e','process.on("SIGTERM",()=>process.exit(42));process.stderr.write("ready");setInterval(()=>{},1000);'].map(bytes),inputChannels:[1],outputChannels:[2,3],maxFrameBytes:4096});
 const execution=executeRemoteProcess({stdin:toByteSource(new Uint8Array()),stdout:{async write(){}},stderr:{async write(){ready();}},signal:new AbortController().signal},async()=>connection,(_name,number)=>128+number);
 await started;connection.signal!('SIGTERM');assert.deepEqual(await execution,{exitCode:42});
});
test('FFmpeg signal handler preserves its explicit exit status and final stderr',{timeout:2000},async()=>{
 const signals=createProcessSignalChannel();let ready!:()=>void;
 const started=new Promise<void>(resolve=>{ready=resolve;});let diagnostic='';
 const native=await connection(['-hide_banner','-re','-f','lavfi','-i','sine=sample_rate=8000:duration=60','-f','s16le','pipe:1']);
 const projection=()=>{throw new Error('An explicit FFmpeg status must not be projected as signal-only');};
 const execution=executeRemoteProcess({stdin:toByteSource(''),stdout:{async write(){}},stderr:{async write(chunk){
  diagnostic+=new TextDecoder().decode(chunk);if(diagnostic.includes('Press [q]'))ready();
 }},signal:new AbortController().signal,processSignals:signals},async()=>native,projection);
 await started;await signals.send({name:'SIGINT',number:2,target:'process-group'});
 const result=await execution;const outcome=await native.outcome;
 assert.equal(outcome.kind,'exited');
 if(outcome.kind!=='exited')throw new Error('Expected the native FFmpeg signal handler to exit explicitly');
 assert.equal(result.exitCode,outcome.exitCode);assert.notEqual(result.exitCode,130);
 assert.ok(diagnostic.includes('received signal 2'),diagnostic);
 assert.equal((await run([...synthesis,'pipe:1'])).result.exitCode,0);
});
test('cancellation retires an upload blocked by native stdin capacity and allows reuse',{timeout:3000},async()=>{
 const controller=new AbortController();const cause=new Error('cancel blocked native upload');
 const native=createProcessConnection({executable:process.execPath,cwd:'/',env:{},args:[
  '-e','process.stdin.pause();process.stderr.write("ready");setInterval(()=>{},1000);',
 ].map(bytes),inputChannels:[1],outputChannels:[2,3],maxFrameBytes:4096});
 let remote=native;
 if(process.env.REMOTE_PROCESS_HTTP==='1'){
  const identity={sessionId:'blocked-upload-oracle',epoch:crypto.randomUUID(),jobId:crypto.randomUUID()};
  const handler=createProcessHttpHandler({identity,connection:native,authorize:async request=>request.headers.get('Authorization')==='Bearer oracle-only',maxRequests:32});
  remote=await connectHttpProcess({identity,baseUrl:'https://oracle.test',token:async()=> 'oracle-only',fetch:async(input,init)=>handler(new Request(input,init))},controller.signal);
 }
 let blocked!:()=>void;const waiting=new Promise<void>(resolve=>{blocked=resolve;});
 const execution=executeRemoteProcess({stdin:toByteSource(new Uint8Array(2112000)),stdout:{async write(){}},stderr:{async write(){}},signal:controller.signal},async()=>({...remote,
  async send(channel,frame,offset,signal){
   const pending=remote.send(channel,frame,offset,signal);
   const timer=setTimeout(blocked,20);
   try{return await pending;}finally{clearTimeout(timer);}
  },
 }));
 const rejected=assert.rejects(execution,error=>error===cause);
 await waiting;controller.abort(cause);await rejected;
 const outcome=await native.outcome;assert.ok(outcome.kind==='signaled'||outcome.kind==='exited');
 assert.equal((await run([...synthesis,'pipe:1'])).result.exitCode,0);
});
test('cancellation retires a blocked authenticated native output read and allows reuse',{timeout:3000},async()=>{
 const controller=new AbortController();const cause=new Error('cancel blocked remote read');
 const native=createProcessConnection({executable:process.execPath,cwd:'/',env:{},args:[
  '-e','process.stderr.write("ready");setInterval(()=>{},1000);',
 ].map(bytes),inputChannels:[1],outputChannels:[2,3],maxFrameBytes:4096});
 const identity={sessionId:'blocked-read-oracle',epoch:crypto.randomUUID(),jobId:crypto.randomUUID()};
 const handler=createProcessHttpHandler({identity,connection:native,authorize:async request=>request.headers.get('Authorization')==='Bearer oracle-only',maxRequests:1});
 let ready!:()=>void;const started=new Promise<void>(resolve=>{ready=resolve;});
 let cleanup:(()=>Promise<void>)|undefined;const delivered:Uint8Array[]=[];
 const execution=executeRemoteProcess({stdin:toByteSource(''),stdout:{async write(chunk){delivered.push(chunk.slice());}},stderr:{async write(){ready();}},signal:controller.signal,
  registerCleanup(close){cleanup=close;},
 },async signalContext=>{
  assert.ok(cleanup,'Cleanup must precede transport acquisition');
  return connectHttpProcess({identity,baseUrl:'https://oracle.test',token:async()=> 'oracle-only',fetch:async(input,init)=>handler(new Request(input,init))},signalContext.signal);
 });
 const rejected=assert.rejects(execution,error=>error===cause);
 await started;assert.equal(native.outputs.get(2)!.locked,true);
 controller.abort(cause);await rejected;await cleanup!();
 const outcome=await native.outcome;assert.ok(outcome.kind==='signaled'||outcome.kind==='exited');
 assert.equal(delivered.length,0);
 assert.equal((await run([...synthesis,'pipe:1'])).result.exitCode,0);
});
test('a delegate retaining pipes is terminated after its leader exits',{timeout:2000},async()=>{
 const delegate='process.stdout.write("ready");setInterval(()=>{},1000)';
 const code=`const {spawn}=require('node:child_process');const child=spawn(process.execPath,['-e',${JSON.stringify(delegate)}],{stdio:['ignore','pipe','inherit']});child.stdout.once('data',()=>process.exit(7));`;
 const run=createNativeLauncher().launch({executable:process.execPath,cwd:'/',env:{},args:['-e',code].map(bytes),inputChannels:[],outputChannels:[2,3],maxFrameBytes:4096},{async output(){},async end(){}});
 assert.deepEqual(await run.exit,{kind:'exited',exitCode:7});run.signal('SIGTERM');await run.settled;
});
test('supplied -nostdin remains a native option rather than an injected workaround',{timeout:2000},async()=>{
 const result=await run(['-nostdin',...synthesis,'pipe:1'],toByteSource('q\n'));
 assert.equal(result.result.exitCode,0);assert.equal(result.stdout.length,160);assert.equal(result.stderr.includes('Press [q]'),false);
});
test('command settlement retires a delegate holding stderr after its leader exits',{timeout:3000},async()=>{
 const delegate='process.stdout.write("ready");setInterval(()=>{},1000)';
 const code=`const {spawn}=require('node:child_process');const child=spawn(process.execPath,['-e',${JSON.stringify(delegate)}],{stdio:['ignore','pipe','inherit']});child.stdout.once('data',()=>{process.stdout.write('leader');process.exit(7)});`;
 const stdout:Uint8Array[]=[];
 const result=await executeRemoteProcess({stdin:toByteSource(new Uint8Array()),stdout:{async write(b){stdout.push(b.slice());}},stderr:{async write(){}},signal:new AbortController().signal},async()=>createProcessConnection({executable:process.execPath,cwd:'/',env:{},args:['-e',code].map(bytes),inputChannels:[1],outputChannels:[2,3],maxFrameBytes:8}));
 assert.equal(result.exitCode,7);assert.equal(Buffer.concat(stdout).toString(),'leader');
 assert.equal((await run([...synthesis,'pipe:1'])).result.exitCode,0);
});
test('native positional stdin read preserves ESPIPE for pipes and succeeds on a redirected file',{timeout:2000},async()=>{
 const code='const fs=require("node:fs");try{const b=Buffer.alloc(1);fs.readSync(0,b,0,1,1);process.stdout.write(b)}catch(e){process.stderr.write(e.code);process.exitCode=73}';
 async function execute(stdio?:readonly ('pipe'|number)[]) {
  const stderr:Uint8Array[]=[];
  const connection=createProcessConnection({executable:process.execPath,cwd:'/',env:{},args:['-e',code].map(bytes),inputChannels:stdio?[]:[1],outputChannels:[2,3],maxFrameBytes:4096,stdio});
  const result=await executeRemoteProcess({stdin:toByteSource(new Uint8Array([1,2])),stdout:{async write(){}},stderr:{async write(b){stderr.push(b);}},signal:new AbortController().signal,
   ...(stdio?{stdinInput:{position:0,async read(){throw new Error('Native descriptor must be used');},async seek(){}}}:{}),
  },async()=>connection);
  return{result,stderr:Buffer.concat(stderr).toString()};
 }
 const pipe=await execute();assert.equal(pipe.result.exitCode,73);assert.equal(pipe.stderr,'ESPIPE');
 const descriptor=openSync(fileURLToPath(new URL('../../../docs/remote-media/baselines/native-visual.png',import.meta.url)),'r');
 try{const stat=fstatSync(descriptor);assert.ok(stat.isFile()&&stat.size<1048576);const file=await execute([descriptor,'pipe','pipe']);assert.equal(file.result.exitCode,0);assert.equal(file.stderr,'');}finally{closeSync(descriptor);}
});
test('installed native duplicate descriptors share the open cursor while independent opens do not',{timeout:2000},async()=>{
 const filename=fileURLToPath(new URL('../../../docs/remote-media/baselines/native-visual.png',import.meta.url));
 const code='const fs=require("node:fs");const b=Buffer.alloc(4);fs.readSync(0,b,0,2,null);fs.readSync(3,b,2,2,null);process.stdout.write(b)';
 async function execute(first:number,extra:number){
  const stdout:Uint8Array[]=[];
  const native=createProcessConnection({executable:process.execPath,cwd:'/',env:{},args:['-e',code].map(bytes),inputChannels:[],outputChannels:[2,3],maxFrameBytes:4096,stdio:[first,'pipe','pipe',extra]});
  const result=await executeRemoteProcess({stdin:toByteSource(''),stdinInput:{position:0,async read(){throw new Error('Installed native descriptor must be used');},async seek(){}},stdout:{async write(value){stdout.push(value.slice());}},stderr:{async write(){}},signal:new AbortController().signal},async()=>native);
  assert.equal(result.exitCode,0);return Buffer.concat(stdout);
 }
 const duplicate=openSync(filename,'r');try{assert.deepEqual(await execute(duplicate,duplicate),Buffer.from([137,80,78,71]));}finally{closeSync(duplicate);}
 const first=openSync(filename,'r');const second=openSync(filename,'r');try{assert.deepEqual(await execute(first,second),Buffer.from([137,80,137,80]));}finally{closeSync(first);closeSync(second);}
});
test('early binary stdout closure drains native stderr and retains the native explicit status',{timeout:2500},async()=>{
 const args=['-hide_banner','-f','lavfi','-i','sine=sample_rate=8000:duration=60','-f','s16le','pipe:1'];
 const child=spawn(executable!,args,{cwd:'/',env:{},stdio:['pipe','pipe','pipe'],shell:false});
 const observed=new Promise<number|null>((resolve,reject)=>{child.once('error',reject);child.once('close',resolve);});
 child.stdin.on('error',()=>{});child.stdin.end();child.stderr.resume();child.stdout.once('data',()=>child.stdout.destroy());
 const expected=await observed;assert.notEqual(expected,null);assert.notEqual(expected,0);
 const diagnostic:Uint8Array[]=[];const cause=Object.assign(new Error('closed media consumer'),{code:'EPIPE'});
 const native=await connection(args);
 const result=await executeRemoteProcess({stdin:toByteSource(''),stdout:{async write(){throw cause;}},stderr:{async write(value){diagnostic.push(value.slice());}},signal:new AbortController().signal},async()=>native,(_name,number)=>128+number);
 // FFmpeg's final error can vary with how much output precedes pipe closure.
 // Verify projection against this invocation's native observation, rather than
 // requiring two independently scheduled runs to choose the same final error.
 const outcome=await native.outcome;assert.equal(outcome.kind,'exited');
 if(outcome.kind!=='exited')throw new Error('Expected an explicit native exit');
 assert.notEqual(outcome.exitCode,0);assert.equal(result.exitCode,outcome.exitCode);
 // Darwin can report ENOTCONN where Linux reports EPIPE. Both retain the
 // muxing failure and final diagnostic after the consumer has closed stdout.
 const stderr=Buffer.concat(diagnostic).toString();
 assert.ok(stderr.includes('Error muxing a packet'),stderr);
 assert.ok(stderr.includes('Conversion failed!'),stderr);
});

test('actual shell ffmpeg pipeline drains 32-byte capacity and publishes both native statuses',{timeout:3000},async()=>{
 const {shell}=setup({limits:{pipeHighWaterMark:32}});
 shell.register({name:'ffmpeg',execute(context){
  return executeRemoteProcess(context,async()=>connection([...context.args]));
 }});
 try{
  const result=await shell.exec('ffmpeg -hide_banner -f lavfi -i sine=sample_rate=8000:duration=0.01 -f s16le pipe:1 | ffmpeg -hide_banner -f s16le -ar 8000 -ac 1 -i pipe:0 -progress pipe:2 -f s16le pipe:1; statuses=("${PIPESTATUS[@]}"); err "${statuses[@]}"');
  assert.equal(result.exitCode,0,result.stderr);assert.equal(result.stdoutBytes.length,160);
  assert.ok(result.stderr.includes('progress=end'));assert.ok(result.stderr.endsWith('0 0\n'));
 }finally{await shell.dispose();}
});

test('actual shell pipe:3 input and pipe:4 output retain binary bytes and descriptor cleanup',{timeout:2000},async()=>{
 const {shell,fs}=setup();
 const media=Uint8Array.from([113,255,1,10]);
 shell.register({name:'ffmpeg',execute(context){
  const args=getCommandArguments(context);
  return executeRemoteProcess(context,async()=>{
   const native=createProcessConnection({executable:executable!,cwd:'/',env:{},args:context.args.map((_arg,index)=>Array.from(args.bytes(index))),inputChannels:[1,4],outputChannels:[2,3,5],maxFrameBytes:4});
   if(process.env.REMOTE_PROCESS_HTTP!=='1')return native;
   const identity={sessionId:'shell-descriptor-oracle',epoch:crypto.randomUUID(),jobId:crypto.randomUUID()};
   const handler=createProcessHttpHandler({identity,connection:native,authorize:async request=>request.headers.get('Authorization')==='Bearer oracle-only',maxRequests:32});
   return connectHttpProcess({identity,baseUrl:'https://oracle.test',token:async()=> 'oracle-only',fetch:async(input,init)=>handler(new Request(input,init))},context.signal);
  });
 }});
 try{
  const result=await shell.exec("ffmpeg -hide_banner -f s16le -ar 8000 -ac 1 -i pipe:3 -progress pipe:2 -f s16le pipe:4 3<<<$'q\\xff\\x01' 4>/output");
  assert.equal(result.exitCode,0,result.stderr);assert.equal(result.stdoutBytes.length,0);
  assert.deepEqual(await fs.readFile('/output'),media);assert.ok(result.stderr.includes('progress=end'));
  const next=await shell.exec('say subsequent');assert.equal(next.stdout,'subsequent\n');
 }finally{await shell.dispose();}
});

for(const handler of [false,true]) {
test(`actual shell ordered signal preserves ${handler?'handler exit 42':'signal-only status 130'}`,{timeout:2000},async()=>{
 const {shell}=setup();const signals=createProcessSignalChannel();
 let ready!:()=>void;const started=new Promise<void>(resolve=>{ready=resolve;});
 const code=(handler?'process.on("SIGINT",()=>process.exit(42));':'')+'process.stderr.write("ready");setInterval(()=>{},1000);';
 shell.register({name:'native',execute(context){
  return executeRemoteProcess(context,async()=>{
   const native=createProcessConnection({executable:process.execPath,cwd:'/',env:{},args:['-e',code].map(bytes),inputChannels:[1],outputChannels:[2,3],maxFrameBytes:8});
   if(process.env.REMOTE_PROCESS_HTTP!=='1')return native;
   const identity={sessionId:'shell-signal-oracle',epoch:crypto.randomUUID(),jobId:crypto.randomUUID()};
   const endpoint=createProcessHttpHandler({identity,connection:native,authorize:async request=>request.headers.get('Authorization')==='Bearer oracle-only',maxRequests:32});
   return connectHttpProcess({identity,baseUrl:'https://oracle.test',token:async()=> 'oracle-only',fetch:async(input,init)=>endpoint(new Request(input,init))},context.signal);
  },(_name,number)=>128+number);
 }});
 try{
  const execution=shell.exec('native',{processSignals:signals,stderr:{async write(chunk){if(chunk.length)ready();}}});
  await started;
  const accepted=await signals.send({name:'SIGINT',number:2,target:'process-group'});
  assert.equal(accepted.sequence,1n);
  const result=await execution;assert.equal(result.exitCode,handler?42:130);
  assert.equal((await shell.exec('say subsequent')).stdout,'subsequent\n');
 }finally{await shell.dispose();}
});
}
