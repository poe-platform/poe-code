import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Readable} from 'node:stream';
import * as own from '../dist/parse-body.js';
import * as original from '../../tiny-http-mcp-server/dist/parse-body.js';
import {validateModernHeaders} from '../dist/modern-headers.js';
import {validateModernHeaders as originalHeaders} from '../../tiny-http-mcp-server/dist/modern-headers.js';
import {formatSseEvent} from '../dist/sse.js';
import {formatSseEvent as originalSse} from '../../tiny-http-mcp-server/dist/sse.js';
const capture=async(fn)=>{try{return {value:await fn()}}catch(e){return {error:{name:e.name,message:e.message,...('id'in e?{id:e.id,code:e.code}:{})}}}};
test('native body classifier matches request notification response and malformed batch contracts',async()=>{
 const messages=[null,12,[],{}, {jsonrpc:'2.0',id:1,method:'ping'}, {jsonrpc:'2.0',method:'notifications/initialized'},
 {jsonrpc:'2.0',id:1,result:null},{jsonrpc:'2.0',id:null,error:{code:-32600,message:'error'}},
 {jsonrpc:'2.0',id:1,result:null,error:{}}, {jsonrpc:'2.0',id:1,method:'ping',result:12},
 {jsonrpc:'2.0',id:'id',method:'ping',params:null}, {jsonrpc:'2.0',id:1.5,method:'ping',params:{_meta:{'io.modelcontextprotocol/protocolVersion':'2026-07-28'}}}];
 const bodies=[...messages,...messages.map(m=>[m]),messages];
 for(const body of bodies)for(const options of [{},{maxBytes:2},{maxBatchSize:1}]){
  const text=JSON.stringify(body),request=()=>Readable.from([text]);
  assert.deepEqual(await capture(()=>own.readAndClassifyBody(request(),undefined,options)),await capture(()=>original.readAndClassifyBody(request(),undefined,options)),text);
 }
});
test('native body reader rejects malformed UTF8 and preserves multibyte chunk boundaries',async()=>{
 for(const bytes of [[255],[128],[192,175],[237,160,128],[240,159]]){
  await assert.rejects(own.readAndClassifyBody(Readable.from([Buffer.from(bytes)])),{message:'Parse error'});
 }
 const message={jsonrpc:'2.0',id:1,method:'ping',params:{value:'é🚀'}};
 const bytes=Buffer.from(JSON.stringify(message));
 assert.deepEqual(await own.readAndClassifyBody(Readable.from([...bytes].map(byte=>Buffer.from([byte])))),await original.readAndClassifyBody(Readable.from([bytes])));
});
test('native modern header mirrors match decoded names and duplicate/missing metadata admission',()=>{
 const request={jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'世界',_meta:{'io.modelcontextprotocol/protocolVersion':'2026-07-28'}}};
 const baseline={'mcp-protocol-version':'2026-07-28','mcp-method':'tools/call','mcp-name':'=?base64?5LiW55WM?='};
 for(const field of Object.keys(baseline))for(const value of [undefined,null,12,'wrong',baseline[field],[baseline[field]],'=?base64?%%%?=','世界']){
  const headers={...baseline,[field]:value};assert.deepEqual(validateModernHeaders(headers,request),originalHeaders(headers,request));
 }
 assert.deepEqual(validateModernHeaders(baseline,{method:'ping'}),originalHeaders(baseline,{method:'ping'}));
});
test('native SSE formatter matches every CR/LF boundary and UTF16 data',()=>{
 for(const data of ['', 'a','\r','\n','\r\n','a\rb\r\nc\n','🚀\ud800\udc00\ud800'])for(const id of [undefined,'','12'])for(const event of [undefined,'','message']){
  const input={data,id,event};assert.equal(formatSseEvent(input),originalSse(input));
 }
});
test('body byte limit takes precedence over earlier malformed UTF8 and read errors remain observable',async()=>{
 const request=()=>Readable.from([Buffer.from([255]),Buffer.alloc(8)]);
 const opts={maxBytes:4};
 assert.deepEqual(await capture(()=>own.readAndClassifyBody(request(),undefined,opts)),await capture(()=>original.readAndClassifyBody(request(),undefined,opts)));
});
test('classified arrays share each admitted message identity without duplicating payloads',async()=>{
 const messages=[{jsonrpc:'2.0',id:1,method:'ping'},{jsonrpc:'2.0',method:'initialized'},{jsonrpc:'2.0',id:2,result:{data:'value'}}];
 const result=await own.readAndClassifyBody(Readable.from([JSON.stringify(messages)]));
 assert.equal(result.requests[0],result.entries[0]);assert.equal(result.notifications[0],result.entries[1]);assert.equal(result.responses[0],result.entries[2]);
 for(let i=0;i<messages.length;i++)assert.equal(result.messages[i],result.entries[i]);
});
