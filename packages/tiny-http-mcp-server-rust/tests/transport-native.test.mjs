import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Readable} from 'node:stream';
import {EventEmitter} from 'node:events';
import * as rust from '../dist/index.js';
import * as reference from '../../tiny-http-mcp-server/dist/index.js';
class Response extends EventEmitter{
 statusCode=200;headers={};chunks=[];headersSent=false;writableEnded=false;destroyed=false;writableLength=0;
 writeHead(status,headers){this.statusCode=status;this.headers=headers;this.headersSent=true;return this;}
 write(data){this.chunks.push(data);return true;}
 end(data){if(data!==undefined)this.write(data);this.writableEnded=true;this.emit('finish');return this;}
 destroy(){this.destroyed=true;this.emit('close');}
 flushHeaders(){}
}
function request(body,headers={},method='POST'){
 const req=Readable.from(body===undefined?[]:[typeof body==='string'?body:JSON.stringify(body)]);
 Object.assign(req,{headers:{host:'127.0.0.1','content-type':'application/json',accept:'application/json, text/event-stream',...headers},method,url:'/mcp',socket:{}});return req;
}
async function exchange(server,body,headers={},method='POST'){
 const response=new Response();await server.handleRequest(request(body,headers,method),response);return response;
}
const init={jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:'2025-03-26'}};
test('native HTTP factory executes complete legacy session initialize tool notification delete lifecycle',async()=>{
 const server=rust.createHttpServer({name:'native',version:'1',enableJsonResponse:true,sessionIdGenerator:()=> 'session',sseKeepAliveMs:0});
 server.tool('echo','Echo',{type:'object',properties:{value:{type:'string'}}},(args,context)=>{assert.equal(context.request.headers['mcp-session-id'],'session');return args.value;});
 const initialized=await exchange(server,init);assert.equal(initialized.statusCode,200);assert.equal(initialized.headers['Mcp-Session-Id'],'session');
 const headers={'mcp-session-id':'session','mcp-protocol-version':'2025-03-26'};
 assert.equal((await exchange(server,{jsonrpc:'2.0',method:'notifications/initialized'},headers)).statusCode,202);
 const result=await exchange(server,{jsonrpc:'2.0',id:2,method:'tools/call',params:{name:'echo',arguments:{value:'native'}}},headers);
 assert.deepEqual(JSON.parse(result.chunks.join('')),{jsonrpc:'2.0',id:2,result:{content:[{type:'text',text:'native'}]}});
 assert.equal((await exchange(server,undefined,headers,'DELETE')).statusCode,204);
});
test('native HTTP modern metadata runs through own embeddable server with no legacy session',async()=>{
 const server=rust.createHttpServer({name:'modern',version:'1',enableJsonResponse:true,sseKeepAliveMs:0});
 const req={jsonrpc:'2.0',id:1,method:'server/discover',params:{_meta:{'io.modelcontextprotocol/protocolVersion':'2026-07-28','io.modelcontextprotocol/clientCapabilities':{}}}};
 const response=await exchange(server,req,{'mcp-protocol-version':'2026-07-28','mcp-method':'server/discover'});
 assert.equal(response.statusCode,200);assert.equal(response.headers['Mcp-Session-Id'],undefined);assert.equal(JSON.parse(response.chunks.join('')).result.resultType,'complete');
});
test('native HTTP security and rejection/status/body contracts match original transport',async()=>{
 for(const [body,headers,method] of [[init,{host:'untrusted.example'},'POST'],[init,{origin:'https://foreign.example'},'POST'],[init,{accept:'image/png'},'POST'],[init,{'content-type':'text/plain'},'POST'],['not json',{},'POST'],[undefined,{},'GET'],[undefined,{},'DELETE'],[undefined,{},'OPTIONS'],[undefined,{},'PATCH']]){
  const opts={name:'security',version:'1',enableJsonResponse:true,sessionIdGenerator:undefined,sseKeepAliveMs:0};
  const a=await exchange(rust.createHttpServer(opts),body,headers,method),b=await exchange(reference.createHttpServer(opts),body,headers,method);
  assert.equal(a.statusCode,b.statusCode);assert.deepEqual(a.headers,b.headers);assert.deepEqual(a.chunks,b.chunks);
 }
});
test('standalone HTTP addon JWKS verifier accepts JOSE signed tokens and coalesces native cache requests',async()=>{
 const {generateKeyPairSync}=await import('node:crypto'),{SignJWT}=await import('jose');
 const pair=generateKeyPairSync('ec',{namedCurve:'P-256'}),jwk={...pair.publicKey.export({format:'jwk'}),kid:'key',alg:'ES256',use:'sig'};
 const resource='https://resource.example/mcp',issuer='https://auth.example';let requests=0;
 const verifier=rust.createJwksTokenVerifier({jwksUrl:`${issuer}/jwks`,fetch:async()=>{requests++;return globalThis.Response.json({keys:[jwk]});}});
 const token=await new SignJWT({scope:'read',client_id:'client'}).setProtectedHeader({alg:'ES256',kid:'key'}).setIssuer(issuer).setSubject('user').setAudience(resource).setExpirationTime('1h').sign(pair.privateKey);
 const input={token,resource,authorizationServers:[issuer],requiredScopes:['read']};
 const outcomes=await Promise.all(Array.from({length:32},()=>verifier.verify(input)));
 assert.equal(requests,1);for(const outcome of outcomes)assert.equal(outcome.subject,'user');
});
test('unused cyclic or getter-bearing notification results are not serialized by HTTP admission',async()=>{
 for(const value of ['cycle','getter']){
  const result={};if(value==='cycle')result.self=result;else Object.defineProperty(result,'unused',{enumerable:true,get(){throw new Error('unused notification result getter');}});
  const opts={name:'notification',version:'1',enableJsonResponse:true,sessionIdGenerator:()=> 'session',sseKeepAliveMs:0};
  const a=rust.createHttpServer(opts),b=reference.createHttpServer(opts);a.method('notify',()=>result);b.method('notify',()=>result);
  await exchange(a,init);await exchange(b,init);const headers={'mcp-session-id':'session'};
  await exchange(a,{jsonrpc:'2.0',method:'notifications/initialized'},headers);await exchange(b,{jsonrpc:'2.0',method:'notifications/initialized'},headers);
  const own=await exchange(a,{jsonrpc:'2.0',method:'notify'},headers),old=await exchange(b,{jsonrpc:'2.0',method:'notify'},headers);
  assert.equal(own.statusCode,old.statusCode);assert.equal(own.statusCode,202);
 }
});
test('failed tool observation never reads an unused result or its isError getter',async()=>{
 const result={};Object.defineProperty(result,'isError',{enumerable:true,get(){throw new Error('failed tool result getter was read');}});
 const fake={handleMessage:async()=>({error:{code:-32603,message:'failure'},result})},opts={enableJsonResponse:true,sessionIdGenerator:undefined,sseKeepAliveMs:0,observability:{onEvent(){}}};
 const own=new rust.StreamableHttpTransport(fake,opts),old=new reference.StreamableHttpTransport(fake,opts);
 const body={jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'failed'}};
 const a=await exchange(own,body),b=await exchange(old,body);
 assert.equal(a.statusCode,b.statusCode);assert.equal(a.statusCode,200);assert.deepEqual(a.chunks,b.chunks);await own.close();await old.close();
});
