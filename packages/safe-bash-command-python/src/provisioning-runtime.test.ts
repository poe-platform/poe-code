import assert from 'node:assert/strict';
import { test } from 'node:test';
import { pythonNativeWheel } from "./native-wheel.js";
import { installPythonPackages } from "./provisioning-runtime.js";

function nativeFixture(extract:(name:string,read:(offset:number,length:number)=>Promise<number[]>)=>Promise<void>) {
 const globals=new Map<string,unknown>();
 const packages=Object.fromEntries(['fixture','one','two'].map(name=>[name,{file_name:name+'-1-py3-none-any.whl',sha256:'hash'}]));
 const runtime={version:'314.0.6',_api:{lockfile_packages:packages,async loadDynlib(){},
  packageManager:{defaultChannel:'default',async downloadPackage(_metadata:{normalizedName:string;channel:string}):Promise<unknown>{return null;},
   async installPackage(_metadata:{normalizedName:string;channel:string},_source:unknown):Promise<unknown>{throw new Error('buffered installer called');}}},
  globals:{set(name:string,value:unknown){globals.set(name,value);},delete(name:string){globals.delete(name);}},
  async loadPackage(){},
  async runPythonAsync(source:string){
   if(source===pythonNativeWheel){
    const config=JSON.parse(globals.get('_safe_native_wheel_config') as string);
    await extract(config.filename.split('-')[0],globals.get('_safe_native_wheel_read') as (offset:number,length:number)=>Promise<number[]>);
    return '[]';
   }
  },runPython(_source?:string):string{return '[]';}};
 return {runtime,globals};
}

test('installer preserves host transport failure when micropip masks it as missing metadata',async()=>{
 const globals=new Map<string,unknown>();let committed=false;
 const integrity=new Error('Package cache integrity mismatch: https://packages.example/metadata');
 const runtime={version:'314.0.6',_api:{lockfile_packages:{},packageManager:{defaultChannel:'default',async installPackage(_metadata:unknown,bytes:Uint8Array){return bytes;},async downloadPackage(){return new Uint8Array();}}},
  globals:{set(name:string,value:unknown){globals.set(name,value);},delete(name:string){globals.delete(name);}},async loadPackage(){},
  async runPythonAsync(){
   try {await (globals.get('_safe_package_metadata') as (url:string)=>unknown)('https://packages.example/metadata');}
   catch {throw new Error("Can't fetch metadata for 'fixture'");}
  },runPython(_source?:string):string{return '[]';}};
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
test('explicit build tooling bootstrap loads the installer without requesting application packages',async()=>{
 const {runtime,globals}=nativeFixture(async()=>{});const loaded:string[][]=[],commits:unknown[]=[];
 runtime.loadPackage=async(names?:string[])=>{loaded.push(names!);};
 await installPythonPackages(runtime as never,{session:'1',requirements:[],requested:[],restore:[],offline:false,bootstrap:true},(op,...args)=>{if(op==='package-commit')commits.push(args);},64);
 assert.deepEqual(loaded,[['micropip']]);
 assert.deepEqual(commits,[['1',{version:3,installed:[],records:[]}]]);
 assert.equal(globals.size,0);
});
test('legacy build tooling is bootstrapped without becoming application inventory',async()=>{
 const {runtime}=nativeFixture(async()=>{});const loaded:string[][]=[],commits:unknown[]=[];
 runtime.loadPackage=async(names?:string[])=>{loaded.push(names!);};
 await installPythonPackages(runtime as never,{session:'1',requirements:[],requested:[],restore:[],offline:false,bootstrap:true,bootstrapPackages:['setuptools']},(op,...args)=>{if(op==='package-commit')commits.push(args);},64);
 assert.deepEqual(loaded,[['micropip','setuptools']]);
 assert.deepEqual(commits,[['1',{version:3,installed:[],records:[]}]]);
});
test('installer refuses unsupported runtime ABI before any download',async()=>{
 await assert.rejects(installPythonPackages({version:'314.0.6'} as never,{session:'1',requirements:['example==1'],offline:false},()=>{throw Error('unexpected request');},65536),{category:'runtime-abi',cause:new Error('Python package installer ABI requires Pyodide 314.0.6')});
});
test('installer closes package transport callbacks before user Python starts',async()=>{
 const deleted:string[]=[];const runtime={version:'314.0.6',_api:{lockfile_packages:{},packageManager:{defaultChannel:'default',async installPackage(_metadata:unknown,bytes:Uint8Array){return bytes;},async downloadPackage(){return new Uint8Array();}}},globals:{set(){},delete(name:string){deleted.push(name);}},async loadPackage(){},async runPythonAsync(){},runPython(_source?:string):string{return '[]';}};
 await installPythonPackages(runtime as never,{session:'1',requirements:['example==1'],offline:false},()=>null,64);
 await assert.rejects(runtime._api.packageManager.downloadPackage(),/only available during installation/);
 assert.ok(deleted.includes('_safe_package_bytes'));assert.ok(deleted.includes('_safe_package_metadata'));
});
test('bootstrap and native dependency loading use supported callbacks instead of worker console output',async()=>{
 const globals=new Map<string,unknown>();const calls:string[][]=[];
 const runtime={version:'314.0.6',_api:{lockfile_packages:{},packageManager:{defaultChannel:'default',async installPackage(_metadata:unknown,bytes:Uint8Array){return bytes;},async downloadPackage(){return new Uint8Array();}}},globals:{set(name:string,value:unknown){globals.set(name,value);},delete(name:string){globals.delete(name);}},
  async loadPackage(names:string[],options?:{messageCallback?:(message:string)=>void;errorCallback?:(message:string)=>void}){
   assert.equal(typeof options?.messageCallback,'function');assert.equal(typeof options?.errorCallback,'function');
   options!.messageCallback!('Loading '+names.join(','));options!.messageCallback!('Loaded '+names.join(','));calls.push(names);
  },
  async runPythonAsync(){await (globals.get('_safe_package_native') as (names:string[])=>Promise<unknown>)(['lxml']);},runPython(_source?:string):string{return '[]';}};
 await installPythonPackages(runtime as never,{session:'1',requirements:['lxml==6.0.2'],offline:false},()=>null,64);
 assert.deepEqual(calls,[['micropip'],['lxml']]);assert.equal(globals.has('_safe_package_native'),false);
});
test('native loader error callbacks fail installation instead of silently succeeding',async()=>{
 let committed=false;
 const runtime={version:'314.0.6',_api:{lockfile_packages:{},packageManager:{defaultChannel:'default',async installPackage(_metadata:unknown,bytes:Uint8Array){return bytes;},async downloadPackage(){return new Uint8Array();}}},globals:{set(){},delete(){}},
  async loadPackage(_names:string[],options?:{errorCallback?:(message:string)=>void}){options?.errorCallback?.('wheel loading failed');},async runPythonAsync(){},runPython(_source?:string):string{return '[]';}};
 await assert.rejects(installPythonPackages(runtime as never,{session:'1',requirements:['example==1'],offline:false},()=>{committed=true;},64),/wheel loading failed/);
 assert.equal(committed,false);
});
test('failed installer bootstrap closes package transport before returning',async()=>{
 const runtime={version:'314.0.6',_api:{lockfile_packages:{},packageManager:{defaultChannel:'default',async installPackage(_metadata:unknown,bytes:Uint8Array){return bytes;},async downloadPackage(_metadata?:{normalizedName:string;channel:string}){return new Uint8Array();}}},globals:{set(){},delete(){}},
  async loadPackage(){throw new Error('bootstrap cancelled');},async runPythonAsync(){},runPython(_source?:string):string{return '[]';}};
 await assert.rejects(installPythonPackages(runtime as never,{session:'1',requirements:['example==1'],offline:false},()=>{throw new Error('host package bridge remains reachable');},64),/bootstrap cancelled/);
 await assert.rejects(runtime._api.packageManager.downloadPackage({normalizedName:'example',channel:'https://packages.example/example.whl'}),/only available during installation/);
});
test('reported bootstrap errors and callback setup failures close installer transport',async()=>{
 for(const stage of ['errorCallback','globals.set']){
  const deleted:string[]=[];const globals=new Map<string,unknown>();
  const runtime={version:'314.0.6',_api:{lockfile_packages:{},packageManager:{defaultChannel:'default',async installPackage(_metadata:unknown,bytes:Uint8Array){return bytes;},async downloadPackage(_metadata?:{normalizedName:string;channel:string}){return new Uint8Array();}}},
   globals:{set(name:string,value:unknown){if(stage==='globals.set'&&name==='_safe_package_metadata')throw new Error('callback setup failed');globals.set(name,value);},delete(name:string){if(!globals.has(name))throw new Error('missing global '+name);globals.delete(name);deleted.push(name);}},
   async loadPackage(_names:string[],options:{errorCallback:(message:string)=>void}){if(stage==='errorCallback')options.errorCallback('reported bootstrap error');},
   async runPythonAsync(){throw new Error('must not execute Python');},runPython(_source?:string):string{return '[]';}};
  await assert.rejects(installPythonPackages(runtime as never,{session:'1',requirements:['example==1'],offline:false},()=>{throw new Error('host package bridge remains reachable');},64),stage==='errorCallback'?/reported bootstrap error/:/callback setup failed/);
  await assert.rejects(runtime._api.packageManager.downloadPackage({normalizedName:'example',channel:'https://packages.example/example.whl'}),/only available during installation/);
  assert.deepEqual(deleted,stage==='globals.set'?['_safe_package_native','_safe_package_bytes']:[]);
  assert.equal(globals.size,0);
 }
});
test('dependency verification failures never commit the environment and remove installer callbacks',async()=>{
 const globals=new Map<string,unknown>();const operations:string[]=[];
 const runtime={version:'314.0.6',_api:{lockfile_packages:{},packageManager:{defaultChannel:'default',async installPackage(_metadata:unknown,bytes:Uint8Array){return bytes;},async downloadPackage(){return new Uint8Array();}}},
  globals:{set(name:string,value:unknown){globals.set(name,value);},delete(name:string){assert.ok(globals.delete(name));}},
  async loadPackage(){},async runPythonAsync(){throw new Error('Python package wheel version conflict: fixture==1.0');},runPython(){throw new Error('must not read failed inventory');}};
 await assert.rejects(installPythonPackages(runtime as never,{session:'1',requirements:['fixture==1.0'],offline:false},operation=>{operations.push(operation);},64),/wheel version conflict/);
 assert.deepEqual(operations,[]);assert.equal(globals.size,0);
 await assert.rejects(runtime._api.packageManager.downloadPackage(),/only available during installation/);
});
test('installer closes each host artifact on success and failed chunk reads',async()=>{
 for(const fail of [false,true]){
  const operations:string[]=[];
  const {runtime}=nativeFixture(async(_name,read)=>{assert.deepEqual(await read(0,1),[255]);});
  runtime.loadPackage=async()=>{const metadata={normalizedName:'fixture',channel:'https://example.org/fixture'};await runtime._api.packageManager.installPackage(metadata,await runtime._api.packageManager.downloadPackage(metadata));};
  const result=installPythonPackages(runtime as never,{session:'1',requirements:['fixture==1'],offline:false},op=>{operations.push(op);if(op==='package-open')return {key:'artifact',size:1,headers:[]};if(op==='package-read'){if(fail)throw Error('read failure');return [255];}return null;},64);
  if(fail)await assert.rejects(result,/read failure/);else await result;
  assert.deepEqual(operations.slice(0,3),['package-open','package-read','package-close']);
 }
});

test('installer awaits asynchronous artifact reads, closure and manifest publication',async()=>{
 const operations:string[]=[];let committed=false;
 const {runtime,globals}=nativeFixture(async(_name,read)=>{assert.deepEqual([...(await read(0,2)),...(await read(2,1))],[1,2,3]);});
 const execute=runtime.runPythonAsync.bind(runtime);
 runtime.runPythonAsync=async source=>{
  if(source===pythonNativeWheel)return execute(source);
  const metadata=await (globals.get('_safe_package_metadata') as (url:string)=>Promise<string>)('https://example.org/metadata');
  assert.deepEqual(JSON.parse(metadata),{text:'\u0001\u0002\u0003',headers:{'content-type':'application/json'}});
 };
 runtime.loadPackage=async()=>{const metadata={normalizedName:'fixture',channel:'https://example.org/fixture.whl'};await runtime._api.packageManager.installPackage(metadata,await runtime._api.packageManager.downloadPackage(metadata));assert.deepEqual(operations,['package-open','package-read','package-read','package-close']);};
 runtime.runPython=()=> '["fixture==1"]';
 await installPythonPackages(runtime as never,{session:'1',requirements:['fixture==1'],offline:false},async(op,...args)=>{
  await Promise.resolve();operations.push(op);
  if(op==='package-open'){assert.deepEqual(args,args[1]==='https://example.org/metadata'?['1',args[1],undefined,'metadata']:['1',args[1],undefined]);return {key:'artifact',size:3,headers:[['Content-Type','application/json']]};}
  if(op==='package-read')return [1,2,3].slice(args[2] as number,(args[2] as number)+(args[3] as number));
  if(op==='package-commit'){assert.deepEqual(args,['1',['fixture==1']]);committed=true;}
  return null;
 },2);
 assert.equal(committed,true);assert.equal(globals.size,0);
});

test('concurrent package downloads serialize artifact lifetimes and retire after loader failure',async()=>{
 for(const fail of [false,true]){
  const operations:string[]=[];let opened=false,release!:()=>void,admitted!:()=>void;
  const gate=new Promise<void>(resolve=>{release=resolve;});
  const started=new Promise<void>(resolve=>{admitted=resolve;});
  const readFailure=new Error('late host read failure');
  let committed=false;
  const {runtime}=nativeFixture(async(_name,read)=>{await read(0,1);});
  runtime.loadPackage=async()=>{
   const one={normalizedName:'one',channel:'one'};const first=runtime._api.packageManager.installPackage(one,await runtime._api.packageManager.downloadPackage(one));
   const two={normalizedName:'two',channel:'two'};const second=runtime._api.packageManager.installPackage(two,await runtime._api.packageManager.downloadPackage(two));
   const both=Promise.allSettled([first,second]);
   if(fail){void both;await started;throw new Error('loader failed early');}
   await both;
  };
  const installation=installPythonPackages(runtime as never,{session:'1',requirements:['fixture==1'],offline:false},async(op,...args)=>{
   if(op==='package-open'){assert.equal(opened,false);opened=true;operations.push('open '+args[1]);return {key:args[1],size:1,headers:[]};}
   if(op==='package-read'){admitted();await gate;if(fail)throw readFailure;return [1];}
   if(op==='package-close'){await Promise.resolve();opened=false;operations.push('close '+args[1]);}
   if(op==='package-commit')committed=true;
  },64);
  let settled=false;void installation.then(()=>{settled=true;},()=>{settled=true;});
  await started;await Promise.resolve();assert.equal(settled,false);release();
  if(fail)await assert.rejects(installation,error=>error===readFailure);else await installation;
  assert.equal(opened,false);assert.equal(committed,!fail);
  assert.deepEqual(operations,fail?['open one','close one']:['open one','close one','open two','close two']);
 }
});

test('uninstall reports success only after exact manifest publication',async()=>{
 for(const conflict of [false,true]){
  const globals=new Map<string,unknown>();const events:string[]=[];
  const runtime={version:'314.0.6',_api:{lockfile_packages:{},packageManager:{defaultChannel:'default',async installPackage(_metadata:unknown,bytes:Uint8Array){return bytes;},async downloadPackage(){return new Uint8Array();}}},
   globals:{set(name:string,value:unknown){globals.set(name,value);},delete(name:string){globals.delete(name);}},async loadPackage(){},
   async runPythonAsync(){assert.deepEqual(JSON.parse(globals.get('_safe_package_uninstall_json') as string),{packages:['fixture'],yes:true});},
   runPython(source:string){return source==='_safe_uninstalled_json'?'["fixture-1.0"]':'[]';}};
  const work=installPythonPackages(runtime as never,{session:'1',requirements:[],restore:[],uninstall:{packages:['fixture'],yes:true},offline:true},async(operation,...args)=>{
   if(operation==='package-commit'){
    events.push('commit');assert.deepEqual(args,['1',{version:3,installed:[],records:[]}]);
    if(conflict)throw new Error('manifest conflict');
   }
   if(operation==='stdout')events.push(new TextDecoder().decode(Uint8Array.from(args[0])));
  },8);
  if(conflict)await assert.rejects(work,/manifest conflict/);else await work;
  assert.equal(events[0],'commit');
  assert.equal(events.slice(1).join(''),conflict?'':'  Successfully uninstalled fixture-1.0\n');
  assert.equal(globals.size,0);
 }
});


test('native package handoff retains the wheel source instead of materializing it',async()=>{
 const operations:string[]=[];
 const runtime={version:'314.0.6',_api:{lockfile_packages:{},packageManager:{defaultChannel:'default',async installPackage(_metadata:unknown,bytes:Uint8Array){return bytes;},async downloadPackage(_metadata?:{normalizedName:string;channel:string}):Promise<unknown>{return new Uint8Array();}}},
  globals:{set(){},delete(){}},
  async loadPackage(){
   const archive=await runtime._api.packageManager.downloadPackage({normalizedName:'fixture',channel:'https://example.org/fixture.whl'});
   assert.equal(ArrayBuffer.isView(archive),false,'native installer must receive a retained archive source, not the complete wheel');
   assert.equal(operations.includes('package-read'),false,'wheel reads belong to bounded extraction, not an eager download buffer');
  },async runPythonAsync(){},runPython(_source?:string):string{return '[]';}};
 await installPythonPackages(runtime as never,{session:'1',requirements:['fixture==1'],offline:false},(op,...args)=>{
  operations.push(op);
  if(op==='package-open')return {key:'artifact',size:65536*4+7,headers:[]};
  if(op==='package-read')return Array<number>(args[3] as number).fill(23);
  return null;
 },65536);
});


test('native extraction admits one payload at a time and drains before bootstrap failure returns',async()=>{
 for(const fail of [false,true]){
  let release!:()=>void,entered!:()=>void,active=0,settled=false;
  const gate=new Promise<void>(resolve=>{release=resolve;}),started=new Promise<void>(resolve=>{entered=resolve;});
  const reads:string[]=[],installed:string[]=[];
  const {runtime}=nativeFixture(async(name,read)=>{
   assert.equal(++active,1);assert.deepEqual(await read(0,1),[23]);installed.push(name);
   if(name==='one'){entered();await gate;}active--;
  });
  runtime.loadPackage=async()=>{
   const one={normalizedName:'one',channel:'one'},two={normalizedName:'two',channel:'two'};
   const sources=await Promise.all([runtime._api.packageManager.downloadPackage(one),runtime._api.packageManager.downloadPackage(two)]);
   assert.deepEqual(reads,[]);
   const both=Promise.all([runtime._api.packageManager.installPackage(one,sources[0]),runtime._api.packageManager.installPackage(two,sources[1])]);
   if(fail){void both.catch(()=>{});await started;throw new Error('early native loader failure');}
   await both;
  };
  const pending=installPythonPackages(runtime as never,{session:'1',requirements:['fixture'],offline:false},(operation,...args)=>{
   if(operation==='package-open'){reads.push(args[1] as string);return {key:args[1],size:1,headers:[]};}
   if(operation==='package-read')return [23];
   return null;
  },65536);
  void pending.then(()=>{settled=true;},()=>{settled=true;});
  await started;await Promise.resolve();
  assert.deepEqual(reads,['one']);assert.equal(settled,false);
  release();
  if(fail)await assert.rejects(pending,/early native loader failure/);else await pending;
  assert.equal(active,0);assert.deepEqual(installed,['one','two']);
  assert.deepEqual(reads,['one','two']);
  await assert.rejects(runtime._api.packageManager.installPackage({normalizedName:'late',channel:'late'},{}),/only available during installation/);
 }
});


for(const fail of [false,true])test(`native wheel extraction streams native loading and retires its retained source; failure=${fail}`,async()=>{
 const globals=new Map<string,unknown>();
 const operations:string[]=[];
 const runtime={version:'314.0.6',_api:{lockfile_packages:{fixture:{file_name:'fixture-1-py3-none-any.whl',sha256:'hash',install_dir:'site'}},
  async loadDynlib(path:string){operations.push('dynlib '+path);if(fail)throw new Error('native rejected');},
  packageManager:{defaultChannel:'default',async downloadPackage(_metadata:unknown):Promise<unknown>{return null;},
   async installPackage(_metadata:unknown,_source:unknown){throw new Error('whole-wheel buffer reached native installer');}}},
  globals:{set(name:string,value:unknown){globals.set(name,value);},delete(name:string){globals.delete(name);}},
  async loadPackage(){const metadata={normalizedName:'fixture',channel:'default'};await runtime._api.packageManager.installPackage(metadata,await runtime._api.packageManager.downloadPackage(metadata));},
  async runPythonAsync(){
   if(globals.has('_safe_native_wheel_read')){
    const read=globals.get('_safe_native_wheel_read') as (offset:number,length:number)=>Promise<number[]>;
    assert.deepEqual(await read(65536,3),[4,5,6]);
    const emit=globals.get('_safe_native_wheel_dynlib') as (path:string)=>Promise<string>;
    const diagnostic=await emit('/lib/fixture.so');
    return JSON.stringify(diagnostic?{dynlibError:diagnostic}:[]);
   }
  },runPython(_source?:string):string{return '[]';}};
 const installing=installPythonPackages(runtime as never,{session:'1',requirements:['fixture'],offline:false},async(op,...args)=>{
  operations.push(op);
  if(op==='package-open')return {key:'wheel',size:65539,headers:[]};
  if(op==='package-read'){assert.deepEqual(args,['1','wheel',65536,3]);return [4,5,6];}
 },65536);
 if(fail)await assert.rejects(installing,{message:'Error: native rejected'});else await installing;
 assert.deepEqual(operations,['package-open','package-read','dynlib /lib/fixture.so','package-close',...fail?[]:['package-commit']]);
 assert.equal(globals.size,0);
});

test('native extraction preserves host read failure identity across the Python exception bridge',async()=>{
 for(const asyncRead of [false,true]){
  const failure=new Error('cancelled retained wheel read');
  const {runtime}=nativeFixture(async(_name,read)=>{try{await read(0,1);}catch{throw new Error('PythonError: masked host exception');}});
  runtime.loadPackage=async()=>{const metadata={normalizedName:'fixture',channel:'default'};await runtime._api.packageManager.installPackage(metadata,await runtime._api.packageManager.downloadPackage(metadata));};
  let closed=false;
  await assert.rejects(installPythonPackages(runtime as never,{session:'1',requirements:['fixture'],offline:false},op=>{
   if(op==='package-open')return {key:'wheel',size:1,headers:[]};
   if(op==='package-read'){if(asyncRead)return Promise.reject(failure);throw failure;}
   if(op==='package-close')closed=true;
  },65536),error=>error===failure);
  assert.equal(closed,true);
 }
});

test('micropip resolves metadata and installs through the same retained wheel receipt',async()=>{
 const globals=new Map<string,unknown>(),operations:string[]=[];
 const runtime={version:'314.0.6',_api:{lockfile_packages:{},async loadDynlib(){},packageManager:{defaultChannel:'default',async installPackage(){},async downloadPackage(){}}},
  globals:{set(name:string,value:unknown){globals.set(name,value);},delete(name:string){globals.delete(name);}},async loadPackage(){},runPython(_source?:string):string{return '[]';},
  async runPythonAsync(source:string):Promise<string|undefined>{
   if(source===pythonNativeWheel){
    const config=JSON.parse(globals.get('_safe_native_wheel_config') as string);
    const read=globals.get('_safe_native_wheel_read') as (offset:number,length:number)=>Promise<number[]>;
    assert.deepEqual(await read(99,3),[1,2,3]);
    return config.metadata_name?JSON.stringify('Name: fixture\nVersion: 1\n'):'[]';
   }
   const download=globals.get('_safe_package_wheel_download') as (url:string,expected:undefined)=>Promise<string>;
   const metadata=globals.get('_safe_package_wheel_metadata') as (source:string)=>Promise<string>;
   const install=globals.get('_safe_package_wheel_install') as (source:string)=>Promise<void>;
   const receipt=JSON.parse(await download('https://fixture/wheel.whl',undefined));
   assert.deepEqual(receipt,{token:'lease',key:'digest',size:102});
   assert.equal(await metadata(JSON.stringify({source:receipt,name:'fixture'})),'Name: fixture\nVersion: 1\n');
   await install(JSON.stringify({source:receipt,filename:'fixture-1-py3-none-any.whl',extract_dir:'/target',metadata:{INSTALLER:'micropip'}}));
  }};
 await installPythonPackages(runtime as never,{session:'1',requirements:['fixture'],offline:false},async(op,...args)=>{
  operations.push(op);
  if(op==='package-open')return {key:'digest',size:102,headers:[]};
  if(op==='package-read'){assert.deepEqual(args,['1','digest',99,3]);return [1,2,3];}
  if(op==='package-retain')return {token:'lease',key:'digest',size:102};
  if(op==='package-read-retained'){assert.deepEqual(args,['1','lease',99,3]);return [1,2,3];}
 },65536);
 assert.deepEqual(operations,['package-open','package-retain','package-close','package-read-retained','package-read-retained','package-commit']);
 assert.equal(globals.size,0);
});

for(const algorithm of ['sha1','sha224','sha384','sha256','sha512','md5'])test('direct wheel URL '+algorithm+' is verified before retaining or reading metadata',async()=>{
 const {runtime,globals}=nativeFixture(async()=>{});const operations:string[]=[];
 runtime.runPythonAsync=async source=>{
  if(source===pythonNativeWheel){
   const config=JSON.parse(globals.get('_safe_native_wheel_config') as string);
   assert.deepEqual(config.integrity,[algorithm,'abc']);
   assert.deepEqual(await (globals.get('_safe_native_wheel_read') as (offset:number,length:number)=>Promise<number[]>)(0,1),[42]);
   throw new Error('Python package integrity mismatch');
  }
  const download=globals.get('_safe_package_wheel_download') as (url:string,expected?:string)=>Promise<string>;
  await download('https://example.test/fixture-1-py3-none-any.whl#'+algorithm+'=abc');
  return undefined;
 };
 await assert.rejects(installPythonPackages(runtime as never,{session:'1',requirements:['fixture'],offline:false},operation=>{
  operations.push(operation);
  if(operation==='package-open')return {key:'digest',size:1,headers:[]};
  if(operation==='package-read')return [42];
  if(operation==='package-retain')return {token:'lease',key:'digest',size:1};
 },65536),/integrity mismatch/);
 assert.deepEqual(operations,['package-open','package-read','package-close']);
 assert.equal(globals.size,0);
});
