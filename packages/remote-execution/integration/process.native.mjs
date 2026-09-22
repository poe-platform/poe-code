import{test}from'node:test';import assert from'node:assert/strict';
import{createNativeLauncher}from'./native-process.js';
import{createNativeDriver}from'./native-driver.js';
const launcher=createNativeLauncher();const bytes=s=>Array.from(new TextEncoder().encode(s));
const spec=(executable,args,extra={})=>({executable,args:args.map(bytes),cwd:'/scratch',env:{},inputChannels:[1],outputChannels:[2,3],maxFrameBytes:4096,...extra});
test('native driver refuses replaced protocol pipes and retires their namespace before real launch',async()=>{
 for(const fd of [0,1,2])for(const replacement of ['ignore',1]){
  let launches=0;let closed=0;
  const stdio=['pipe','pipe','pipe'];stdio[fd]=replacement;
  const driver=createNativeDriver({launcher:{launch(...args){launches++;return launcher.launch(...args);}},backend:{features:[],async inspectBuild(){throw new Error('Unused fixture lookup');},async admitSession(){return{async close(){},async prepare(){return{cwd:'/scratch',env:{},stdio,async close(){closed++;}};}};}}});
  const signal=new AbortController().signal;
  const authority=await driver.admitSession({principal:{tenantId:'fixture',principalId:'owner',expiresAt:Date.now()+10000},request:{},signal});
  try{
   await assert.rejects(authority.prepare({jobId:'fixture-job',tool:{executable:'/usr/local/bin/node'},build:{runtimeEnvironment:{}},request:{args:[bytes('-e'),bytes('process.exit(0)')],env:{},stdin:{kind:'stream'},descriptors:[],limits:{maxArgvBytes:4096,maxFrameBytes:4096}},hooks:{},signal}),{message:'An admitted channel must map to an installed native pipe'});
   assert.equal(launches,0);assert.equal(closed,1);
  }finally{await authority.close();}
 }
});
test('native driver retires excessive directional streams before invoking the real process API',async()=>{
 for(const right of ['read','write']){
  let launches=0;let closed=0;
  const driver=createNativeDriver({launcher:{launch(...args){launches++;return launcher.launch(...args);}},backend:{features:[],async inspectBuild(){throw new Error('Unused fixture lookup');},async admitSession(){return{async close(){},async prepare(){return{cwd:'/scratch',env:{},async close(){closed++;}};}};}}});
  const signal=new AbortController().signal;
  const authority=await driver.admitSession({principal:{tenantId:'fixture',principalId:'owner',expiresAt:Date.now()+10000},request:{},signal});
  try{
   const count=right==='read'?64:63;
   const descriptors=Array.from({length:count},(_,index)=>({fd:index+3,openDescriptionId:String(index),rights:[right],seekable:false}));
   await assert.rejects(authority.prepare({jobId:'fixture-job',tool:{executable:'/usr/local/bin/node'},build:{runtimeEnvironment:{}},request:{args:[bytes('-e'),bytes('process.exit(0)')],env:{},stdin:{kind:'stream'},descriptors,limits:{maxArgvBytes:4096,maxFrameBytes:4096}},hooks:{},signal}),{message:'Native stream capacity exceeded'});
   assert.equal(launches,0);assert.equal(closed,1);
  }finally{await authority.close();}
 }
});
test('real process streams the exact output channel ceiling without merging descriptor bytes',async()=>{
 const received=new Map();const ended=new Set();
 const outputChannels=Array.from({length:64},(_,index)=>index+2);
 const run=launcher.launch(spec('/usr/local/bin/node',['-e',"const fs=require('node:fs');for(let fd=1;fd<=64;fd++)fs.writeSync(fd,Uint8Array.of(fd));"],{outputChannels}),{
  async output(channel,chunk){const previous=received.get(channel)??[];received.set(channel,[...previous,...chunk]);},
  async end(channel){ended.add(channel);},
 });
 try{
  await run.end(1);assert.deepEqual(await run.exit,{kind:'exited',exitCode:0});await run.settled;
  assert.equal(ended.size,64);assert.equal(received.size,64);
  for(const channel of outputChannels){assert.deepEqual(received.get(channel),[channel-1]);assert.ok(ended.has(channel));}
 }finally{await run.terminateGroup();await run.settled;}
});
test('real launcher rejects unowned pipes before starting a process',()=>{
 let launches=0;
 const bounded=createNativeLauncher({spawn(){launches++;throw new Error('Unadmitted process started');}});
 for(const fd of [0,1,2,3]){
  const inputChannels=fd===0?[]:[1];
  const outputChannels=[2,3].filter(channel=>channel!==fd+1);
  const stdio=Array.from({length:fd===3?4:3},()=> 'pipe');
  assert.throws(()=>bounded.launch(spec('/usr/local/bin/node',['-e','process.exit(0)'],{inputChannels,outputChannels,stdio}),{async output(){},async end(){}}),{message:'A native pipe must have an admitted channel owner'});
 }
 assert.equal(launches,0);
});
test('native driver refuses descriptor overflow before isolated preparation or real spawn',async()=>{
 let preparations=0;let launches=0;
 const driver=createNativeDriver({launcher:{launch(...args){launches++;return launcher.launch(...args);}},backend:{limits:{maxHandles:1},features:[],async inspectBuild(){throw new Error('Unused fixture build lookup');},async admitSession(){return{async close(){},async prepare(){preparations++;return{cwd:'/scratch',env:{},async close(){}};}};}}});
 const signal=new AbortController().signal;
 const authority=await driver.admitSession({principal:{tenantId:'fixture',principalId:'owner',expiresAt:Date.now()+10000},request:{},signal});
 try{
  const descriptors=[3,4].map(fd=>({fd,openDescriptionId:String(fd),rights:['read'],seekable:false}));
  await assert.rejects(authority.prepare({jobId:'fixture-job',tool:{executable:'/usr/local/bin/node'},build:{runtimeEnvironment:{}},request:{args:[bytes('-e'),bytes('process.exit(0)')],env:{},stdin:{kind:'stream'},descriptors,limits:{maxArgvBytes:4096,maxFrameBytes:4096,maxHandles:2}},hooks:{},signal}),{message:'Native descriptor count bound'});
  assert.equal(preparations,0);assert.equal(launches,0);
 }finally{await authority.close();}
});
test('real Node spawn preserves absent environment keys despite ambient coverage and prototype entries',async()=>{
 const previous=process.env.NODE_V8_COVERAGE;const outputs=[];let run;
 process.env.NODE_V8_COVERAGE='/scratch/server-private-coverage';
 Object.defineProperty(Object.prototype,'REMOTE_EXECUTION_AMBIENT',{value:'server-secret',enumerable:true,configurable:true});
 try{
  run=launcher.launch(spec('/usr/local/bin/node',['-e','process.stdout.write(JSON.stringify(process.env))'],{env:{VALUE:'',NODE_OPTIONS:''}}),{async output(channel,chunk){assert.equal(channel,2);outputs.push(chunk.slice());},async end(){}});
 }finally{
  delete Object.prototype.REMOTE_EXECUTION_AMBIENT;
  if(previous===undefined)delete process.env.NODE_V8_COVERAGE;else process.env.NODE_V8_COVERAGE=previous;
 }
 try{
  await run.end(1);assert.deepEqual(await run.exit,{kind:'exited',exitCode:0});await run.settled;
  assert.deepEqual(JSON.parse(Buffer.concat(outputs).toString()),{VALUE:'',NODE_OPTIONS:''});
 }finally{await run.terminateGroup();await run.settled;}
});
test('native stdin admission uses the actual byte span and snapshots accepted bytes',async()=>{
 const outputs=[];
 const run=launcher.launch(spec('/usr/local/bin/node',['-e','process.stdin.pipe(process.stdout)'],{maxFrameBytes:8}),{
  async output(channel,chunk){assert.equal(channel,2);outputs.push(chunk);},async end(){},
 });
 try{
  const oversized=new Uint8Array(9);Object.defineProperty(oversized,'length',{value:1});
  await assert.rejects(run.write(1,oversized),{message:'Input frame length exceeds admission'});
  await assert.rejects(run.write(1,{length:1,0:7}),{message:'Native input bytes required'});
  const accepted=new Uint8Array([0,255,128]);
  const writing=run.write(1,accepted);accepted.fill(7);await writing;await run.end(1);
  assert.deepEqual(await run.exit,{kind:'exited',exitCode:0});await run.settled;
  assert.deepEqual(Buffer.concat(outputs),Buffer.from([0,255,128]));
 }finally{await run.terminateGroup();await run.settled;}
});
test('retired stdout retains a failed accepted receipt independently of native exit and stderr',async()=>{
 let admitted;let rejectReceipt;
 const ready=new Promise(resolve=>{admitted=resolve;});
 const receipt=new Promise((_resolve,reject)=>{rejectReceipt=reject;});
 const failure=Object.assign(new Error('accepted stdout frame failed'),{code:'EPIPE'});
 const stderr=[];
 const run=launcher.launch(spec('/usr/local/bin/node',['-e','process.stdout.write("output");process.stderr.write("diagnostic");process.exitCode=23;']),{
  output(channel,chunk){if(channel===2){admitted();return receipt;}stderr.push(chunk.slice());return Promise.resolve();},async end(){},
 });
 const settlement=run.settled.catch(cause=>cause);
 try{
  await run.end(1);await ready;
  run.closeOutput(2);rejectReceipt(failure);
  assert.deepEqual(await run.exit,{kind:'exited',exitCode:23});
  assert.equal(await settlement,failure);
  assert.equal(Buffer.concat(stderr).toString(),'diagnostic');
 }finally{await run.terminateGroup();await settlement;}
});
test('real process retains admitted stdin channel authority without rereading entries',async()=>{
 let reads=0;const inputChannels=[1];const outputs=[];
 Object.defineProperty(inputChannels,0,{get(){return ++reads===1?1:4;}});
 const run=launcher.launch(spec('/usr/local/bin/node',['-e','process.stdin.pipe(process.stdout)'],{inputChannels}),{async output(channel,chunk){assert.equal(channel,2);outputs.push(chunk);},async end(){}});
 try{
  await assert.rejects(run.write(4,new Uint8Array([9])),TypeError);
  await run.write(1,new Uint8Array([0,255,128]));await run.end(1);
  assert.deepEqual(await run.exit,{kind:'exited',exitCode:0});await run.settled;
  assert.deepEqual(Buffer.concat(outputs),Buffer.from([0,255,128]));assert.equal(reads,1);
 }finally{await run.terminateGroup();await run.settled;}
});
test('real process uses the executable, cwd and env snapshot admitted from accessors',async()=>{
 const reads={executable:0,cwd:0,env:0,value:0};const outputs=[];
 const env={get VALUE(){return ++reads.value===1?'admitted':'changed';}};
 const input=spec('/usr/local/bin/node',['-e','process.stdout.write(JSON.stringify({cwd:process.cwd(),value:process.env.VALUE}))']);
 Object.defineProperties(input,{
  executable:{get(){return ++reads.executable===1?'/usr/local/bin/node':'/bin/false';}},
  cwd:{get(){return ++reads.cwd===1?'/scratch':'/app';}},
  env:{get(){reads.env++;return env;}},
 });
 const run=launcher.launch(input,{async output(channel,chunk){assert.equal(channel,2);outputs.push(chunk);},async end(){}});
 try{
  await run.end(1);assert.deepEqual(await run.exit,{kind:'exited',exitCode:0});await run.settled;
  assert.deepEqual(JSON.parse(Buffer.concat(outputs).toString()),{cwd:'/scratch',value:'admitted'});
  assert.deepEqual(reads,{executable:1,cwd:1,env:1,value:1});
 }finally{await run.terminateGroup();await run.settled;}
});
test('native driver launches admitted octets without rereading caller accessors',async()=>{
 let reads=0;const token=[65];Object.defineProperty(token,0,{get:()=>++reads===1?65:255});
 const signal=new AbortController().signal;const outputs=[];let released=0;
 const driver=createNativeDriver({backend:{features:[],async inspectBuild(){throw new Error('Not used by this process fixture');},async admitSession(){return{async close(){},async prepare(input){assert.deepEqual(input.request.args.at(-1),[65]);return{cwd:'/scratch',env:{},async close(){released++;}};}};}}});
 const authority=await driver.admitSession({principal:{tenantId:'fixture',principalId:'owner',expiresAt:Date.now()+10000},request:{},signal});
 let invocation;
 try{
  invocation=await authority.prepare({jobId:'fixture-job',tool:{executable:'/usr/local/bin/node'},build:{runtimeEnvironment:{}},request:{args:[bytes('-e'),bytes('process.stdout.write(JSON.stringify(process.argv.slice(1)))'),[],token],env:{},stdin:{kind:'stream'},descriptors:[],limits:{maxArgvBytes:4096,maxFrameBytes:4096}},hooks:{},signal});
  const run=invocation.start({async output(channel,chunk){assert.equal(channel,2);outputs.push(chunk);},async end(){}});
  await run.end(1);assert.deepEqual(await run.exit,{kind:'exited',exitCode:0});await run.settled;
  assert.equal(Buffer.concat(outputs).toString(),'["","A"]');assert.equal(reads,1);
 }finally{await invocation?.close();await authority.close();}
 assert.equal(released,1);
});
test('literal argv, empty tokens, stdin EOF and extra descriptors stay separate',async()=>{
 const outputs={2:[],3:[],4:[]};const ended=[];const code='const fs=require("node:fs");process.stdin.resume();process.stdin.on("end",()=>{process.stdout.write(JSON.stringify(process.argv.slice(1)));fs.writeSync(3,Buffer.from([0,255,128]));process.stderr.write("diagnostic");process.exitCode=1;})';
 const run=launcher.launch(spec('/usr/local/bin/node',['-e',code,'','$(id)','a b'],{outputChannels:[2,3,4]}),{async output(c,b){outputs[c].push(b.slice());},async end(c){ended.push(c);}});await run.end(1);assert.deepEqual(await run.exit,{kind:'exited',exitCode:1});await run.settled;
 assert.equal(Buffer.concat(outputs[2]).toString(),'["","$(id)","a b"]');assert.deepEqual(Buffer.concat(outputs[4]),Buffer.from([0,255,128]));assert.equal(Buffer.concat(outputs[3]).toString(),'diagnostic');assert.deepEqual(ended.sort(),[2,3,4]);
});
test('native signal and structured spawn errno remain distinct',async()=>{
 const run=launcher.launch(spec('/usr/local/bin/node',['-e','setInterval(()=>{},1000)']),{async output(){},async end(){}});await run.end(1);run.signal('SIGTERM');assert.deepEqual(await run.exit,{kind:'signaled',signal:'SIGTERM',signalNumber:15});await run.settled;
 const failed=launcher.launch(spec('/does-not-exist',[],{inputChannels:[]}),{async output(){},async end(){}});assert.equal((await failed.exit).kind,'spawnError');assert.equal((await failed.exit).code,'ENOENT');await failed.settled;
});
test('process-group cleanup retires a delegate after its leader exits', {timeout:2500},async()=>{
 const code="const {spawn}=require('node:child_process');const child=spawn('/bin/sleep',['60'],{stdio:['ignore','inherit','inherit']});child.once('spawn',()=>process.exit(7));";
 const run=launcher.launch(spec('/usr/local/bin/node',['-e',code],{inputChannels:[]}),{async output(){},async end(){}});
 try{
  assert.deepEqual(await run.exit,{kind:'exited',exitCode:7});
  let settled=false;void run.settled.then(()=>{settled=true;});await Promise.resolve();
  assert.equal(settled,false);
  await run.terminateGroup();await run.settled;
  assert.deepEqual(await run.exit,{kind:'exited',exitCode:7});
 }finally{await run.terminateGroup();await run.settled;}
});
