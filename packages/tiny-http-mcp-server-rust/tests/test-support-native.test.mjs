import {test} from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {getEventListeners} from 'node:events';
import {PassThrough} from 'node:stream';
import {spawnSync} from 'node:child_process';

const originals={listen:http.Server.prototype.listen,address:http.Server.prototype.address,close:http.Server.prototype.close,fetch:globalThis.fetch};
const own=await import('../dist/test-support.js');
assert.equal(http.Server.prototype.listen,originals.listen);assert.equal(http.Server.prototype.address,originals.address);assert.equal(http.Server.prototype.close,originals.close);assert.equal(globalThis.fetch,originals.fetch);
const {McpClient,HttpTransport}=await import('../../tiny-mcp-client/dist/index.js');

async function listen(server,host='127.0.0.1'){
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,host,resolve);});
 const address=server.address();return `http://${host.includes(':')?`[${host}]`:host}:${address.port}`;
}
async function close(server){await new Promise((resolve,reject)=>server.close(error=>error?reject(error):resolve()));}

test('test-support import is inert and installation is explicit and idempotent',()=>{
 own.installInMemoryHttp();
 const installed={listen:http.Server.prototype.listen,fetch:globalThis.fetch};
 own.installInMemoryHttp();assert.equal(http.Server.prototype.listen,installed.listen);assert.equal(globalThis.fetch,installed.fetch);
});

test('native fixture interoperates over the in-memory bridge in every protocol and response mode',async()=>{
 const {createTestMcpServer:reference}=await import('../../tiny-http-mcp-server/dist/test-support.js');
 for(const protocolVersion of ['2025-03-26','2026-07-28'])for(const enableJsonResponse of [true,false]){
  const a=own.createTestMcpServer({enableJsonResponse}),b=reference({enableJsonResponse});
  const handleA=await a.listenHttp({port:0}),handleB=await b.listenHttp({port:0});
  const clientA=new McpClient({clientInfo:{name:'test',version:'1'},protocolVersion}),clientB=new McpClient({clientInfo:{name:'test',version:'1'},protocolVersion});
  try{
   await clientA.connect(new HttpTransport({url:handleA.url,fetch:own.nodeFetch}));await clientB.connect(new HttpTransport({url:handleB.url,fetch:own.nodeFetch}));
   assert.deepEqual(await clientA.listTools(),await clientB.listTools());
   for(const name of ['echo','reverse','uppercase','get_user','get_list','get_image','get_audio','get_file','get_mixed','throw_sync','throw_async','empty_result','slow','large_output']){
    const params={name,arguments:{text:'Straße 🦀\ud800',id:'user'}};
    assert.deepEqual(await clientA.callTool(params),await clientB.callTool(params),`${protocolVersion}/${enableJsonResponse}/${name}`);
   }
  }finally{await Promise.allSettled([clientA.close(),clientB.close()]);await Promise.all([handleA.close(),handleB.close()]);}
 }
});

test('in-memory fetch preserves request bodies, request overrides, cookies and IPv6',async()=>{
 for(const hostname of ['127.0.0.1','::1']){
  const calls=[];
  const server=http.createServer(async(req,res)=>{
   const chunks=[];for await(const chunk of req)chunks.push(Buffer.from(chunk));
   calls.push({method:req.method,url:req.url,header:req.headers['x-test'],body:Buffer.concat(chunks)});
   res.setHeader('Set-Cookie',['first=one; Path=/','second=two; Path=/']);res.end('ok');
  });
  const url=await listen(server,hostname);
  try{
   const bodies=['text',new URLSearchParams({code:'a b'}),new Uint8Array([0,255,1]),new ReadableStream({start(c){c.enqueue(new Uint8Array([2,3]));c.close();}})];
   for(const body of bodies){const response=await own.nodeFetch(`${url}/submit?q=1`,{method:'POST',headers:{'x-test':'yes'},body});assert.equal(await response.text(),'ok');assert.deepEqual(response.headers.getSetCookie(),['first=one; Path=/','second=two; Path=/']);}
   assert.deepEqual(calls.map(c=>c.body),[Buffer.from('text'),Buffer.from('code=a+b'),Buffer.from([0,255,1]),Buffer.from([2,3])]);
   assert.ok(calls.every(c=>c.method==='POST'&&c.url==='/submit?q=1'&&c.header==='yes'));
   const request=new Request(`${url}/original`,{method:'POST',headers:{'x-test':'original'},body:'original'});
   assert.equal(await (await own.nodeFetch(request,{method:'PUT',headers:{'x-test':'override'},body:'override'})).text(),'ok');
   assert.equal(calls.at(-1).method,'PUT');assert.equal(calls.at(-1).header,'override');assert.equal(calls.at(-1).body.toString(),'override');
  }finally{await close(server);}
 }
});

test('stream cancellation and abort close server response and release signal listeners',async()=>{
 for(const action of ['cancel','abort']){
  let response,closed=0;
  const server=http.createServer((_req,res)=>{response=res;res.on('close',()=>closed++);res.writeHead(200,{'content-type':'text/event-stream'});res.flushHeaders();res.write('data: first\n\n');});
  const url=await listen(server),controller=new AbortController();
  try{
   const result=await own.nodeFetch(url,{signal:controller.signal}),reader=result.body.getReader();
   assert.equal(new TextDecoder().decode((await reader.read()).value),'data: first\n\n');
   if(action==='cancel')await reader.cancel();else{controller.abort(new Error('stop'));await assert.rejects(reader.read(),/stop|abort/i);}
   reader.releaseLock();assert.equal(closed,1);assert.equal(response.destroyed,true);assert.equal(getEventListeners(controller.signal,'abort').length,0);
  }finally{await close(server);}
 }
});

test('pre-abort and abort before headers reject promptly without retained listeners',async()=>{
 let calls=0;
 const server=http.createServer(()=>{calls++;});const url=await listen(server);
 try{
  const before=new AbortController();before.abort(new Error('before'));
  await assert.rejects(own.nodeFetch(url,{signal:before.signal}),/before/);assert.equal(calls,0);
  const pending=new AbortController(),promise=own.nodeFetch(url,{signal:pending.signal});await new Promise(resolve=>setImmediate(resolve));pending.abort(new Error('pending'));
  await assert.rejects(promise,/pending/);assert.equal(getEventListeners(pending.signal,'abort').length,0);
 }finally{await close(server);}
});

test('completed responses do not retain controllers and bodyless statuses are valid',async()=>{
 const server=http.createServer((req,res)=>{res.statusCode=Number(req.url.slice(1));res.end();});const url=await listen(server);
 try{for(const status of [200,204,205,304]){const controller=new AbortController(),response=await own.nodeFetch(`${url}/${status}`,{signal:controller.signal});assert.equal(response.status,status);assert.equal(await response.text(),'');assert.equal(getEventListeners(controller.signal,'abort').length,0);}}finally{await close(server);}
});

test('node fetch uses built-in HTTP for unregistered hosts and propagates streaming request bodies',async t=>{
 const requests=[];
 t.mock.method(http,'request',(_options,callback)=>{
  const request=new PassThrough(),response=new PassThrough();
  response.statusCode=200;response.statusMessage='OK';response.headers={'set-cookie':['one=1','two=2']};
  const chunks=[];request.on('data',chunk=>chunks.push(chunk));request.on('finish',()=>{requests.push(Buffer.concat(chunks));callback(response);response.end('platform');});return request;
 });
 for(const body of [new URLSearchParams({code:'ok'}),new ReadableStream({start(c){c.enqueue(Buffer.from('stream'));c.close();}})]){
  const result=await own.nodeFetch('http://external.example/submit',{method:'POST',body});assert.equal(await result.text(),'platform');assert.deepEqual(result.headers.getSetCookie(),['one=1','two=2']);
 }
 assert.deepEqual(requests.map(v=>v.toString()),['code=ok','stream']);
});

test('cancelled in-memory response cycles are collectible during listener reuse',()=>{
 const moduleUrl=new URL('../dist/test-support.js',import.meta.url).href;
 const child=spawnSync(process.execPath,['--expose-gc','--input-type=module','-e',`
  import assert from 'node:assert/strict';
  import http from 'node:http';
  import {installInMemoryHttp,nodeFetch} from ${JSON.stringify(moduleUrl)};
  installInMemoryHttp();const responses=[];
  const server=http.createServer((_request,response)=>{responses.push(new WeakRef(response));response.writeHead(200,{'content-type':'text/event-stream'});response.flushHeaders();response.write('data: ready\\n\\n');});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const url='http://127.0.0.1:'+server.address().port;
  async function exchange(){const response=await nodeFetch(url);const reader=response.body.getReader();await reader.read();await reader.cancel();reader.releaseLock();}
  for(let i=0;i<128;i++)await exchange();
  for(let i=0;i<8;i++){await new Promise(resolve=>setImmediate(resolve));global.gc();}
  assert.equal(responses.filter(ref=>ref.deref()!==undefined).length,0,'cancelled responses must release during listener reuse');
  await new Promise(resolve=>server.close(resolve));
 `],{encoding:'utf8',timeout:2000});
 assert.equal(child.status,0,child.stderr||child.stdout||child.error?.message);
});
