import {beforeEach,expect,it,vi} from 'vitest';
const sdk=vi.hoisted(()=>({getSandbox:vi.fn(),containerFetch:vi.fn()}));
vi.mock('@cloudflare/sandbox',()=>({getSandbox:sdk.getSandbox,Sandbox:class {}}));
import worker from '../cloudflare/worker.js';
import provider from './providers/cloudflare.js';
beforeEach(()=>{
 vi.clearAllMocks();
 sdk.getSandbox.mockReturnValue({containerFetch:sdk.containerFetch,destroy:vi.fn()});
});
function environment(response:Response){
 return {Sandbox:{} as never,AUTHORIZATION:{fetch:vi.fn(async()=>response)} as never};
}
it('encodes opaque caller identities consistently across authenticated requests',async()=>{
 const owners=['root','caller@example.com/'+'x'.repeat(100),'Alice','alice'];
 const ids:string[]=[];
 for(const owner of owners){
  sdk.containerFetch.mockResolvedValue(new Response(null,{status:204}));
  const env=environment(Response.json({namespaceId:owner,expiresAt:Date.now()+60000}));
  expect((await worker.fetch(new Request('https://media.example/v1/jobs',{headers:{Authorization:'Bearer valid'}}),env)).status).toBe(204);
  const id=sdk.getSandbox.mock.calls.at(-1)![1] as string;
  expect(id.length).toBe(58);
  expect(id.startsWith('media-')).toBe(true);
  expect([...id].every(char=>'abcdefghijklmnopqrstuvwxyz234567-'.includes(char))).toBe(true);
  ids.push(id);
 }
 expect(new Set(ids).size).toBe(owners.length);
 sdk.containerFetch.mockResolvedValue(new Response(null,{status:204}));
 await worker.fetch(new Request('https://media.example/v1/jobs',{headers:{Authorization:'Bearer valid'}}),environment(Response.json({namespaceId:owners[1],expiresAt:Date.now()+60000})));
 expect(sdk.getSandbox.mock.calls.at(-1)![1]).toBe(ids[1]);
});
it('authorizes the production audience before resolving a stable SDK sandbox',async()=>{
 const env=environment(Response.json({namespaceId:'tenant',expiresAt:Date.now()+60000}));
 const bytes=new Uint8Array([0,255,128]);
 sdk.containerFetch.mockImplementation(async(request:Request,port:number)=>{
  expect(port).toBe(8080);expect(request.headers.get('Range')).toBe('bytes=0-2');
  return new Response(bytes,{status:206,headers:{'Content-Range':'bytes 0-2/3','Execution-Epoch':'epoch'}});
 });
 const request=new Request('https://media.example/v1/files/file',{headers:{Authorization:'Bearer valid',Range:'bytes=0-2'}});
 const response=await worker.fetch(request,env);
 const auth=vi.mocked(env.AUTHORIZATION.fetch).mock.calls[0] as unknown as [string,RequestInit];
 expect(JSON.parse(auth[1].body as string)).toEqual({audience:'https://media.example',method:'GET',path:'/v1/files/file'});
 expect(sdk.getSandbox).toHaveBeenCalledWith(env.Sandbox,'media-jyo3mhueuekzsllgnurlcihn4lhlxp72oeroxospwg7drbjwfvia',{sleepAfter:'5m',keepAlive:false,enableDefaultSession:false,containerTimeouts:{instanceGetTimeoutMS:30000,portReadyTimeoutMS:90000},transport:'rpc',normalizeId:false});
 expect(sdk.containerFetch.mock.calls[0]![0].headers.get('Range')).toBe('bytes=0-2');
 expect(response.status).toBe(206);expect(response.headers.get('Execution-Epoch')).toBe('epoch');
 expect(new Uint8Array(await response.arrayBuffer())).toEqual(bytes);
});
it('fails closed on malformed authorization responses without starting a container',async()=>{
 const response=await worker.fetch(new Request('https://media.example/v1/jobs',{headers:{Authorization:'Bearer valid'}}),environment(new Response('invalid JSON')));
 expect(response.status).toBe(401);expect(sdk.getSandbox).not.toHaveBeenCalled();
});
it.each([401,403,503])('releases a denied authorization stream (%s) without acquiring a sandbox',async status=>{
 const cancel=vi.fn();
 const response=await worker.fetch(new Request('https://media.example/v1/jobs',{headers:{Authorization:'Bearer denied'}}),environment(new Response(new ReadableStream<Uint8Array>({cancel},{highWaterMark:0}),{status})));
 expect(response.status).toBe(401);
 expect(cancel).toHaveBeenCalledOnce();
 expect(sdk.getSandbox).not.toHaveBeenCalled();
 expect(sdk.containerFetch).not.toHaveBeenCalled();
});
it('keeps authorization denied when releasing its response fails',async()=>{
 const cancel=vi.fn(async()=>{throw new Error('Authorization transport cleanup failed');});
 const response=await worker.fetch(new Request('https://media.example/v1/jobs',{headers:{Authorization:'Bearer denied'}}),environment(new Response(new ReadableStream<Uint8Array>({cancel},{highWaterMark:0}),{status:403})));
 expect(response.status).toBe(401);
 expect(cancel).toHaveBeenCalledOnce();
 expect(sdk.getSandbox).not.toHaveBeenCalled();
});
it('rejects oversized authorization responses and cancels their stream before acquisition',async()=>{
 const cancel=vi.fn();
 const principal=JSON.stringify({namespaceId:'tenant',expiresAt:Date.now()+60000,padding:'x'.repeat(4096)});
 const env=environment(new Response(new ReadableStream<Uint8Array>({
  start(controller){controller.enqueue(new TextEncoder().encode(principal));},cancel,
 },{highWaterMark:0})));
 const response=await worker.fetch(new Request('https://media.example/v1/jobs',{headers:{Authorization:'Bearer valid'}}),env);
 expect(response.status).toBe(401);
 expect(cancel).toHaveBeenCalledOnce();
 expect(sdk.getSandbox).not.toHaveBeenCalled();
});
it('counts authorization bytes across chunks rather than trusting each chunk size',async()=>{
 const cancel=vi.fn();
 const env=environment(new Response(new ReadableStream<Uint8Array>({
  start(controller){controller.enqueue(new Uint8Array(2048));controller.enqueue(new Uint8Array(2049));},cancel,
 },{highWaterMark:0})));
 expect((await worker.fetch(new Request('https://media.example/v1/jobs',{headers:{Authorization:'Bearer valid'}}),env)).status).toBe(401);
 expect(cancel).toHaveBeenCalledOnce();
 expect(sdk.getSandbox).not.toHaveBeenCalled();
});
it('fails closed when releasing an oversized principal stream fails',async()=>{
 const cancel=vi.fn(async()=>{throw new Error('Principal stream cleanup failed');});
 const principal=new Response(new ReadableStream<Uint8Array>({
  start(controller){controller.enqueue(new Uint8Array(4097));},cancel,
 },{highWaterMark:0}));
 const response=await worker.fetch(new Request('https://media.example/v1/jobs',{headers:{Authorization:'Bearer valid'}}),environment(principal));
 expect(response.status).toBe(401);
 expect(cancel).toHaveBeenCalledOnce();
 expect(sdk.getSandbox).not.toHaveBeenCalled();
 expect(sdk.containerFetch).not.toHaveBeenCalled();
});
it('rejects malformed UTF-8 instead of authorizing a replacement namespace',async()=>{
 const prefix=new TextEncoder().encode('{"namespaceId":"');
 const suffix=new TextEncoder().encode('","expiresAt":'+(Date.now()+60000)+'}');
 const bytes=new Uint8Array(prefix.length+1+suffix.length);
 bytes.set(prefix);bytes[prefix.length]=255;bytes.set(suffix,prefix.length+1);
 expect((await worker.fetch(new Request('https://media.example/v1/jobs',{headers:{Authorization:'Bearer valid'}}),environment(new Response(bytes)))).status).toBe(401);
 expect(sdk.getSandbox).not.toHaveBeenCalled();
});
it('accepts a principal at the authorization byte boundary',async()=>{
 const json=JSON.stringify({namespaceId:'tenant',expiresAt:Date.now()+60000});
 sdk.containerFetch.mockResolvedValue(new Response(null,{status:204}));
 const response=await worker.fetch(new Request('https://media.example/v1/jobs',{headers:{Authorization:'Bearer valid'}}),environment(new Response(json.padEnd(4096,' '))));
 expect(response.status).toBe(204);
 expect(sdk.getSandbox).toHaveBeenCalledOnce();
});
it('fails closed when the authorization service is unavailable without starting a container',async()=>{
 const env={Sandbox:{} as never,AUTHORIZATION:{fetch:vi.fn().mockRejectedValue(new Error('Authorization service unavailable'))} as never};
 const response=await worker.fetch(new Request('https://media.example/v1/jobs',{headers:{Authorization:'Bearer valid'}}),env);
 expect(response.status).toBe(401);
 expect(response.headers.get('Cache-Control')).toBe('no-store');
 expect(sdk.getSandbox).not.toHaveBeenCalled();
 expect(sdk.containerFetch).not.toHaveBeenCalled();
});
it('preserves caller cancellation while authorizing without starting a container',async()=>{
 const abort=new AbortController();
 const reason=new Error('Caller cancelled');
 const env={Sandbox:{} as never,AUTHORIZATION:{fetch:vi.fn(async()=>{abort.abort(reason);throw reason;})} as never};
 await expect(worker.fetch(new Request('https://media.example/v1/jobs',{headers:{Authorization:'Bearer valid'},signal:abort.signal}),env)).rejects.toThrow(reason);
 expect(sdk.getSandbox).not.toHaveBeenCalled();
});
it('preserves caller cancellation while reading the authorization principal',async()=>{
 const abort=new AbortController();
 const reason=new Error('Caller cancelled while reading principal');
 const cancel=vi.fn();
 const principal=new Response(new ReadableStream<Uint8Array>({pull(){abort.abort(reason);},cancel},{highWaterMark:0}));
 await expect(worker.fetch(new Request('https://media.example/v1/jobs',{headers:{Authorization:'Bearer valid'},signal:abort.signal}),environment(principal))).rejects.toThrow(reason);
 expect(sdk.getSandbox).not.toHaveBeenCalled();
 expect(sdk.containerFetch).not.toHaveBeenCalled();
 expect(cancel).toHaveBeenCalledOnce();
});
it('never acquires for missing or expired credentials or non-protocol paths',async()=>{
 const env=environment(Response.json({namespaceId:'tenant',expiresAt:0}));
 expect((await worker.fetch(new Request('https://media.example/v1/jobs'),env)).status).toBe(401);
 expect((await worker.fetch(new Request('https://media.example/v1/jobs',{headers:{Authorization:'Bearer expired'}}),env)).status).toBe(401);
 expect((await worker.fetch(new Request('https://media.example/admin'),env)).status).toBe(404);
 expect(sdk.getSandbox).not.toHaveBeenCalled();
});
it('preserves simultaneous binary streams without waiting for input EOF',async()=>{
 let input!:ReadableStreamDefaultController<Uint8Array>;
 const body=new ReadableStream<Uint8Array>({start(controller){input=controller;}});
 let reader!:ReadableStreamDefaultReader<Uint8Array>;
 let output!:ReadableStreamDefaultController<Uint8Array>;
 sdk.containerFetch.mockImplementation(async(request:Request)=>{
  reader=request.body!.getReader();
  return new Response(new ReadableStream({start(controller){output=controller;controller.enqueue(new Uint8Array([255,0,128]));}}));
 });
 const response=await worker.fetch(new Request('https://media.example/v1/jobs',{method:'POST',headers:{Authorization:'Bearer valid'},body,duplex:'half'} as RequestInit),environment(Response.json({namespaceId:'tenant',expiresAt:Date.now()+60000})));
 const downstream=response.body!.getReader();
 expect((await downstream.read()).value).toEqual(new Uint8Array([255,0,128]));
 input.enqueue(new Uint8Array([0,128,255]));input.close();
 expect((await reader.read()).value).toEqual(new Uint8Array([0,128,255]));
 expect((await reader.read()).done).toBe(true);
 output.close();expect((await downstream.read()).done).toBe(true);
});

it('enforces declarative response budgets without buffering the media stream',async()=>{
 const cancel=vi.fn();
 sdk.containerFetch.mockResolvedValue(new Response(new ReadableStream({start(controller){controller.enqueue(new Uint8Array(provider.transferLimits.maxChunkBytes+1));},cancel})));
 const response=await worker.fetch(new Request('https://media.example/v1/jobs/job/stdout',{headers:{Authorization:'Bearer valid'}}),environment(Response.json({namespaceId:'tenant',expiresAt:Date.now()+60000})));
 await expect(response.body!.getReader().read()).rejects.toThrow('Transfer byte limit');
 expect(cancel).toHaveBeenCalledOnce();
});

it('cuts off a blocked media response at credential expiry',async()=>{
 const cancel=vi.fn();
 sdk.containerFetch.mockResolvedValue(new Response(new ReadableStream({cancel},{highWaterMark:0})));
 const response=await worker.fetch(new Request('https://media.example/v1/jobs/job/stdout',{headers:{Authorization:'Bearer valid'}}),environment(Response.json({namespaceId:'tenant',expiresAt:Date.now()+100})));
 await expect(response.body!.getReader().read()).rejects.toThrow();
 expect(cancel).toHaveBeenCalledOnce();
});
