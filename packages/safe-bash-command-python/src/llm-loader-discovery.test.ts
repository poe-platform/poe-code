import assert from 'node:assert/strict';
import test from 'node:test';
import {MemoryFileSystem} from '@poe-code/safe-fs/core';
import {createPythonLlmLoaderDiscovery} from './llm-loader-discovery.js';

const metadata={fragments:[['native','  Native fragment\n'],['native_1',null]],templates:[['native','Template 界']]};
function fixture(body=JSON.stringify(metadata)){
 let terminated=0;
 const discover=createPythonLlmLoaderDiscovery({plugins:['fixture'],createExecutor:()=>({terminate(){terminated++;},async run(start){
  start.onReady();const send=(value:any)=>start.host!.request({version:1,operation:'call',capability:'llm_loaders',value});
  assert.deepEqual(await send({op:'request'}),{plugins:['fixture']});
  for(let offset=0;offset<body.length;offset+=5)await send({op:'text',text:body.slice(offset,offset+5)});
  await send({op:'done'});return 0;
 }})});
 return {discover,terminated:()=>terminated};
}
test('native discovery returns ordered executable loader maps with original descriptions',async()=>{
 const f=fixture(),fs=new MemoryFileSystem(),signal=new AbortController().signal;
 const result=await f.discover({fs,cwd:'/',signal,maxBytes:1000});
 assert.deepEqual([...result.fragmentLoaders.keys()],['native','native_1']);
 assert.deepEqual([...result.templateLoaders.keys()],['native']);
 assert.equal(result.fragmentLoaders.get('native')!.description,'  Native fragment\n');
 assert.equal(result.fragmentLoaders.get('native_1')!.description,undefined);
 assert.equal(result.templateLoaders.get('native')!.description,'Template 界');
 assert.equal(typeof result.fragmentLoaders.get('native'),'function');
 assert.equal(typeof result.templateLoaders.get('native'),'function');
 assert.equal(f.terminated(),1);assert.deepEqual(await fs.readdir('/'),[]);
});
test('discovery metadata shares a finite byte allowance across both loader kinds',async()=>{
 const f=fixture(),fs=new MemoryFileSystem(),signal=new AbortController().signal;
 await assert.rejects(f.discover({fs,cwd:'/',signal,maxBytes:10}),/byte limit/);
 assert.equal(f.terminated(),1);assert.deepEqual(await fs.readdir('/'),[]);
});
for(const value of [{}, {fragments:[['duplicate',null],['duplicate','doc']],templates:[]}, {fragments:[['native',3]],templates:[]}])test('discovery rejects invalid native registrations '+JSON.stringify(value),async()=>{
 const f=fixture(JSON.stringify(value));
 await assert.rejects(f.discover({fs:new MemoryFileSystem(),cwd:'/',signal:new AbortController().signal,maxBytes:1000}),/Invalid native/);
 assert.equal(f.terminated(),1);
});
test('discovery cancellation retains caller ownership of interpreter retirement',async()=>{
 let began!:()=>void,release!:()=>void,retired=false;
 const started=new Promise<void>(resolve=>{began=resolve;}),termination=new Promise<void>(resolve=>{release=resolve;});
 const cleanups:Array<()=>void|Promise<void>>=[],controller=new AbortController(),fs=new MemoryFileSystem();
 const discover=createPythonLlmLoaderDiscovery({createExecutor:()=>({async terminate(){await termination;retired=true;},async run(start){start.onReady();began();await new Promise<void>(resolve=>start.signal.addEventListener('abort',()=>resolve(),{once:true}));return 0;}})});
 const pending=discover({fs,cwd:'/',signal:controller.signal,maxBytes:1000,registerCleanup:cleanup=>{cleanups.push(cleanup);}});
 await started;controller.abort(new Error('stop discovery'));
 try{assert.ok(cleanups.length>0);assert.equal(retired,false);}finally{release();}
 await assert.rejects(pending,/stop discovery/);await Promise.all(cleanups.map(cleanup=>cleanup()));assert.equal(retired,true);
});

for(const kind of ['fragments','templates'] as const)test('discovery selects only '+kind,async()=>{
 const discover=createPythonLlmLoaderDiscovery({createExecutor:()=>({terminate(){},async run(start){
  start.onReady();const send=(value:any)=>start.host!.request({version:1,operation:'call',capability:'llm_loaders',value});
  assert.deepEqual(await send({op:'request'}),{kind,plugins:[]});
  await send({op:'text',text:JSON.stringify({fragments:kind==='fragments'?metadata.fragments:[],templates:kind==='templates'?metadata.templates:[]})});
  await send({op:'done'});return 0;
 }})});
 const result=await discover({fs:new MemoryFileSystem(),cwd:'/',signal:new AbortController().signal,maxBytes:1000,kind});
 assert.equal(result.fragmentLoaders.size,kind==='fragments'?2:0);
 assert.equal(result.templateLoaders.size,kind==='templates'?1:0);
});
test('discovery charges retained metadata once to the caller budget',async()=>{
 const f=fixture();let admitted=0;
 await f.discover({fs:new MemoryFileSystem(),cwd:'/',signal:new AbortController().signal,maxBytes:1000,admitBytes(size){admitted+=size;}});
 assert.equal(admitted,new TextEncoder().encode(JSON.stringify(metadata)).length);
});
test('caller metadata admission failure stops discovery and retires its interpreter',async()=>{
 const f=fixture(),reason=new Error('caller metadata exhausted');let admissions=0;
 await assert.rejects(f.discover({fs:new MemoryFileSystem(),cwd:'/',signal:new AbortController().signal,maxBytes:1000,admitBytes(){admissions++;throw reason;}}),error=>error===reason);
 assert.equal(admissions,1);assert.equal(f.terminated(),1);
});
