import {beforeEach,expect,it,vi} from 'vitest';
const sdk=vi.hoisted(()=>({getSandbox:vi.fn(),containerFetch:vi.fn()}));
vi.mock('@cloudflare/sandbox',()=>({getSandbox:sdk.getSandbox,Sandbox:class {}}));
import worker from '../cloudflare/worker.js';
import provider from './providers/cloudflare.js';

beforeEach(()=>{
 vi.clearAllMocks();
 sdk.getSandbox.mockReturnValue({containerFetch:sdk.containerFetch,destroy:vi.fn()});
});
function environment(){
 return {Sandbox:{} as never,AUTHORIZATION:{fetch:vi.fn(async()=>Response.json({namespaceId:'authorized-tenant',expiresAt:Date.now()+60000}))} as never};
}
function request(path:string,init:RequestInit={}){
 return new Request('https://media.example/v1/'+path,{...init,headers:{Authorization:'Bearer valid','X-Namespace-Id':'forged',...init.headers}});
}

it('rejects an oversized binary upload and retires both transports without replay',async()=>{
 const cancelInput=vi.fn();const cancelOutput=vi.fn();
 let incoming!:ReadableStreamDefaultReader<Uint8Array>;
 let signal!:AbortSignal;
 sdk.containerFetch.mockImplementation(async(forwarded:Request)=>{
  expect(forwarded.method).toBe('PUT');
  expect(forwarded.headers.get('If-Match')).toBe('"canonical-version"');
  signal=forwarded.signal;incoming=forwarded.body!.getReader();
  return new Response(new ReadableStream<Uint8Array>({cancel:cancelOutput},{highWaterMark:0}));
 });
 const body=new ReadableStream<Uint8Array>({
  start(controller){controller.enqueue(new Uint8Array(provider.transferLimits.maxChunkBytes+1));},
  cancel:cancelInput,
 },{highWaterMark:0});
 const response=await worker.fetch(request('uploads/upload',{method:'PUT',headers:{'If-Match':'"canonical-version"'},body,duplex:'half'} as RequestInit),environment());
 await expect(incoming.read()).rejects.toThrow('Transfer byte limit');
 await expect(response.body!.getReader().read()).rejects.toThrow('Transfer byte limit');
 expect(signal.aborted).toBe(true);
 expect(cancelInput).toHaveBeenCalledOnce();expect(cancelOutput).toHaveBeenCalledOnce();
 expect(sdk.containerFetch).toHaveBeenCalledOnce();
});

it('exchanges every byte value before input EOF and cancels both directions on disconnect',async()=>{
 const bytes=Uint8Array.from({length:256},(_,index)=>index);
 const cancelInput=vi.fn();const cancelOutput=vi.fn();
 let input!:ReadableStreamDefaultController<Uint8Array>;
 let incoming!:ReadableStreamDefaultReader<Uint8Array>;
 let signal!:AbortSignal;
 sdk.containerFetch.mockImplementation(async(forwarded:Request)=>{
  signal=forwarded.signal;incoming=forwarded.body!.getReader();
  return new Response(new ReadableStream({start(controller){controller.enqueue(bytes);},cancel:cancelOutput},{highWaterMark:0}));
 });
 const body=new ReadableStream<Uint8Array>({start(controller){input=controller;},cancel:cancelInput},{highWaterMark:0});
 const env=environment();
 const response=await worker.fetch(request('jobs/job/stdin',{method:'POST',body,duplex:'half'} as RequestInit),env);
 const output=response.body!.getReader();
 expect((await output.read()).value).toEqual(bytes);
 input.enqueue(bytes.slice(0,73));input.enqueue(bytes.slice(73));
 expect((await incoming.read()).value).toEqual(bytes.slice(0,73));
 expect((await incoming.read()).value).toEqual(bytes.slice(73));
 // Input remains open: output delivery cannot depend on collecting stdin.
 await output.cancel('consumer disconnected');
 expect(signal.aborted).toBe(true);
 expect(cancelInput).toHaveBeenCalledOnce();expect(cancelOutput).toHaveBeenCalledOnce();
 expect(sdk.getSandbox).toHaveBeenCalledWith(env.Sandbox,'media-vzhwhnsq7qlctxpb2cmff6ejfac5cybsq55mrtvv6tor2uu4nd5q',expect.any(Object));
 expect(sdk.containerFetch).toHaveBeenCalledOnce();
});

it('preserves canonical version and unsatisfiable range responses without retrying',async()=>{
 sdk.containerFetch.mockImplementation(async(forwarded:Request)=>{
  expect(forwarded.headers.get('Range')).toBe('bytes=256-');
  expect(forwarded.headers.get('If-Match')).toBe('"canonical-version"');
  return new Response(null,{status:416,headers:{'Content-Range':'bytes */256',ETag:'"canonical-version"','Execution-Epoch':'epoch','Cache-Control':'no-store'}});
 });
 const response=await worker.fetch(request('files/retained',{headers:{Range:'bytes=256-','If-Match':'"canonical-version"'}}),environment());
 expect(response.status).toBe(416);
 expect(response.headers.get('Content-Range')).toBe('bytes */256');
 expect(response.headers.get('ETag')).toBe('"canonical-version"');
 expect(response.headers.get('Execution-Epoch')).toBe('epoch');
 expect(response.headers.get('Cache-Control')).toBe('no-store');
 expect(sdk.containerFetch).toHaveBeenCalledOnce();
});

it('returns a replacement epoch conflict without relaunching a native mutation',async()=>{
 sdk.containerFetch.mockImplementation(async(forwarded:Request)=>{
  expect(forwarded.headers.get('Execution-Epoch')).toBe('old-epoch');
  return Response.json({error:'stale epoch'},{status:409,headers:{'Execution-Epoch':'replacement-epoch'}});
 });
 const response=await worker.fetch(request('jobs',{method:'POST',headers:{'Execution-Epoch':'old-epoch'},body:new Uint8Array([0,255])}),environment());
 expect(response.status).toBe(409);
 expect(response.headers.get('Execution-Epoch')).toBe('replacement-epoch');
 expect(await response.json()).toEqual({error:'stale epoch'});
 expect(sdk.containerFetch).toHaveBeenCalledOnce();
});
