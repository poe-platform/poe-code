import assert from 'node:assert/strict';
import test from 'node:test';
import {toByteSource} from 'safe-bash-contracts';
import {createPythonExecutorCommands} from './executor.js';
import {MemoryFileSystem} from '@poe-code/safe-fs/core';
import {createPythonPackageEnvironment} from './provisioning.js';
import {installPythonPackages} from './provisioning-runtime.js';

 test('host record transport omits metadata from startup and retains session snapshots',async()=>{
 const fs=new MemoryFileSystem(),context={fs,cwd:'/',signal:new AbortController().signal};
 const env=createPythonPackageEnvironment(),first=await env.prepare(context);
 const records=Array.from({length:64},(_,index)=>['fixture'+index,'x'.repeat(16385)+'😀','',[],[],null] as const);
 try{
  await env.dispatch('package-commit',[first.session,{version:3,installed:['fixture==1'],records}],context);
  await env.finish(first);
  const start=await env.prepare({...context,recordTransport:'host'});
  try{
   assert.equal(start.records,undefined);assert.equal(start.recordCount,64);
   assert.ok(JSON.stringify(start).length<1024,'startup must not copy the saved record array');
   const expected=JSON.stringify(records[63]);let text='';
   for(let offset=0;;offset+=8192){
    const chunk=await env.dispatch('package-record-read',[start.session,63,offset],context);
    assert.equal(typeof chunk,'string');assert.ok((chunk as string).length<=8192);
    text+=chunk;if((chunk as string).length<8192)break;
   }
   assert.equal(text,expected);
   await assert.rejects(env.dispatch('package-record-read',[start.session,64,0],context),/record/);
   await assert.rejects(env.dispatch('package-record-read',[start.session,0,-1],context),/record/);
  }finally{await env.finish(start);}
  await assert.rejects(env.dispatch('package-record-read',[start.session,0,0],context));
  const inline=await env.prepare(context);
  try{assert.deepEqual(inline.records,records);assert.equal(inline.recordCount,undefined);}finally{await env.finish(inline);}
 }finally{await env.finish(first);await env.dispose();}
 assert.deepEqual(await fs.readdir('/'),[]);
});

 test('native installer reads host records in bounded messages without inline metadata',async()=>{
 const globals=new Map<string,unknown>(),rows=[['fixture','x'.repeat(8179)+'😀'+'x'.repeat(22000)+'😀','',[],[],null]],wire=JSON.stringify(rows[0]);
 const offsets:number[]=[];let committed:unknown;
 const runtime={version:'314.0.6',_api:{lockfile_packages:{},packageManager:{defaultChannel:'default',async installPackage(){},async downloadPackage(){}}},
  globals:{set(name:string,value:unknown){globals.set(name,value);},delete(name:string){globals.delete(name);}},async loadPackage(){},
  async runPythonAsync(){
   const record=globals.get('_safe_package_record') as (operation:string,key?:unknown,value?:unknown)=>Promise<unknown>;
   assert.equal(await record('start'),1);
   const read=async(operation:string,key:unknown)=>{let wire='';for(let offset=0;;){const chunk=await record(operation,key,offset);assert.equal(typeof chunk,'string');assert.ok((chunk as string).length<=8192);assert.ok(!(chunk as string).length||((chunk as string).charCodeAt((chunk as string).length-1)<0xd800||(chunk as string).charCodeAt((chunk as string).length-1)>0xdbff));if(!chunk)return JSON.parse(wire);wire+=chunk;offset+=(chunk as string).length;}};
   assert.deepEqual(await read('read',0),rows[0]);
   await record('add','fixture',0);await record('seal');
   assert.deepEqual(await read('get','fixture'),rows[0]);
   assert.equal(await record('get','missing',0),'null');
   await record('append',wire);await record('pin',JSON.stringify('fixture==1'));
  },runPython(){throw new Error('whole inventory serialization');}};
 await installPythonPackages(runtime as never,{session:'1',requirements:['fixture==1'],restore:[],recordCount:1,offline:true},async(operation,...args)=>{
  if(operation==='package-record-read'){assert.equal(args[1],0);const offset=args[2] as number;offsets.push(offset);return wire.slice(offset,offset+8192);}
  if(operation==='package-index'&&args[1]==='records-get')return args[2]==='fixture'?0:null;
  if(operation==='package-commit')committed=args[1];
 },65536);
 assert.deepEqual(committed,{version:3,installed:['fixture==1'],records:rows});
 assert.deepEqual(offsets,[0,8191,16383,24575,wire.length,0,8191,16383,24575,wire.length]);assert.equal(globals.size,0);
});

for(const mode of [undefined,'host','inline'] as const)test('executor selects host records and preserves explicit inline compatibility: '+mode,async()=>{
 const fs=new MemoryFileSystem(),base={fs,cwd:'/',signal:new AbortController().signal};
 const env=createPythonPackageEnvironment(),seed=await env.prepare(base),rows=[['fixture','Name: fixture','',[],[],null] as const];
 await env.dispatch('package-commit',[seed.session,{version:3,installed:['fixture==1'],records:rows}],base);await env.finish(seed);
 const command=createPythonExecutorCommands({environment:env,...mode?{packageRecordTransport:mode}:{},createExecutor:()=>({
  async run(start){
   assert.ok(start.packages);
   if(mode==='inline'){assert.deepEqual(start.packages.records,rows);assert.equal(start.packages.recordCount,undefined);}
   else{assert.equal(start.packages.records,undefined);assert.equal(start.packages.recordCount,1);assert.equal(await start.dispatch({op:'package-record-read',args:[start.packages.session,0,0]}),JSON.stringify(rows[0]));}
   start.onReady();return 0;
  },terminate(){},
 })})[0]!;
 try{assert.equal((await command.execute({...base,command:'python',args:['-c','pass'],env:{},stdin:toByteSource(''),stdout:{async write(){}},stderr:{async write(){}}})).exitCode,0);}
 finally{await env.dispose();}
 assert.deepEqual(await fs.readdir('/'),[]);
});

 test('host records normalize version two provenance without changing field order',async()=>{
 const fs=new MemoryFileSystem(),context={fs,cwd:'/',signal:new AbortController().signal},env=createPythonPackageEnvironment();
 const first=await env.prepare(context),row=['fixture','Name: fixture','file:///fixture.whl',['a'],['b']] as const;
 try{
  await env.dispatch('package-commit',[first.session,{version:2,installed:['fixture==1'],records:[row]}],context);
  const restored=await env.prepare({...context,recordTransport:'host'});
  try{assert.equal(await env.dispatch('package-record-read',[restored.session,0,0],context),JSON.stringify([...row,null]));}
  finally{await env.finish(restored);}
 }finally{await env.finish(first);await env.dispose();}
});

 test('host record encoding never serializes a complete large metadata string',async()=>{
 const fs=new MemoryFileSystem(),context={fs,cwd:'/',signal:new AbortController().signal},env=createPythonPackageEnvironment();
 const first=await env.prepare(context),row=['fixture','x'.repeat(100000)+'😀\ud800','',[],[],null] as const;
 try{
  await env.dispatch('package-commit',[first.session,{version:3,installed:['fixture==1'],records:[row]}],context);
  const start=await env.prepare({...context,recordTransport:'host'}),expected=JSON.stringify(row);
  const original=JSON.stringify;let largest=0;
  JSON.stringify=((value:unknown,...args:unknown[])=>{
   if(typeof value==='string')largest=Math.max(largest,value.length);
   if(value===row||Array.isArray(value)&&value[1]===row[1])largest=Math.max(largest,row[1].length);
   return Reflect.apply(original,JSON,[value,...args]);
  }) as typeof JSON.stringify;
  try{
   let actual='';
   for(let offset=0;;offset+=8192){const chunk=await env.dispatch('package-record-read',[start.session,0,offset],context) as string;actual+=chunk;if(chunk.length<8192)break;}
   assert.equal(actual,expected);
   assert.ok(largest<=1024,`serialized a ${largest}-character value`);
   assert.equal(await env.dispatch('package-record-read',[start.session,0,0],context),expected.slice(0,8192));
   assert.equal(await env.dispatch('package-record-read',[start.session,0,37],context),expected.slice(37,8229));
   for(const offset of [8240,1000000,0,8192,0])assert.equal(await env.dispatch('package-record-read',[start.session,0,offset],context),expected.slice(offset,offset+8192));
   const offsets=[0,8192,41,16400];
   assert.deepEqual(await Promise.all(offsets.map(offset=>env.dispatch('package-record-read',[start.session,0,offset],context))),offsets.map(offset=>expected.slice(offset,offset+8192)));
  }finally{JSON.stringify=original;await env.finish(start);}
 }finally{await env.finish(first);await env.dispose();}
});

for(const abort of [false,true])test(`host record reads retire while pending; abort=${abort}`,async()=>{
 const fs=new MemoryFileSystem(),controller=new AbortController(),context={fs,cwd:'/',signal:controller.signal},env=createPythonPackageEnvironment();
 const first=await env.prepare(context);
 try{
  await env.dispatch('package-commit',[first.session,{version:3,installed:['fixture==1'],records:[['fixture','x'.repeat(100000),'',[],[],null]]}],context);
  const start=await env.prepare({...context,recordTransport:'host'});
  const pending=env.dispatch('package-record-read',[start.session,0,0],context);
  const rejected=assert.rejects(pending);
  if(abort)controller.abort(new Error('cancel record read'));
  await env.finish(start);await rejected;
 }finally{await env.finish(first);await env.dispose();}
 assert.deepEqual(await fs.readdir('/'),[]);
});
