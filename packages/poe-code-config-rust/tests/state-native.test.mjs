import test from 'node:test';
import assert from 'node:assert/strict';
import {Volume,createFsFromVolume} from 'memfs';
import {createStateManager} from '../dist/index.js';
test('state registries preserve literal identifiers, atomic failures and mutation ordering',async()=>{
 const volume=Volume.fromJSON({},'/'),fs=createFsFromVolume(volume).promises;
 const state=createStateManager('/home',fs),job={id:'__proto__',env_id:'host',env_kind:'host',tool:'test',argv:['run'],cwd:'/work',started_at:'2026-09-21T00:00:00Z',status:'pending'};
 await state.jobs.put(job);assert.deepEqual(await state.jobs.get('__proto__'),job);
 await Promise.all([state.jobs.update('__proto__',{status:'running'}),state.jobs.update('__proto__',{status:'exited',exit_code:0})]);
 assert.equal((await state.jobs.get('__proto__')).status,'exited');
 const original=await fs.readFile('/home/.poe-code/state/jobs/__proto__.json','utf8');
 await assert.rejects(state.jobs.update('__proto__',{exit_code:1.5}),/Invalid job entry/);assert.equal(await fs.readFile('/home/.poe-code/state/jobs/__proto__.json','utf8'),original);
 await state.templates.put('docker',{hash:'__proto__',runtime_type:'docker',dockerfile_path:'/work/Dockerfile',built_at:'now'});
 assert.equal((await state.templates.get('docker','__proto__')).hash,'__proto__');
 await assert.rejects(state.jobs.get('../escape'),/Invalid job id/);
});
test('validation reads lazy getters in SDK order without classifying unused proxy shapes',async()=>{
 const {statePolicy}=await import('../dist/state-host.js');
 const p=Proxy.revocable({},{});p.revoke();let optionalReads=0;
 const job={id:'one',env_id:'h',env_kind:'h',tool:'t',argv:[],cwd:'/',started_at:'now',status:'running',get exited_at(){return ++optionalReads===1?p.proxy:'later';}};
 assert.equal(statePolicy('job',job),true);assert.equal(optionalReads,2);
 let hashReads=0;const template={get hash(){return ++hashReads===1?'one':1;},runtime_type:'docker',dockerfile_path:'/',built_at:'now'};
 assert.deepEqual(statePolicy('templates',{docker:{one:template}}),[]);
});
