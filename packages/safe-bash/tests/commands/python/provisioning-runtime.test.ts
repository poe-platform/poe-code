import assert from 'node:assert/strict';
import { test } from 'node:test';
import { installPythonPackages } from '../../../src/commands/python/provisioning-runtime.js';

test('installer preserves host transport failure when micropip masks it as missing metadata',async()=>{
 const globals=new Map<string,unknown>();let committed=false;
 const integrity=new Error('Package cache integrity mismatch: https://packages.example/metadata');
 const runtime={version:'314.0.6',_api:{lockfile_packages:{},packageManager:{defaultChannel:'default',async downloadPackage(){return new Uint8Array();}}},
  globals:{set(name:string,value:unknown){globals.set(name,value);},delete(name:string){globals.delete(name);}},async loadPackage(){},
  async runPythonAsync(){
   try {(globals.get('_safe_package_metadata') as (url:string)=>unknown)('https://packages.example/metadata');}
   catch {throw new Error("Can't fetch metadata for 'fixture'");}
  },runPython(){return '[]';}};
 await assert.rejects(installPythonPackages(runtime as never,{session:'1',requirements:['fixture==1'],offline:true},op=>{
  if(op==='package-open')throw integrity;
  if(op==='package-commit')committed=true;
 },64),error=>error===integrity);
 assert.equal(committed,false);assert.equal(globals.size,0);
 await assert.rejects(runtime._api.packageManager.downloadPackage(),/only available during installation/);
});

test('empty package environment never loads installer or runtime extensions',async()=>{
 await installPythonPackages({} as never,{session:'1',requirements:[],offline:false},()=>{throw Error('unexpected request');},65536);
});
test('installer refuses unsupported runtime ABI before any download',async()=>{
 await assert.rejects(installPythonPackages({version:'314.0.6'} as never,{session:'1',requirements:['example==1'],offline:false},()=>{throw Error('unexpected request');},65536),/installer ABI/);
});
test('installer closes package transport callbacks before user Python starts',async()=>{
 const deleted:string[]=[];const runtime={version:'314.0.6',_api:{lockfile_packages:{},packageManager:{defaultChannel:'default',async downloadPackage(){return new Uint8Array();}}},globals:{set(){},delete(name:string){deleted.push(name);}},async loadPackage(){},async runPythonAsync(){},runPython(){return '[]';}};
 await installPythonPackages(runtime as never,{session:'1',requirements:['example==1'],offline:false},()=>null,64);
 await assert.rejects(runtime._api.packageManager.downloadPackage(),/only available during installation/);
 assert.ok(deleted.includes('_safe_package_bytes'));assert.ok(deleted.includes('_safe_package_metadata'));
});
test('bootstrap and native dependency loading use supported callbacks instead of worker console output',async()=>{
 const globals=new Map<string,unknown>();const calls:string[][]=[];
 const runtime={version:'314.0.6',_api:{lockfile_packages:{},packageManager:{defaultChannel:'default',async downloadPackage(){return new Uint8Array();}}},globals:{set(name:string,value:unknown){globals.set(name,value);},delete(name:string){globals.delete(name);}},
  async loadPackage(names:string[],options?:{messageCallback?:(message:string)=>void;errorCallback?:(message:string)=>void}){
   assert.equal(typeof options?.messageCallback,'function');assert.equal(typeof options?.errorCallback,'function');
   options!.messageCallback!('Loading '+names.join(','));options!.messageCallback!('Loaded '+names.join(','));calls.push(names);
  },
  async runPythonAsync(){await (globals.get('_safe_package_native') as (names:string[])=>Promise<unknown>)(['lxml']);},runPython(){return '[]';}};
 await installPythonPackages(runtime as never,{session:'1',requirements:['lxml==6.0.2'],offline:false},()=>null,64);
 assert.deepEqual(calls,[['micropip'],['lxml']]);assert.equal(globals.has('_safe_package_native'),false);
});
test('native loader error callbacks fail installation instead of silently succeeding',async()=>{
 let committed=false;
 const runtime={version:'314.0.6',_api:{lockfile_packages:{},packageManager:{defaultChannel:'default',async downloadPackage(){return new Uint8Array();}}},globals:{set(){},delete(){}},
  async loadPackage(_names:string[],options?:{errorCallback?:(message:string)=>void}){options?.errorCallback?.('wheel loading failed');},async runPythonAsync(){},runPython(){return '[]';}};
 await assert.rejects(installPythonPackages(runtime as never,{session:'1',requirements:['example==1'],offline:false},()=>{committed=true;},64),/wheel loading failed/);
 assert.equal(committed,false);
});
test('failed installer bootstrap closes package transport before returning',async()=>{
 const runtime={version:'314.0.6',_api:{lockfile_packages:{},packageManager:{defaultChannel:'default',async downloadPackage(_metadata?:{normalizedName:string;channel:string}){return new Uint8Array();}}},globals:{set(){},delete(){}},
  async loadPackage(){throw new Error('bootstrap cancelled');},async runPythonAsync(){},runPython(){return '[]';}};
 await assert.rejects(installPythonPackages(runtime as never,{session:'1',requirements:['example==1'],offline:false},()=>{throw new Error('host package bridge remains reachable');},64),/bootstrap cancelled/);
 await assert.rejects(runtime._api.packageManager.downloadPackage({normalizedName:'example',channel:'https://packages.example/example.whl'}),/only available during installation/);
});
test('reported bootstrap errors and callback setup failures close installer transport',async()=>{
 for(const stage of ['errorCallback','globals.set']){
  const deleted:string[]=[];const globals=new Map<string,unknown>();
  const runtime={version:'314.0.6',_api:{lockfile_packages:{},packageManager:{defaultChannel:'default',async downloadPackage(_metadata?:{normalizedName:string;channel:string}){return new Uint8Array();}}},
   globals:{set(name:string,value:unknown){if(stage==='globals.set'&&name==='_safe_package_metadata')throw new Error('callback setup failed');globals.set(name,value);},delete(name:string){if(!globals.has(name))throw new Error('missing global '+name);globals.delete(name);deleted.push(name);}},
   async loadPackage(_names:string[],options:{errorCallback:(message:string)=>void}){if(stage==='errorCallback')options.errorCallback('reported bootstrap error');},
   async runPythonAsync(){throw new Error('must not execute Python');},runPython(){return '[]';}};
  await assert.rejects(installPythonPackages(runtime as never,{session:'1',requirements:['example==1'],offline:false},()=>{throw new Error('host package bridge remains reachable');},64),stage==='errorCallback'?/reported bootstrap error/:/callback setup failed/);
  await assert.rejects(runtime._api.packageManager.downloadPackage({normalizedName:'example',channel:'https://packages.example/example.whl'}),/only available during installation/);
  assert.deepEqual(deleted,stage==='globals.set'?['_safe_package_native','_safe_package_bytes']:[]);
  assert.equal(globals.size,0);
 }
});
test('dependency verification failures never commit the environment and remove installer callbacks',async()=>{
 const globals=new Map<string,unknown>();const operations:string[]=[];
 const runtime={version:'314.0.6',_api:{lockfile_packages:{},packageManager:{defaultChannel:'default',async downloadPackage(){return new Uint8Array();}}},
  globals:{set(name:string,value:unknown){globals.set(name,value);},delete(name:string){assert.ok(globals.delete(name));}},
  async loadPackage(){},async runPythonAsync(){throw new Error('Python package wheel version conflict: fixture==1.0');},runPython(){throw new Error('must not read failed inventory');}};
 await assert.rejects(installPythonPackages(runtime as never,{session:'1',requirements:['fixture==1.0'],offline:false},operation=>{operations.push(operation);},64),/wheel version conflict/);
 assert.deepEqual(operations,[]);assert.equal(globals.size,0);
 await assert.rejects(runtime._api.packageManager.downloadPackage(),/only available during installation/);
});
test('installer closes each host artifact on success and failed chunk reads',async()=>{
 for(const fail of [false,true]){
  const operations:string[]=[];
  const runtime={version:'314.0.6',_api:{lockfile_packages:{},packageManager:{defaultChannel:'default',async downloadPackage(_metadata?:{normalizedName:string;channel:string}){return new Uint8Array();}}},globals:{set(){},delete(){}},async loadPackage(){await runtime._api.packageManager.downloadPackage({normalizedName:'fixture',channel:'https://example.org/fixture'});},async runPythonAsync(){},runPython(){return '[]';}};
  const result=installPythonPackages(runtime as never,{session:'1',requirements:['fixture==1'],offline:false},op=>{operations.push(op);if(op==='package-open')return {key:'artifact',size:1,headers:[]};if(op==='package-read'){if(fail)throw Error('read failure');return [255];}return null;},64);
  if(fail)await assert.rejects(result,/read failure/);else await result;
  assert.deepEqual(operations.slice(0,3),['package-open','package-read','package-close']);
 }
});
