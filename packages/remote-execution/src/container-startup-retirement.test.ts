import {expect,it,vi} from 'vitest';
import {createContainerExecutionDriver} from './deployment.js';

it.each(['response','failure'] as const)('awaits cancellation-ignoring startup before destruction (%s)',async outcome=>{
 let finish!:(response:Response)=>void;
 let fail!:(reason:Error)=>void;
 const events:string[]=[];
 const containerFetch=vi.fn(()=>new Promise<Response>((resolve,reject)=>{finish=resolve;fail=reject;}));
 const destroy=vi.fn(async()=>{events.push('destroyed');});
 const driver=createContainerExecutionDriver({port:8080,lifecycle:{sleepAfter:'5m',keepAlive:false},transport:'rpc'},()=>({containerFetch,destroy}));
 const endpoint=await driver.acquire('tenant');
 const request=endpoint.fetch(new Request('https://media.example/v1/jobs')).catch(error=>error);
 const cleanup=driver.destroy('tenant');
 const acquired=vi.fn();
 const reacquire=driver.acquire('tenant').then(acquired);
 expect(await request).toEqual(new Error('Container endpoint retired'));
 // Request cancellation is prompt, but is not evidence that startup settled.
 const destroyedBeforeStartup=destroy.mock.calls.length;
 const acquiredBeforeStartup=acquired.mock.calls.length;
 const cancel=vi.fn();
 events.push('startup settled');
 if(outcome==='response')finish(new Response(new ReadableStream<Uint8Array>({cancel},{highWaterMark:0})));
 else fail(new Error('Startup failed'));
 await Promise.all([cleanup,reacquire]);
 expect(destroyedBeforeStartup).toBe(0);
 expect(acquiredBeforeStartup).toBe(0);
 expect(events).toEqual(['startup settled','destroyed']);
 expect(destroy).toHaveBeenCalledOnce();
 expect(acquired).toHaveBeenCalledOnce();
 if(outcome==='response')expect(cancel).toHaveBeenCalledOnce();
 await expect(endpoint.fetch(new Request('https://media.example/v1/jobs'))).rejects.toThrow('Container endpoint retired');
});
