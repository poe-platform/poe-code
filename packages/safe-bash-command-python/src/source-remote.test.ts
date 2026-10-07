import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import test from 'node:test';
import {MemoryFileSystem} from '@poe-code/safe-fs/core';
import {createPythonSourcePackageEnvironment} from './source-environment.js';

for(const mode of ['allowed','named','extensionless','named-extensionless','upper-wheel','denied','integrity','limit','offline'] as const)test('remote source archives use owned transport and retire build storage; '+mode,async()=>{
 const fs=new MemoryFileSystem();await fs.mkdir('/builds');await fs.mkdir('/cache');
 const bytes=new Uint8Array(150000).fill(41),hash=createHash('sha256').update(bytes).digest('hex');
 const url='https://example.test/'+(mode.endsWith('extensionless')?'download':mode==='upper-wheel'?'project.WHL':'project.tar.gz');let fetched=0,extracted=0,disposed=0;const authorized:string[]=[];
 const accepted=['allowed','named','extensionless','named-extensionless','upper-wheel'].includes(mode);
 const reached=new Error('source extraction reached');
 const environment=createPythonSourcePackageEnvironment({cacheDirectory:'/cache',offline:mode==='offline',maxDownloadBytes:mode==='limit'?100:200000,authorize:({url})=>{authorized.push(url);return mode!=='denied';},transport:async()=>{
  fetched++;return {status:200,statusText:'OK',headers:[['content-disposition','attachment; filename="../download.tar.gz"'],['content-type','application/x-gzip']],body:(async function*(){yield bytes;})(),async dispose(){disposed++;}};
 }},{directory:'/builds',async extractArchive(source,directory,_max,context,metadata){
  extracted++;assert.ok(source.endsWith('/archive'));assert.deepEqual(metadata,{filename:'download.tar.gz',contentType:'application/x-gzip'});assert.ok(source.startsWith('/builds/.python-build-'));assert.ok(directory.startsWith('/builds/.python-build-'));
  assert.deepEqual(await fs.readFile(source),bytes);assert.equal(context.fs.capabilities.atomicTreeRemoval,true);throw reached;
 },python:{createExecutor:()=>({terminate(){},async run(start){const send=(value:any)=>start.host!.request({version:1,operation:'call',capability:'python_build',value});const request=await send({op:'request'}) as any;if(request.hook==='read_download_filename'){assert.equal(request.responseUrl,url);assert.equal(request.source,url+'#sha256='+hash);assert.deepEqual(request.headers,[['content-disposition','attachment; filename="../download.tar.gz"'],['content-type','application/x-gzip']]);await send({op:'text',text:JSON.stringify('download.tar.gz')});await send({op:'done'});return 0;}assert.equal(request.hook,'read_source_requirement');await send({op:'text',text:JSON.stringify({name:'Fixture',extras:[],url:url+'#sha256='+hash,marker:null,active:true})});await send({op:'done'});return 0;}})}});
 const proxy=new Proxy(fs,{get(target,key){if(key==='readFile')return (...args:Parameters<typeof target.readFile>)=>{if(args[0].includes('-sha256-')||args[0].endsWith('/archive'))throw new Error('Buffered remote source read');return target.readFile(...args);};const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;}});
 const context={fs:proxy,cwd:'/',signal:new AbortController().signal,requirements:[(mode.startsWith('named')?'Fixture @ ':'')+url+'#sha256='+(mode==='integrity'?'0'.repeat(64):hash)],env:{},stdout:{async write(){}},stderr:{async write(){}}};
 try{
  await assert.rejects(environment.prepare(context),error=>accepted?error===reached:error instanceof Error&&error.message.includes(mode==='denied'?'authorization denied':mode==='integrity'?'integrity mismatch':mode==='limit'?'maxDownloadBytes':'Offline'));
  assert.equal(extracted,accepted?1:0);assert.equal(fetched,mode==='denied'||mode==='offline'?0:1);assert.equal(disposed,fetched);
  assert.deepEqual(await fs.readdir('/builds'),[]);
  if(mode==='allowed'){
   await assert.rejects(environment.prepare({...context,offline:true}),error=>error===reached);
   assert.equal(fetched,1);assert.equal(extracted,2);assert.deepEqual(authorized,[url]);
   await assert.rejects(environment.prepare({...context,noCache:true}),error=>error===reached);
   assert.equal(fetched,2);assert.equal(extracted,3);
  }
 }finally{await environment.dispose();}
});

for(const hashed of [false,true])test('cancelling a stalled remote source download retires transport and owned build storage; hashed='+hashed,async()=>{
 const fs=new MemoryFileSystem();await fs.mkdir('/builds');let enter!:()=>void;
 const started=new Promise<void>(resolve=>{enter=resolve;}),controller=new AbortController();let disposed=0;
 const environment=createPythonSourcePackageEnvironment({authorize:()=>true,transport:async()=>({status:200,statusText:'OK',headers:[],body:{[Symbol.asyncIterator](){return {next(){enter();return new Promise<IteratorResult<Uint8Array>>(()=>{});},async return(){return {done:true,value:undefined};}};}},async dispose(){disposed++;}})}, {directory:'/builds',async extractArchive(){throw new Error('must not extract');},python:{createExecutor:()=>{throw new Error('must not build');}}});
 try{
  const error=new Error('cancel source'),running=environment.prepare({fs,cwd:'/',signal:controller.signal,requirements:['https://example.test/project.zip'+(hashed?'#sha256='+'0'.repeat(64):'')],env:{},stdout:{async write(){}},stderr:{async write(){}}});
  const rejected=assert.rejects(running,caught=>caught===error);await started;controller.abort(error);await rejected;
  assert.equal(disposed,1);assert.deepEqual(await fs.readdir('/builds'),[]);
 }finally{await environment.dispose();}
});

for(const algorithm of ['sha1','sha224','sha384','sha256','sha512','md5'])test('remote source '+algorithm+' is verified before extraction, including cached replay',async()=>{
 const fs=new MemoryFileSystem();await fs.mkdir('/builds');await fs.mkdir('/cache');
 const bytes=new Uint8Array(196615).fill(37),hash=createHash(algorithm).update(bytes).digest('hex');
 let requests=0,extractions=0;
 const reached=new Error('verified extraction');
 const environment=createPythonSourcePackageEnvironment({cacheDirectory:'/cache',authorize:()=>true,transport:async()=>{
  requests++;return {status:200,statusText:'OK',headers:[],body:(async function*(){for(let offset=0;offset<bytes.length;offset+=32768)yield bytes.subarray(offset,offset+32768);})(),async dispose(){}};
 }},{directory:'/builds',async extractArchive(){extractions++;throw reached;},python:{createExecutor:()=>({terminate(){},async run(start){
  const send=(value:any)=>start.host!.request({version:1,operation:'call',capability:'python_build',value});
  const request=await send({op:'request'}) as {hook:string};assert.equal(request.hook,'read_download_filename');
  await send({op:'text',text:JSON.stringify('source.zip')});await send({op:'done'});return 0;
 }})}});
 const context={fs,cwd:'/',signal:new AbortController().signal,env:{},stdout:{async write(){}},stderr:{async write(){}}};
 try{
  await assert.rejects(environment.prepare({...context,requirements:['https://example.test/rejected.zip#'+algorithm+'='+'0'.repeat(hash.length)]}),/integrity mismatch/);
  const cacheEntries=await fs.readdir('/cache');
  for(const entry of cacheEntries)assert.deepEqual(await fs.readdir('/cache/'+entry.name),[],'a mismatched source must not publish a cache entry');
  for(const offline of [false,true]){
   await assert.rejects(environment.prepare({...context,offline,requirements:['https://example.test/source.zip#'+algorithm+'='+hash]}),error=>error===reached);
   await assert.rejects(environment.prepare({...context,offline,requirements:['https://example.test/source.zip#'+algorithm+'='+'0'.repeat(hash.length)]}),/integrity mismatch/);
   assert.deepEqual(await fs.readdir('/builds'),[]);
  }
  assert.equal(extractions,2);assert.equal(requests,2);
 }finally{await environment.dispose();}
});


test('source integrity preserves transport capability and response disposal ownership',async()=>{
 const fs=new MemoryFileSystem();await fs.mkdir('/builds');let disposed=0;
 const bytes=Uint8Array.of(17,23),hash=createHash('sha512').update(bytes).digest('hex');
 class Response {
  #closed=false;
  get status(){return 200;}
  get statusText(){return 'OK';}
  get headers(){return [] as const;}
  get body(){return (async function*(){yield bytes;})();}
  async dispose(){assert.equal(this.#closed,false);this.#closed=true;disposed++;}
 }
 const reached=new Error('verified source');
 const transport=Object.assign(async(request:{denyPrivateNetworks?:boolean})=>{assert.equal(request.denyPrivateNetworks,true);return new Response();},{supportsPrivateNetworkDeny:true as const});
 const environment=createPythonSourcePackageEnvironment({authorize:request=>{request.requirePrivateNetworkDeny!();return true;},transport},{directory:'/builds',async extractArchive(){throw reached;},python:{createExecutor:()=>({terminate(){},async run(start){
  const send=(value:any)=>start.host!.request({version:1,operation:'call',capability:'python_build',value});
  await send({op:'request'});await send({op:'text',text:JSON.stringify('source.zip')});await send({op:'done'});return 0;
 }})}});
 try{
  await assert.rejects(environment.prepare({fs,cwd:'/',signal:new AbortController().signal,env:{},stdout:{async write(){}},stderr:{async write(){}},requirements:['https://example.test/source.zip#sha512='+hash]}),error=>error===reached);
  assert.equal(disposed,1);assert.deepEqual(await fs.readdir('/builds'),[]);
 }finally{await environment.dispose();}
});
