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

test('cancelling a stalled remote source download retires transport and owned build storage',async()=>{
 const fs=new MemoryFileSystem();await fs.mkdir('/builds');let enter!:()=>void;
 const started=new Promise<void>(resolve=>{enter=resolve;}),controller=new AbortController();let disposed=0;
 const environment=createPythonSourcePackageEnvironment({authorize:()=>true,transport:async()=>({status:200,statusText:'OK',headers:[],body:{[Symbol.asyncIterator](){return {next(){enter();return new Promise<IteratorResult<Uint8Array>>(()=>{});},async return(){return {done:true,value:undefined};}};}},async dispose(){disposed++;}})}, {directory:'/builds',async extractArchive(){throw new Error('must not extract');},python:{createExecutor:()=>{throw new Error('must not build');}}});
 try{
  const error=new Error('cancel source'),running=environment.prepare({fs,cwd:'/',signal:controller.signal,requirements:['https://example.test/project.zip'],env:{},stdout:{async write(){}},stderr:{async write(){}}});
  const rejected=assert.rejects(running,caught=>caught===error);await started;controller.abort(error);await rejected;
  assert.equal(disposed,1);assert.deepEqual(await fs.readdir('/builds'),[]);
 }finally{await environment.dispose();}
});
