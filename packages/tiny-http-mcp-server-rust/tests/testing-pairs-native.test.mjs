import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {createTestMcpServer,createHttpTestPairWithTinyClient,createHttpTestPair} from '../dist/testing.js';
const native=createRequire(import.meta.url)('../dist/tiny-http-mcp-server-rust.node');

test('standalone tiny-client pairs execute real embedded native client classes',async()=>{
 assert.equal(typeof native.NativeClient,'function');assert.equal(typeof native.NativeHttpTransport,'function');
 for(const protocolVersion of ['2025-03-26','2026-07-28'])for(const enableJsonResponse of [true,false]){
  const pair=await createHttpTestPairWithTinyClient(createTestMcpServer({enableJsonResponse}),{protocolVersion});
  try{
   assert.equal((await pair.client.listTools()).tools.length,14);
   assert.equal((await pair.client.callTool({name:'echo',arguments:{text:'embedded native 🦀'}})).content[0].text,'embedded native 🦀');
   const initialization=pair.requests.find(request=>request.jsonRpcMethod==='initialize'||request.jsonRpcMethod==='server/discover');
   assert.ok(initialization);assert.equal(initialization.method,'POST');
   if(protocolVersion==='2025-03-26')assert.ok(pair.requests.some(request=>request.sessionId!==null));
   else assert.ok(pair.requests.every(request=>request.sessionId===null));
  }finally{await pair.cleanup();}
  await pair.cleanup();
 }
});

test('tiny-client pair connection failure closes its handle and preserves original error',async()=>{
 let closes=0,forced=0;
 const server={listenHttp:async()=>({url:'not a URL',close:async()=>{closes++;},closeAllConnections:()=>{forced++;}})};
 await assert.rejects(createHttpTestPairWithTinyClient(server),/Invalid URL|invalid url/i);
 assert.equal(closes,1);assert.equal(forced,0);
});

test('tiny-client pair cleanup closes listener despite client close failure and settles both operations',async()=>{
 const pair=await createHttpTestPairWithTinyClient(createTestMcpServer());
 const close=pair.client.close.bind(pair.client);let listenerCloses=0;
 const handleClose=pair.handle.close.bind(pair.handle);
 pair.handle.close=async()=>{listenerCloses++;await handleClose();};
 pair.client.close=async()=>{await close();throw new Error('client close failed');};
 await assert.rejects(pair.cleanup(),/client close failed/);assert.equal(listenerCloses,1);
});

test('explicit SDK development test pair checks native server using official client oracle',async()=>{
 for(const enableJsonResponse of [true,false]){
  const pair=await createHttpTestPair(createTestMcpServer({enableJsonResponse}));
  try{assert.equal((await pair.client.listTools()).tools.length,14);assert.equal((await pair.client.callTool({name:'echo',arguments:{text:'SDK oracle'}})).content[0].text,'SDK oracle');}finally{await pair.cleanup();}
 }
});
