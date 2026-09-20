import {test} from 'node:test';
import assert from 'node:assert/strict';
import * as own from '../dist/auth.js';
import * as original from '../../tiny-http-mcp-server/dist/auth.js';
import {createProtectedResourceMetadataDocument} from '../dist/index.js';
import {createProtectedResourceMetadataDocument as originalMetadata} from '../../tiny-http-mcp-server/dist/index.js';
function request(authorization,headers={},encrypted=false){return {headers:{host:'resource.example:8080',authorization,...headers},socket:{encrypted}};}
const resource='https://resource.example/mcp';
const verified={token:'opaque',issuer:'https://auth.example',audience:[resource],scopes:['read'],expiresAt:12345,claims:{sub:'user'},subject:'user',clientId:'client'};
const options={resource,authorizationServers:['https://auth.example'],requiredScopes:['read']};
test('native bearer parsing and verifier invocation match original whitespace and scheme contracts',async()=>{
 for(const header of [undefined,'','Bearer','Basic opaque','bearer opaque','Bearer  opaque  ','Bearer \ufeffopaque\u00a0','Bearer a b','Bearer a\tb','Bearer a\nb','Bearer a\vb',['Bearer opaque','Basic other']]){
  const a=request(header),b=request(header),callsA=[],callsB=[];
  const ownOptions={...options,verifier:{verify:async input=>{callsA.push(input);return verified;}}};
  const oldOptions={...options,verifier:{verify:async input=>{callsB.push(input);return verified;}}};
  assert.deepEqual(await own.authorizeBearerRequest(a,ownOptions),await original.authorizeBearerRequest(b,oldOptions));
  assert.deepEqual(callsA,callsB);assert.deepEqual(a.auth,b.auth);
 }
});
test('native bearer challenge URLs honor explicit proxy trust and escape scopes and descriptions',()=>{
 for(const host of [undefined,'resource.example:8080','[::1]:8080','bad host','example/strange'])for(const trusted of [false,true])for(const path of [undefined,'','/','mcp','/mcp/','/two//']){
  const req=request(undefined,{host,'x-forwarded-proto':' https , http','x-forwarded-host':' proxy.example:443 , ignored'});
  for(const opts of [{},{error:'invalid_token',errorDescription:'quote" slash\\',scope:['read','write']},{scope:[]}]){
   assert.equal(own.createBearerChallenge(req,opts,path,trusted),original.createBearerChallenge(req,opts,path,trusted));
  }
 }
});
test('native verifier error admission matches structured and arbitrary thrown values',async()=>{
 const errors=[new Error('private message'),null,12,'failure',{error:'temporarily_unavailable'},...['invalid_token','insufficient_scope','other'].flatMap(error=>[undefined,null,12,'description'].flatMap(errorDescription=>[undefined,null,[],['write'],[1]].map(scope=>({error,errorDescription,scope}))))];
 for(const error of errors){
  const verifier={verify:async()=>{throw error;}};
  assert.deepEqual(await own.authorizeBearerRequest(request('Bearer opaque'),{...options,verifier}),await original.authorizeBearerRequest(request('Bearer opaque'),{...options,verifier}));
 }
});
test('native auth scope rejection and cloned auth info match original identities',async()=>{
 const token={...verified,scopes:['write']},verifier={verify:async()=>token};
 assert.deepEqual(await own.authorizeBearerRequest(request('Bearer opaque'),{...options,verifier}),await original.authorizeBearerRequest(request('Bearer opaque'),{...options,verifier}));
 const result=await own.authorizeBearerRequest(request('Bearer opaque'),{...options,verifier:{verify:async()=>verified}});
 assert.notEqual(result.auth.audience,verified.audience);assert.notEqual(result.auth.scopes,verified.scopes);assert.notEqual(result.auth.claims,verified.claims);
 assert.equal(result.auth.extra.audience,result.auth.audience);assert.equal(result.auth.extra.claims,result.auth.claims);
});
test('native protected-resource document accepts URL primitives and copies optional lists',()=>{
 const opts={resource:new URL(resource),authorizationServers:[new URL('https://auth.example')],bearerMethodsSupported:['header'],scopesSupported:['read']};
 const result=createProtectedResourceMetadataDocument(opts);
 assert.deepEqual(result,originalMetadata(opts));assert.notEqual(result.scopes_supported,opts.scopesSupported);
});
test('arbitrary verifier error fields do not invoke serialization hooks or traverse cycles',async()=>{
 const cycle=[];cycle.push(cycle);
 const hook={toJSON(){throw new Error('serialization must not run');}};
 for(const error of [{error:'invalid_token',errorDescription:12n},{error:'insufficient_scope',scope:cycle},{error:'invalid_token',errorDescription:hook},{error:hook}]){
  const verifier={verify:async()=>{throw error;}};
  assert.deepEqual(await own.authorizeBearerRequest(request('Bearer opaque'),{...options,verifier}),await original.authorizeBearerRequest(request('Bearer opaque'),{...options,verifier}));
 }
});
