import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createMemoryFileSystem } from '../../../src/fs/memory/index.js';
import { createPythonPackageEnvironment } from '../../../src/commands/python/provisioning.js';
import type { HttpTransport } from '../../../src/commands/network/types.js';

const bytes = new TextEncoder().encode('wheel fixture');
const context = () => ({fs:createMemoryFileSystem(),cwd:'/',signal:new AbortController().signal});
function transport(onRequest: (url:string) => void = () => {}): HttpTransport {
 return async request => { onRequest(request.url); return {status:200,statusText:'OK',headers:[['content-type','application/octet-stream']],body:(async function*(){yield bytes;})(),async dispose(){}}; };
}
test('provisioning is lazy and caches authenticated bytes for offline replay', async () => {
 let requests = 0;
 const env = createPythonPackageEnvironment({transport:transport(()=>requests++),authorize:()=>true});
 const ctx=context(); const start=await env.prepare(ctx);
 assert.equal(requests,0);
 const file=await env.dispatch('package-open',[start.session,'https://example.org/demo.whl'],ctx) as {key:string,size:number};
 assert.equal(file.size,bytes.length);
 assert.deepEqual(await env.dispatch('package-read',[start.session,file.key,0,100],ctx),Array.from(bytes));
 env.finish(start);
 const offline=await env.prepare({...ctx,offline:true});
 await env.dispatch('package-open',[offline.session,'https://example.org/demo.whl'],ctx);
 assert.equal(requests,1);
});
test('remote packages require configured authorization and offline misses fail',async()=>{
 const ctx=context();const env=createPythonPackageEnvironment({transport:transport()});const s=await env.prepare(ctx);
 await assert.rejects(env.dispatch('package-open',[s.session,'https://example.org/x'],ctx),/authoriz/);
 const off=await env.prepare({...ctx,offline:true});await assert.rejects(env.dispatch('package-open',[off.session,'https://example.org/x'],ctx),/offline/i);
});
test('package hashes reject corrupt downloads and permit retry',async()=>{
 let count=0; const env=createPythonPackageEnvironment({transport:transport(()=>count++),authorize:()=>true});const ctx=context();const s=await env.prepare(ctx);
 await assert.rejects(env.dispatch('package-open',[s.session,'https://example.org/x','0'.repeat(64)],ctx),/integrity/i);
 await env.dispatch('package-open',[s.session,'https://example.org/x'],ctx);assert.equal(count,2);
});
test('requirements read canonical files, reject pip options, and support local wheels',async()=>{
 const ctx=context(); await ctx.fs.writeFile('/requirements.txt',new TextEncoder().encode('# comment\ndemo==1.0\n./demo-1.0-py3-none-any.whl\n'));await ctx.fs.writeFile('/demo-1.0-py3-none-any.whl',bytes);
 const env=createPythonPackageEnvironment({requirementFiles:['/requirements.txt']});const s=await env.prepare(ctx);
 assert.deepEqual(s.requirements,['demo==1.0','file:///demo-1.0-py3-none-any.whl']);
 const result=await env.dispatch('package-open',[s.session,s.requirements[1]],ctx) as {size:number};assert.equal(result.size,bytes.length);
 await ctx.fs.writeFile('/requirements.txt',new TextEncoder().encode('--trusted-host example.org'));
 await assert.rejects(env.prepare(ctx),/unsupported/i);
});
test('failed installation does not commit environment and cancellation is preserved',async()=>{
 const ctx=context();const env=createPythonPackageEnvironment({requirements:['one==1']});let s=await env.prepare(ctx);env.finish(s);s=await env.prepare({...ctx,requirements:['two==2']});assert.deepEqual(s.requirements,['one==1','two==2']);
 const controller=new AbortController();const error=new Error('cancel install');controller.abort(error);await assert.rejects(env.prepare({...ctx,signal:controller.signal}),e=>e===error);
});
test('canonical wheel URLs preserve special characters and missing requirements explain path',async()=>{
 const ctx=context();await ctx.fs.writeFile('/a#?-1.0-py3-none-any.whl',bytes);
 const env=createPythonPackageEnvironment({requirements:['/a#?-1.0-py3-none-any.whl']});const s=await env.prepare(ctx);
 assert.equal((await env.dispatch('package-open',[s.session,s.requirements[0]],ctx) as {size:number}).size,bytes.length);
 await assert.rejects(createPythonPackageEnvironment({requirementFiles:['/missing.txt']}).prepare(ctx),error=>error instanceof Error && 'code' in error && error.code==='EPACKAGE' && error.message.includes('/missing.txt'));
});
test('concurrent environment commits refuse stale writers rather than losing installed packages',async()=>{
 const env=createPythonPackageEnvironment();const ctx=context();const first=await env.prepare({...ctx,requirements:['one==1']});const second=await env.prepare({...ctx,requirements:['two==2']});
 await env.dispatch('package-commit',[first.session,['one==1']],ctx);
 await assert.rejects(env.dispatch('package-commit',[second.session,['two==2']],ctx),/changed.*retry/i);
 const next=await env.prepare(ctx);assert.deepEqual(next.requirements,['one==1']);
});
test('persistent canonical cache supports fresh managers',async()=>{
 const ctx=context();let requests=0;const env=createPythonPackageEnvironment({cacheDirectory:'/cache',transport:transport(()=>requests++),authorize:()=>true});let s=await env.prepare(ctx);
 await env.dispatch('package-open',[s.session,'https://example.org/wheel'],ctx);await env.dispatch('package-commit',[s.session,['demo==1']],ctx);env.finish(s);
 const next=createPythonPackageEnvironment({cacheDirectory:'/cache',offline:true});s=await next.prepare(ctx);assert.deepEqual(s.requirements,['demo==1']);await next.dispatch('package-open',[s.session,'https://example.org/wheel'],ctx);assert.equal(requests,1);
});
test('redirect policy is authorized at every hop and private network enforcement propagates',async()=>{
 const visited:string[]=[];let disposed=0;
 const redirected:HttpTransport=async req=>{visited.push(req.url);return {status:302,statusText:'redirect',headers:[['location','https://denied.org/wheel']],body:(async function*(){})(),async dispose(){disposed++;}};};
 const ctx=context();const env=createPythonPackageEnvironment({transport:redirected,authorize:req=>new URL(req.url).hostname==='allowed.org'});const s=await env.prepare(ctx);
 await assert.rejects(env.dispatch('package-open',[s.session,'https://allowed.org/wheel'],ctx),/authorization denied/);assert.deepEqual(visited,['https://allowed.org/wheel']);assert.equal(disposed,1);
 let privateFlag=false;const protectedTransport=Object.assign(transport(),{supportsPrivateNetworkDeny:true as const});const secure:HttpTransport=Object.assign(async(req:Parameters<HttpTransport>[0])=>{privateFlag=req.denyPrivateNetworks===true;return protectedTransport(req);},{supportsPrivateNetworkDeny:true as const});
 const protectedEnv=createPythonPackageEnvironment({transport:secure,authorize:req=>{req.requirePrivateNetworkDeny?.();return true;}});const p=await protectedEnv.prepare(ctx);await protectedEnv.dispatch('package-open',[p.session,'https://allowed.org/wheel'],ctx);assert.equal(privateFlag,true);
});
test('cancelled partial downloads publish no cache bytes and a fresh invocation can retry',async()=>{
 const entries=new Map<string,Uint8Array>();const cache={async get(key:string){return entries.get(key);},async set(key:string,value:Uint8Array){entries.set(key,value.slice());}};
 const controller=new AbortController();const reason=new Error('cancelled download');let cancel=true;let disposed=0;
 const partial:HttpTransport=async()=>({status:200,statusText:'OK',headers:[],body:(async function*(){yield bytes;if(cancel)controller.abort(reason);yield bytes;})(),async dispose(){disposed++;}});
 const env=createPythonPackageEnvironment({cache,transport:partial,authorize:()=>true});const ctx={...context(),signal:controller.signal};const s=await env.prepare(ctx);
 await assert.rejects(env.dispatch('package-open',[s.session,'https://example.org/wheel'],ctx),error=>error===reason);assert.equal(entries.size,0);assert.equal(disposed,1);
 cancel=false;const retry=context();const next=await env.prepare(retry);await env.dispatch('package-open',[next.session,'https://example.org/wheel'],retry);assert.equal(disposed,2);
});
test('content cache corruption fails integrity checks before replay',async()=>{
 const values=new Map<string,Uint8Array>();const cache={async get(key:string){return values.get(key)?.slice();},async set(key:string,value:Uint8Array){values.set(key,value.slice());}};
 const env=createPythonPackageEnvironment({cache,transport:transport(),authorize:()=>true});const ctx=context();const s=await env.prepare(ctx);await env.dispatch('package-open',[s.session,'https://example.org/wheel'],ctx);
 const key=[...values.keys()].find(value=>value.includes('-sha256-'))!;values.set(key,new Uint8Array([1]));
 await assert.rejects(env.dispatch('package-open',[s.session,'https://example.org/wheel'],ctx),/integrity mismatch/);
});
test('invalid package options and malformed manifests fail clearly',async()=>{
 assert.throws(()=>createPythonPackageEnvironment({maxDownloadBytes:0}),/positive integer/);
 assert.throws(()=>createPythonPackageEnvironment({profile:'unknown' as never}),/Unknown Python package profile/);
 const env=createPythonPackageEnvironment({cache:{async get(){return new TextEncoder().encode('bad json');},async set(){}}});await assert.rejects(env.prepare(context()),/environment manifest/);
 const bad=createPythonPackageEnvironment({requirements:['--upgrade']});await assert.rejects(bad.prepare(context()),/Unsupported requirement/);
});
test('cancelled preparation sessions retire even before the caller assigns its start result',async()=>{
 const controller=new AbortController();const ctx={...context(),signal:controller.signal};const env=createPythonPackageEnvironment();const start=await env.prepare(ctx);controller.abort(new Error('retired'));
 await assert.rejects(env.dispatch('package-read',[start.session,'unused',0,1],context()),/session is closed/);
});
test('decoded compressed downloads do not report a misleading encoded content length total',async()=>{
 const events:{bytes?:number;totalBytes?:number}[]=[];const compressed:HttpTransport=async()=>({status:200,statusText:'OK',headers:[['content-encoding','gzip'],['content-length','4']],body:(async function*(){yield bytes;})(),async dispose(){}});
 const env=createPythonPackageEnvironment({transport:compressed,authorize:()=>true,onProgress:event=>events.push(event)});const ctx=context();const start=await env.prepare(ctx);await env.dispatch('package-open',[start.session,'https://example.org/compressed'],ctx);
 assert.deepEqual(events,[{phase:'download',url:'https://example.org/compressed',bytes:bytes.length}]);
});
test('cancellation during manifest read prevents publishing an installed environment',async()=>{
 const controller=new AbortController();const reason=new Error('cancel manifest read');let reads=0;let writes=0;
 const cache={async get(){if(++reads===2)controller.abort(reason);return undefined;},async set(){writes++;}};
 const env=createPythonPackageEnvironment({cache});const ctx={...context(),signal:controller.signal};const start=await env.prepare(ctx);
 await assert.rejects(env.dispatch('package-commit',[start.session,['demo==1']],ctx),error=>error===reason);
 assert.equal(writes,0);
});
test('cancellation during a cached artifact read rejects replay',async()=>{
 const controller=new AbortController();const reason=new Error('cancel cache read');const values=new Map<string,Uint8Array>();let cancel=false;
 const cache={async get(key:string){if(cancel&&key.includes('-sha256-'))controller.abort(reason);return values.get(key);},async set(key:string,value:Uint8Array){values.set(key,value.slice());}};
 const env=createPythonPackageEnvironment({cache,transport:transport(),authorize:()=>true});const ctx={...context(),signal:controller.signal};const start=await env.prepare(ctx);
 await env.dispatch('package-open',[start.session,'https://example.org/wheel'],ctx);cancel=true;
 await assert.rejects(env.dispatch('package-open',[start.session,'https://example.org/wheel'],ctx),error=>error===reason);
});
test('cancellation while caching content does not publish its URL record or report success',async()=>{
 const controller=new AbortController();const reason=new Error('cancel cache write');const keys:string[]=[];
 const cache={async get(){return undefined;},async set(key:string){keys.push(key);controller.abort(reason);}};
 const env=createPythonPackageEnvironment({cache,transport:transport(),authorize:()=>true});const ctx={...context(),signal:controller.signal};const start=await env.prepare(ctx);
 await assert.rejects(env.dispatch('package-open',[start.session,'https://example.org/wheel'],ctx),error=>error===reason);
 assert.equal(keys.length,1);assert.ok(keys[0]?.includes('-sha256-'));
});
test('opened cached artifacts retain authenticated bytes when the host cache buffer changes',async()=>{
 const values=new Map<string,Uint8Array>();
 const cache={async get(key:string){return values.get(key);},async set(key:string,value:Uint8Array){values.set(key,Buffer.from(value));}};
 const env=createPythonPackageEnvironment({cache,transport:transport(),authorize:()=>true});const ctx=context();const start=await env.prepare(ctx);
 await env.dispatch('package-open',[start.session,'https://example.org/wheel'],ctx);
 const opened=await env.dispatch('package-open',[start.session,'https://example.org/wheel'],ctx) as {key:string};
 const key=[...values.keys()].find(value=>value.includes('-sha256-'))!;values.get(key)!.fill(0);
 assert.deepEqual(await env.dispatch('package-read',[start.session,opened.key,0,100],ctx),Array.from(bytes));
 await assert.rejects(env.dispatch('package-open',[start.session,'https://example.org/wheel'],ctx),/integrity mismatch/);
});
test('new downloads retain authenticated bytes independently of cache set buffers',async()=>{
 const values=new Map<string,Uint8Array>();
 const cache={async get(key:string){return values.get(key);},async set(key:string,value:Uint8Array){values.set(key,value);}};
 const env=createPythonPackageEnvironment({cache,transport:transport(),authorize:()=>true});const ctx=context();const start=await env.prepare(ctx);
 const opened=await env.dispatch('package-open',[start.session,'https://example.org/wheel'],ctx) as {key:string};
 const key=[...values.keys()].find(value=>value.includes('-sha256-'))!;values.get(key)!.fill(0);
 assert.deepEqual(await env.dispatch('package-read',[start.session,opened.key,0,100],ctx),Array.from(bytes));
});
test('cancellation from cached progress rejects opening the artifact',async()=>{
 const controller=new AbortController();const reason=new Error('cancel cached progress');
 const env=createPythonPackageEnvironment({transport:transport(),authorize:()=>true,onProgress:event=>{if(event.phase==='cached')controller.abort(reason);}});
 const ctx={...context(),signal:controller.signal};const start=await env.prepare(ctx);
 await env.dispatch('package-open',[start.session,'https://example.org/wheel'],ctx);
 await assert.rejects(env.dispatch('package-open',[start.session,'https://example.org/wheel'],ctx),error=>error===reason);
});
test('cancellation during authorization preserves the abort reason and admits no transport',async()=>{
 const controller=new AbortController();const reason=new Error('cancel authorization');let requests=0;
 const env=createPythonPackageEnvironment({transport:transport(()=>requests++),authorize:()=>{controller.abort(reason);return false;}});
 const ctx={...context(),signal:controller.signal};const start=await env.prepare(ctx);
 await assert.rejects(env.dispatch('package-open',[start.session,'https://example.org/wheel'],ctx),error=>error===reason);
 assert.equal(requests,0);
});
test('cancellation while receiving a redirect disposes it without authorizing another hop',async()=>{
 const controller=new AbortController();const reason=new Error('cancel redirect');let authorized=0;let disposed=0;
 const redirected:HttpTransport=async()=>{controller.abort(reason);return {status:302,statusText:'Found',headers:[['location','https://example.org/next']],body:(async function*(){})(),async dispose(){disposed++;}};};
 const env=createPythonPackageEnvironment({transport:redirected,authorize:()=>{authorized++;return true;}});
 const ctx={...context(),signal:controller.signal};const start=await env.prepare(ctx);
 await assert.rejects(env.dispatch('package-open',[start.session,'https://example.org/wheel'],ctx),error=>error===reason);
 assert.equal(authorized,1);assert.equal(disposed,1);
});
test('preparation binds prior requirements and conflict detection to the same manifest snapshot',async()=>{
 const oldManifest=Buffer.from('["old==1"]');const newManifest=Buffer.from('["new==1"]');let writes=0;
 const cache={async get(){return oldManifest;},async set(){writes++;}};
 const base=context();await base.fs.writeFile('/requirements.txt',new TextEncoder().encode('extra==1'));
 const readFile=base.fs.readFile.bind(base.fs);
 base.fs.readFile=async(...args:Parameters<typeof base.fs.readFile>)=>{newManifest.copy(oldManifest);return readFile(...args);};
 const ctx=base;const env=createPythonPackageEnvironment({cache,requirementFiles:['/requirements.txt']});const start=await env.prepare(ctx);
 assert.deepEqual(start.requirements,['old==1','extra==1']);
 await assert.rejects(env.dispatch('package-commit',[start.session,['old==1','extra==1']],ctx),/changed.*retry/i);
 assert.equal(writes,0);
});
test('memory cache evicts artifacts within its byte budget and offline misses remain explicit',async()=>{
 const ctx=context();let calls=0;
 const env=createPythonPackageEnvironment({maxCacheBytes:512,transport:async()=>({status:200,statusText:'OK',headers:[],body:(async function*(){yield new Uint8Array(256).fill(++calls);})(),async dispose(){}}),authorize:()=>true});
 const start=await env.prepare(ctx);
 await env.dispatch('package-open',[start.session,'https://example.org/one'],ctx);
 await env.dispatch('package-open',[start.session,'https://example.org/two'],ctx);
 env.finish(start);
 const offline=await env.prepare({...ctx,offline:true});
 await assert.rejects(env.dispatch('package-open',[offline.session,'https://example.org/one'],ctx),/Offline package cache miss/);
 assert.equal(calls,2);
 assert.throws(()=>createPythonPackageEnvironment({maxCacheBytes:0}),/maxCacheBytes/);
});
test('package sessions retire prior artifact bytes and close makes them unreadable',async()=>{
 const ctx=context();await ctx.fs.writeFile('/one.whl',new Uint8Array([1]));await ctx.fs.writeFile('/two.whl',new Uint8Array([2]));
 const env=createPythonPackageEnvironment();const start=await env.prepare(ctx);
 const first=await env.dispatch('package-open',[start.session,'file:///one.whl'],ctx) as {key:string};
 const second=await env.dispatch('package-open',[start.session,'file:///two.whl'],ctx) as {key:string};
 await assert.rejects(env.dispatch('package-read',[start.session,first.key,0,1],ctx),/Invalid package chunk/);
 await env.dispatch('package-close',[start.session,second.key],ctx);
 await assert.rejects(env.dispatch('package-read',[start.session,second.key,0,1],ctx),/Invalid package chunk/);
});
test('overlapping artifact downloads in one package session are rejected before starting host work',async()=>{
 const ctx=context();let release!:()=>void;let requested!:()=>void;let calls=0;
 const ready=new Promise<void>(resolve=>{requested=resolve;});const barrier=new Promise<void>(resolve=>{release=resolve;});
 const env=createPythonPackageEnvironment({authorize:()=>true,transport:async()=>{calls++;requested();if(calls===1)await barrier;return {status:200,statusText:'OK',headers:[],body:(async function*(){yield bytes;})(),async dispose(){}};}});
 const start=await env.prepare(ctx);const first=env.dispatch('package-open',[start.session,'https://example.org/one'],ctx);await ready;
 try {await assert.rejects(env.dispatch('package-open',[start.session,'https://example.org/two'],ctx),/already in progress/);assert.equal(calls,1);} finally {release();await first;}
});
test('finished package sessions suppress late download publication',async()=>{
 const ctx=context();let release!:()=>void;let requested!:()=>void;let writes=0;let disposed=0;
 const ready=new Promise<void>(resolve=>{requested=resolve;});const barrier=new Promise<void>(resolve=>{release=resolve;});
 const env=createPythonPackageEnvironment({cache:{async get(){return undefined;},async set(){writes++;}},authorize:()=>true,transport:async()=>{requested();await barrier;return {status:200,statusText:'OK',headers:[],body:(async function*(){yield bytes;})(),async dispose(){disposed++;}};}});
 const start=await env.prepare(ctx);const opening=env.dispatch('package-open',[start.session,'https://example.org/one'],ctx);await ready;env.finish(start);release();
 await assert.rejects(opening,/session is closed/);assert.equal(writes,0);assert.equal(disposed,1);
});
test('artifact cache pressure preserves the installed environment and oversized manifests fail explicitly',async()=>{
 const ctx=context();const env=createPythonPackageEnvironment({maxCacheBytes:128,transport:async()=>({status:200,statusText:'OK',headers:[],body:(async function*(){yield new Uint8Array(120);})(),async dispose(){}}),authorize:()=>true});const start=await env.prepare(ctx);
 await env.dispatch('package-commit',[start.session,['demo==1']],ctx);
 await env.dispatch('package-open',[start.session,'https://example.org/one'],ctx);env.finish(start);
 const next=await env.prepare(ctx);assert.deepEqual(next.requirements,['demo==1']);
 await assert.rejects(env.dispatch('package-commit',[next.session,['x'.repeat(200)]],ctx),/manifest exceeds maxCacheBytes/);
});
test('empty download fragments do not accumulate retained chunks or emit byte progress',async()=>{
 const ctx=context();const events:unknown[]=[];const env=createPythonPackageEnvironment({authorize:()=>true,onProgress:event=>events.push(event),transport:async()=>({status:200,statusText:'OK',headers:[],body:(async function*(){yield new Uint8Array();yield new Uint8Array();yield bytes;})(),async dispose(){}})});
 const start=await env.prepare(ctx);await env.dispatch('package-open',[start.session,'https://example.org/empty-fragments'],ctx);
 assert.deepEqual(events,[{phase:'download',url:'https://example.org/empty-fragments',bytes:bytes.length}]);
});
test('oversized external manifest and cache metadata are rejected before decoding',async()=>{
 const ctx=context();const oversized=new TextEncoder().encode('[]        ');
 await assert.rejects(createPythonPackageEnvironment({maxDownloadBytes:4,cache:{async get(){return oversized;},async set(){}}}).prepare(ctx),/manifest exceeds maxDownloadBytes/);
 let calls=0;const env=createPythonPackageEnvironment({maxDownloadBytes:4,cache:{async get(){return ++calls===1?undefined:oversized;},async set(){}}});const start=await env.prepare(ctx);
 await assert.rejects(env.dispatch('package-open',[start.session,'https://example.org/metadata'],ctx),/metadata exceeds maxDownloadBytes/);
});
test('oversized manifest commits preserve the last usable environment and allow retry',async()=>{
 const ctx=context();const env=createPythonPackageEnvironment({maxDownloadBytes:32});
 const first=await env.prepare(ctx);
 await env.dispatch('package-commit',[first.session,['one==1']],ctx);env.finish(first);
 const next=await env.prepare(ctx);
 await assert.rejects(env.dispatch('package-commit',[next.session,['oversized-package-name-for-this-budget==1']],ctx),/manifest exceeds maxDownloadBytes/);
 env.finish(next);
 const retry=await env.prepare(ctx);
 assert.deepEqual(retry.requirements,['one==1']);
 await env.dispatch('package-commit',[retry.session,['two==2']],ctx);env.finish(retry);
 const final=await env.prepare(ctx);
 assert.deepEqual(final.requirements,['one==1','two==2']);env.finish(final);
});
test('oversized download metadata is rejected before cache publication and can be retried',async()=>{
 const ctx=context();const entries=new Map<string,Uint8Array>();let oversized=true;let requests=0;
 const env=createPythonPackageEnvironment({maxDownloadBytes:256,authorize:()=>true,
  cache:{async get(key){return entries.get(key);},async set(key,value){entries.set(key,value);}},
  transport:async()=>{requests++;return {status:200,statusText:'OK',headers:oversized?[['x-large','x'.repeat(300)]]:[],body:(async function*(){yield bytes;})(),async dispose(){}};},
 });
 const start=await env.prepare(ctx);
 await assert.rejects(env.dispatch('package-open',[start.session,'https://example.org/wheel'],ctx),/metadata exceeds maxDownloadBytes/);
 assert.equal(entries.size,0);
 oversized=false;
 const opened=await env.dispatch('package-open',[start.session,'https://example.org/wheel'],ctx) as {key:string};
 assert.deepEqual(await env.dispatch('package-read',[start.session,opened.key,0,100],ctx),Array.from(bytes));
 env.finish(start);
 const retry=await env.prepare({...ctx,offline:true});
 await env.dispatch('package-open',[retry.session,'https://example.org/wheel'],ctx);
 assert.equal(requests,2);env.finish(retry);
});
