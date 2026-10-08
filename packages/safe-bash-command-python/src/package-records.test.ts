import assert from 'node:assert/strict';
import test from 'node:test';
import {MemoryFileSystem} from '@poe-code/safe-fs/core';
import {createPythonPackageEnvironment} from './provisioning.js';
import {installPythonPackages} from './provisioning-runtime.js';

 test('saved record ordinals spill independently of preloaded names and retire at publication',async()=>{
 const fs=new MemoryFileSystem(),context={fs,cwd:'/',signal:new AbortController().signal},environment=createPythonPackageEnvironment(),start=await environment.prepare(context);
 const call=(operation:string,...args:unknown[])=>environment.dispatch('package-index',[start.session,operation,...args],context);
 try{
  await call('records-start');await call('names-start');await call('names-add','protected');await call('names-seal');
  for(let i=0;i<130;i++){
   assert.equal(await call('records-has','package-'+i),false);
   await call('records-add','package-'+i,i);
   assert.equal(await call('records-has','package-'+i),true);
  }
  await call('records-seal');
  assert.ok((await fs.readdir('/')).some(item=>item.name.startsWith('.zip-metadata-')));
  assert.equal(await call('records-get','package-0'),0);assert.equal(await call('records-get','package-129'),129);
  assert.equal(await call('records-get','missing'),null);assert.equal(await call('names-has','package-0'),false);
  await environment.dispatch('package-commit',[start.session,[]],context);
  assert.deepEqual(await fs.readdir('/'),[]);
 }finally{await environment.finish(start);await environment.dispose();}
});

test('installer transfers individual saved records without serializing the complete input or guest output',async()=>{
 const globals=new Map<string,unknown>(),calls:unknown[][]=[];
 const paths:string[]=[];
 const row=['fixture','Name: fixture\nVersion: 1\n','file:///fixture.whl',paths,[],null] as const;
 const expected=JSON.parse(JSON.stringify(row));
 const rows=Object.assign([row],{toJSON(){throw new Error('whole snapshot serialization');}});
 const ordinal=new Map<string,number>();let committed:unknown;
 const runtime={version:'314.0.6',_api:{lockfile_packages:{},packageManager:{defaultChannel:'default',async installPackage(){},async downloadPackage(){}}},
  globals:{set(name:string,value:unknown){globals.set(name,value);},delete(name:string){globals.delete(name);}},async loadPackage(){},
  async runPythonAsync(){
   rows.length=0;paths.push('/late');
   const record=globals.get('_safe_package_record') as (operation:string,key?:unknown,value?:unknown)=>Promise<unknown>;
   assert.equal(await record('start'),1);
   assert.deepEqual(JSON.parse(await record('read',0) as string),expected);
   assert.equal(await record('has','fixture'),false);await record('add','fixture',0);await record('seal');
   assert.deepEqual(JSON.parse(await record('get','fixture') as string),expected);
   assert.equal(await record('get','missing'),'null');
   await record('append',JSON.stringify(expected));
   await record('pin',JSON.stringify('fixture==1'));
  },runPython(){throw new Error('whole inventory serialization');}};
 await installPythonPackages(runtime as never,{session:'1',requirements:['fixture==1'],restore:[],records:rows,offline:true},async(operation,...args)=>{
  if(operation==='package-index'){
   calls.push(args);
   const [,action,name,value]=args;
   if(action==='records-add')ordinal.set(name as string,value as number);
   if(action==='records-has')return ordinal.has(name as string);
   if(action==='records-get')return ordinal.get(name as string)??null;
  }
  if(operation==='package-commit')committed=args[1];
 },65536);
 assert.deepEqual(committed,{version:3,installed:['fixture==1'],records:[expected]});
 assert.ok(calls.some(args=>args[1]==='records-start'));assert.equal(globals.size,0);
});

test('absent saved records cross the native bridge as an explicit numeric sentinel',async()=>{
 const globals=new Map<string,unknown>();
 const runtime={version:'314.0.6',_api:{lockfile_packages:{},packageManager:{defaultChannel:'default',async installPackage(){},async downloadPackage(){}}},
  globals:{set(name:string,value:unknown){globals.set(name,value);},delete(name:string){globals.delete(name);}},async loadPackage(){},
  async runPythonAsync(){
   const record=globals.get('_safe_package_record') as (operation:string)=>Promise<unknown>;
   assert.equal(await record('start'),-1);
  },runPython(){return '[]';}};
 await installPythonPackages(runtime as never,{session:'1',requirements:['fixture'],restore:[],offline:true},async()=>null,65536);
});
