import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MemoryFileSystem } from '@poe-code/safe-fs';
import { createPythonPackageEnvironment } from './provisioning.js';
import { createPythonPackageManifestStore } from './manifest.js';

const context = () => ({fs:new MemoryFileSystem(),cwd:'/',signal:new AbortController().signal});

test('exact installed snapshots restore separately from newly requested dependencies', async () => {
 const env=createPythonPackageEnvironment({requirements:['configured==1']});
 const ctx=context();
 const first=await env.prepare({...ctx,requirements:['root[extra]>=1']});
 await env.dispatch('package-commit',[first.session,{version:1,installed:['root @ file:///root-1-py3-none-any.whl','root==1','dependency==2']}],ctx);
 env.finish(first);
 const next=await env.prepare({...ctx,requirements:['another==3']});
 assert.deepEqual(next.restore,['root @ file:///root-1-py3-none-any.whl','root==1','dependency==2']);
 assert.deepEqual(next.requested,['configured==1','another==3']);
 assert.ok(!next.requirements.includes('root[extra]>=1'));
 // A caller-owned installed snapshot can intentionally retain a broken root.
 await env.dispatch('package-commit',[next.session,{version:1,installed:['root==1']}],ctx);
 env.finish(next);
 const last=await env.prepare(ctx);
 assert.deepEqual(last.restore,['root==1']);
 assert.deepEqual(last.requested,['configured==1']);
 env.finish(last);
 await env.dispose();
});

test('legacy requirement manifests migrate once and exact snapshot publication preserves CAS', async () => {
 const store=createPythonPackageManifestStore();
 const one=createPythonPackageEnvironment({manifestStore:store,scope:'shared'});
 const two=createPythonPackageEnvironment({manifestStore:store,scope:'shared'});
 const ctx=context();
 const initial=await one.prepare({...ctx,requirements:['old>=1']});
 await one.dispatch('package-commit',[initial.session,['old==1']],ctx);
 one.finish(initial);
 const legacy=await one.prepare(ctx);
 assert.deepEqual(legacy.restore,['old>=1','old==1']);
 assert.equal(legacy.legacy,true);
 assert.deepEqual(legacy.requested,[]);
 const stale=await two.prepare(ctx);
 await one.dispatch('package-commit',[legacy.session,{version:1,installed:['old==1']}],ctx);
 await assert.rejects(two.dispatch('package-commit',[stale.session,{version:1,installed:[]}],ctx),/changed.*retry/);
 one.finish(legacy);two.finish(stale);
 const restored=await two.prepare(ctx);
 assert.deepEqual(restored.restore,['old==1']);assert.deepEqual(restored.requested,[]);
 await two.dispatch('package-commit',[restored.session,{version:1,installed:[]}],ctx);
 two.finish(restored);
 const empty=await one.prepare(ctx);
 assert.deepEqual(empty.requirements,[]);assert.deepEqual(empty.restore,[]);assert.deepEqual(empty.requested,[]);
 one.finish(empty);
 await one.dispose();await two.dispose();store.dispose();
});

test('invalid or unknown installed snapshot formats cannot overwrite package state', async () => {
 const env=createPythonPackageEnvironment();const ctx=context();const start=await env.prepare(ctx);
 for(const value of [{version:2,installed:[]},{version:1,installed:[1]},{version:1},{version:1,installed:[],extra:true}]) {
  await assert.rejects(env.dispatch('package-commit',[start.session,value],ctx),/Invalid installed package manifest/);
 }
 env.finish(start);await env.dispose();
});


test('legacy uninstall separates saved packages from current host requirements',async()=>{
 const env=createPythonPackageEnvironment({requirements:['host==1']});const ctx=context();
 const first=await env.prepare({...ctx,requirements:['old==1']});
 await env.dispatch('package-commit',[first.session,['dependency==1']],ctx);env.finish(first);
 const removal=await env.prepare({...ctx,uninstall:{packages:['old'],yes:true}});
 assert.deepEqual(removal.restore,['host==1','old==1','dependency==1']);
 assert.deepEqual(removal.requested,['host==1']);assert.equal(removal.legacy,true);
 env.finish(removal);await env.dispose();
});
