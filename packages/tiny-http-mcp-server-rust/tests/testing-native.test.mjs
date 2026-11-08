import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {spawnSync} from 'node:child_process';
import {createInMemoryTokenVerifier} from '../dist/testing.js';
import {createInMemoryTokenVerifier as reference} from '../../tiny-http-mcp-server/dist/testing.js';
import {TokenVerificationError} from '../dist/index.js';
const native=createRequire(import.meta.url)('../dist/tiny-http-mcp-server-rust.node');
const input={token:'token',resource:'https://resource.example/mcp',authorizationServers:['https://issuer.example'],requiredScopes:['read']};
const issued={token:'token',issuer:input.authorizationServers[0],audience:[input.resource],scopes:['read'],expiresAt:100};
async function outcome(verifier,value){try{return {value:await verifier.verify(value)};}catch(e){return {error:{name:e.name,message:e.message,error:e.error,errorDescription:e.errorDescription,scope:e.scope}};}}

test('token helpers exercise actual native state and all original verification policies',async()=>{
 assert.equal(typeof native.NativeHttpTestTokens,'function');
 const a=createInMemoryTokenVerifier({now:()=>10}),b=reference({now:()=>10});
 for(const claims of [undefined,{iss:'forged',aud:'forged',exp:0,scope:'admin',nested:{role:'reader'}}]){
  const data={...issued,token:claims?'custom':'token',claims,subject:'user',clientId:'client'};
  assert.equal(a.issueToken(data),b.issueToken(data));
 }
 for(const token of ['missing','token','custom'])for(const resource of [input.resource,'wrong'])for(const authorizationServers of [input.authorizationServers,[]])for(const requiredScopes of [[],['read'],['write'],['write','read']]){
  const value={...input,token,resource,authorizationServers,requiredScopes};
  assert.deepEqual(await outcome(a.verifier,value),await outcome(b.verifier,value));
 }
 await assert.rejects(a.verifier.verify({...input,requiredScopes:['write']}),e=>e instanceof TokenVerificationError&&e.error==='insufficient_scope');
});

test('token identifiers preserve collisions, empty strings, lone surrogates and nul',()=>{
 const a=createInMemoryTokenVerifier(),b=reference();
 const values=['test-token-1',undefined,undefined,'','\ud800\0','\ud800\0','token','token'];
 const result=(helper,token)=>{try{return helper.issueToken({...issued,token});}catch(e){return e.message;}};
 for(const token of values)assert.deepEqual(result(a,token),result(b,token));
});

test('clock invocation order, exact expiry and non-finite comparisons match reference',async()=>{
 for(const expiresAt of [0,10,10.5,100,NaN,Infinity,-Infinity])for(const time of [10,NaN,Infinity]){
  let clocksA=0,clocksB=0;
  const a=createInMemoryTokenVerifier({now:()=>{clocksA++;return time;}}),b=reference({now:()=>{clocksB++;return time;}});
  a.issueToken({...issued,expiresAt});b.issueToken({...issued,expiresAt});
  for(const value of [input,{...input,token:'missing'},{...input,resource:'wrong'},{...input,authorizationServers:[]}])assert.deepEqual(await outcome(a.verifier,value),await outcome(b.verifier,value));
  assert.equal(clocksA,clocksB);
 }
});

test('claims stay GC-visible and preserve structured clone values and issue-time ownership',async()=>{
 for(const factory of [createInMemoryTokenVerifier,reference]){
  const helper=factory({now:()=>10}),nested={role:'reader'};
  const cycle={};cycle.self=cycle;
  const data={...issued,audience:[input.resource],scopes:['read'],claims:{nested,cycle,bigint:12n,date:new Date(123),map:new Map([['k',new Set(['v'])]])}};
  helper.issueToken(data);data.audience[0]='wrong';data.scopes[0]='wrong';nested.role='author';
  const first=await helper.verifier.verify(input);assert.equal(first.claims.nested.role,'author');assert.equal(first.claims.cycle.self,first.claims.cycle);assert.equal(first.claims.bigint,12n);
  first.audience[0]='wrong';first.scopes[0]='wrong';first.claims.nested.role='admin';first.claims.map.clear();
  const second=await helper.verifier.verify(input);assert.equal(second.claims.nested.role,'author');assert.equal(second.claims.map.size,1);assert.deepEqual(second.audience,[input.resource]);assert.deepEqual(second.scopes,['read']);
 }
});

test('failed claims capture does not issue a token and duplicate checks precede audience reads',()=>{
 for(const factory of [createInMemoryTokenVerifier,reference]){
  const helper=factory({now:()=>10});
  const claims={get failure(){throw new Error('capture failed');}};
  assert.throws(()=>helper.issueToken({...issued,claims}),/capture failed/);
  assert.equal(helper.issueToken(issued),'token');
  assert.throws(()=>helper.issueToken({...issued,get audience(){throw new Error('audience must not be read');}}),/Token has already been issued: token/);
  assert.throws(()=>helper.issueToken({...issued,token:undefined,claims}),/capture failed/);
  assert.equal(helper.issueToken({...issued,token:undefined}),'test-token-2');
 }
});

test('uncloneable claims fail verification without rejecting issuance',async()=>{
 for(const factory of [createInMemoryTokenVerifier,reference]){
  const helper=factory({now:()=>10});
  assert.equal(helper.issueToken({...issued,claims:{callback:()=>undefined}}),'token');
  await assert.rejects(helper.verifier.verify(input),e=>e.name==='DataCloneError');
 }
});

test('real addon releases test token snapshots and cycles after helper owner drop',()=>{
 const moduleUrl=new URL('../dist/testing.js',import.meta.url).href;
 const child=spawnSync(process.execPath,['--expose-gc','--input-type=module','-e',`
  import assert from 'node:assert/strict';
  import {createInMemoryTokenVerifier} from ${JSON.stringify(moduleUrl)};
  const weak=(()=>{
   const helper=createInMemoryTokenVerifier(),claims={helper};
   claims.self=claims;
   helper.issueToken({issuer:'issuer',audience:['resource'],scopes:[],expiresAt:100,claims});
   return [new WeakRef(helper),new WeakRef(claims)];
  })();
  for(let i=0;i<32;i++){await new Promise(resolve=>setImmediate(resolve));global.gc();}
  assert.ok(weak.every(value=>value.deref()===undefined),'dropped helper must not be rooted by native token state');
 `],{encoding:'utf8',timeout:2000});
 assert.equal(child.status,0,child.stderr||child.stdout);
});
