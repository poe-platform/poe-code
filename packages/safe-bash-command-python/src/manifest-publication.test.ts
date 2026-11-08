import assert from 'node:assert/strict';
import test from 'node:test';
import {MemoryFileSystem} from '@poe-code/safe-fs/core';
import {createPythonPackageEnvironment} from './provisioning.js';
import {createPythonPackageStreamingManifestStore} from './manifest.js';

for(const outcome of ['success','invalid','limit','conflict','cancel','incomplete','symlink','changed'] as const)test(`caller-file manifest publication: ${outcome}`,async()=>{
 const backing=new MemoryFileSystem(),fs=new Proxy(backing,{get(target,key){
  if(key==='readFile')return (path:string)=>{assert.ok(!path.endsWith('/publication.json'),'whole source file read');return target.readFile(path);};
  const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;
 }}),controller=new AbortController(),context={fs,cwd:'/work',signal:controller.signal};
 const snapshot={version:3,records:[['fixture','x'.repeat(100000),'',[],[],null]],installed:['fixture==1']};
 const raw=JSON.stringify(outcome==='invalid'?{...snapshot,installed:[1]}:snapshot);
 let calls=0,installed=0,maximum=0,stored='';
 const store=createPythonPackageStreamingManifestStore({async get(){return undefined;},async compareAndSet(_scope,_revision,source){
  calls++;if(outcome==='changed')await backing.writeFile('/work/.python-install-1/publication.json',new TextEncoder().encode(raw+' '));if(outcome==='conflict')return false;if(outcome==='incomplete')return true;
  const decoder=new TextDecoder();
  for await(const bytes of source){maximum=Math.max(maximum,bytes.length);stored+=decoder.decode(bytes,{stream:true});if(outcome==='cancel')controller.abort(new Error('cancel publication'));}
  stored+=decoder.decode();return true;
 }});
 store.compareAndSet=async()=>assert.fail('buffered publication');
 store.compareAndSetSnapshot=async()=>assert.fail('materialized snapshot publication');
 const env=createPythonPackageEnvironment({scope:'shared',manifestStore:store,...outcome==='limit'?{maxManifestBytes:64}:{},onProgress(){installed++;}});
 const start=await env.prepare(context);
 try{
  assert.equal(start.streamManifest,true);
  const root=await env.dispatch('package-root',[start.session],context) as string;
  if(outcome==='symlink'){await fs.writeFile('/target',new TextEncoder().encode(raw));await fs.symlink('/target',root+'/publication.json');}
  else await fs.writeFile(root+'/publication.json',new TextEncoder().encode(raw));
  const work=env.dispatch('package-commit-file',[start.session],context);
  if(outcome==='success'){await work;assert.equal(stored,raw);assert.ok(maximum>0&&maximum<=65536);assert.equal(installed,1);}
  else{await assert.rejects(work);assert.equal(installed,0);if(outcome==='invalid'||outcome==='limit'||outcome==='symlink')assert.equal(calls,0);}
 }finally{await env.finish(start);await env.dispose();}
 assert.deepEqual(await fs.readdir('/work'),[]);
});
