import {expect,it,vi} from 'vitest';
import {createModalExecutionDriver,type ModalService} from './modal-driver.js';
const config={transport:'https',executionClass:'standard-sandbox',port:8080,readinessTimeoutMs:1000} as const;
it('does not extend the selected lease when an SDK handle changes during readiness',async()=>{
 const {service,resolve,fetch}=fixture();let time=100;
 vi.mocked(service.waitUntilReady).mockImplementationOnce(async()=>{
  service.expiresAt=10000;time=200;
 });
 const driver=createModalExecutionDriver(config,resolve,fetch,()=>time);
 await expect((await driver.acquire('tenant')).fetch(new Request('https://public/v1/jobs'))).rejects.toThrow('expired');
 expect(service.tunnels).not.toHaveBeenCalled();expect(fetch).not.toHaveBeenCalled();
});
it('keeps the validated configuration when its borrowed record changes during attachment',async()=>{
 const selected:import('./modal-driver.js').ModalProviderConfig={...config};
 const {service}=fixture();service.expiresAt=10000;
 const fetch=vi.fn(async(_request:Request)=>new Response(null));
 const resolve=vi.fn(async()=>{
  Object.assign(selected,{executionClass:'vm-sandbox',port:9090,readinessTimeoutMs:1});
  return service;
 });
 const driver=createModalExecutionDriver(selected,resolve,fetch,()=>100);
 // A caller can also mutate the borrowed record before the first request.
 selected.readinessTimeoutMs=500;
 await (await driver.acquire('tenant')).fetch(new Request('https://public/v1/jobs'));
 expect(service.waitUntilReady).toHaveBeenCalledWith(1000);
 expect(fetch.mock.calls[0]?.[0].url).toBe('https://sandbox.example/v1/jobs');
 await driver.destroy('tenant');
 expect(service.terminate).toHaveBeenCalledWith({wait:true});
});
it('rejects unsupported execution classes before attaching a service',()=>{
 const resolve=vi.fn();
 expect(()=>createModalExecutionDriver({...config,executionClass:'unknown'} as unknown as import('./modal-driver.js').ModalProviderConfig,resolve)).toThrow('execution class');
 expect(resolve).not.toHaveBeenCalled();
});
function fixture(){
 const service:ModalService={executionClass:'standard-sandbox',expiresAt:200,poll:vi.fn(async()=>null),waitUntilReady:vi.fn(async()=>{}),tunnels:vi.fn(async()=>({8080:{url:'https://sandbox.example'}})),terminate:vi.fn(async()=>{})};
 const resolve=vi.fn(async()=>service);const fetch=vi.fn(async()=>new Response(null));
 return {service,resolve,fetch,driver:createModalExecutionDriver(config,resolve,fetch,()=>100)};
}
it('requires readiness before forwarding and refreshes tunnels for warm requests',async()=>{
 const {driver,service,fetch}=fixture();const endpoint=await driver.acquire('tenant');
 await endpoint.fetch(new Request('https://public/v1/capabilities'));await endpoint.fetch(new Request('https://public/v1/capabilities'));
 expect(service.waitUntilReady).toHaveBeenCalledTimes(2);expect(service.tunnels).toHaveBeenCalledTimes(2);expect(fetch).toHaveBeenCalledTimes(2);
});
it('refuses finished servers and readiness failure without starting or replaying jobs',async()=>{
 const {driver,service,fetch}=fixture();vi.mocked(service.poll).mockResolvedValueOnce(1);
 const endpoint=await driver.acquire('tenant');await expect(endpoint.fetch(new Request('https://public/v1/jobs'))).rejects.toThrow('finished');
 vi.mocked(service.waitUntilReady).mockRejectedValueOnce(new Error('readiness failed'));
 await expect(endpoint.fetch(new Request('https://public/v1/jobs'))).rejects.toThrow('readiness failed');expect(fetch).not.toHaveBeenCalled();
});
it('never silently selects VM execution and awaits explicit termination',async()=>{
 const {driver,service,fetch}=fixture();service.executionClass='vm-sandbox';
 await expect((await driver.acquire('tenant')).fetch(new Request('https://public/v1/jobs'))).rejects.toThrow('class mismatch');expect(fetch).not.toHaveBeenCalled();
 service.executionClass='standard-sandbox';await driver.destroy('tenant');expect(service.terminate).toHaveBeenCalledWith({wait:true});
});
it('can clean up a service after its lease expires',async()=>{
 const {driver,service}=fixture();service.expiresAt=100;
 await driver.destroy('tenant');expect(service.terminate).toHaveBeenCalledWith({wait:true});
});
it('retires pending readiness and detaches its connection before terminating the service',async()=>{
 const {driver,service,fetch}=fixture();service.detach=vi.fn();
 let started!:()=>void;
 const ready=new Promise<void>(resolve=>{started=resolve;});
 vi.mocked(service.waitUntilReady).mockImplementationOnce(()=>{started();return new Promise<void>(()=>{});});
 const pending=(await driver.acquire('tenant')).fetch(new Request('https://public/v1/jobs'));
 const cancelled=expect(pending).rejects.toThrow('retired');
 await ready;await driver.destroy('tenant');await cancelled;
 expect(service.detach).toHaveBeenCalledTimes(2);
 expect(service.terminate).toHaveBeenCalledWith({wait:true});
 expect(service.tunnels).not.toHaveBeenCalled();expect(fetch).not.toHaveBeenCalled();
});
it('stops preparation when cancellation arrives during readiness',async()=>{
 const {driver,service,fetch}=fixture();const controller=new AbortController();
 vi.mocked(service.waitUntilReady).mockImplementationOnce(async()=>{controller.abort();});
 await expect((await driver.acquire('tenant')).fetch(new Request('https://public/v1/jobs',{signal:controller.signal}))).rejects.toThrow();
 expect(service.tunnels).not.toHaveBeenCalled();expect(fetch).not.toHaveBeenCalled();
});
it('rejects a service that finishes while readiness is pending',async()=>{
 const {driver,service,fetch}=fixture();vi.mocked(service.poll).mockResolvedValueOnce(null).mockResolvedValueOnce(137);
 await expect((await driver.acquire('tenant')).fetch(new Request('https://public/v1/jobs'))).rejects.toThrow('finished');
 expect(service.tunnels).not.toHaveBeenCalled();expect(fetch).not.toHaveBeenCalled();
});
it('releases local SDK connections after tunnel lookup or readiness failure',async()=>{
 const {driver,service}=fixture();service.detach=vi.fn();
 const endpoint=await driver.acquire('tenant');await endpoint.fetch(new Request('https://public/v1/jobs'));
 expect(service.detach).toHaveBeenCalledTimes(1);
 vi.mocked(service.waitUntilReady).mockRejectedValueOnce(new Error('not ready'));
 await expect(endpoint.fetch(new Request('https://public/v1/jobs'))).rejects.toThrow('not ready');
 expect(service.detach).toHaveBeenCalledTimes(2);
});
it('cancels a pending SDK readiness call without waiting for it to finish',async()=>{
 const {driver,service,fetch}=fixture();service.detach=vi.fn();
 let finish!:()=>void;let started!:()=>void;
 const ready=new Promise<void>(resolve=>{started=resolve;});
 vi.mocked(service.waitUntilReady).mockImplementationOnce(()=>{started();return new Promise<void>(resolve=>{finish=resolve;});});
 const controller=new AbortController();let cancelled=false;
 const result=(await driver.acquire('tenant')).fetch(new Request('https://public/v1/jobs',{signal:controller.signal})).catch(()=>{cancelled=true;});
 await ready;controller.abort();
 for(let turn=0;turn<10;turn++)await Promise.resolve();
 const observed=cancelled;finish();await result;
 expect(observed).toBe(true);expect(service.detach).toHaveBeenCalledOnce();expect(fetch).not.toHaveBeenCalled();
});
it('refuses a server that exits during tunnel lookup',async()=>{
 const {driver,service,fetch}=fixture();
 vi.mocked(service.tunnels).mockImplementationOnce(async()=>{
  vi.mocked(service.poll).mockResolvedValue(137);
  return {8080:{url:'https://sandbox.example'}};
 });
 await expect((await driver.acquire('tenant')).fetch(new Request('https://public/v1/jobs'))).rejects.toThrow('finished');
 expect(fetch).not.toHaveBeenCalled();
});
it('shares one readiness deadline across readiness and tunnel lookup',async()=>{
 const {service,resolve,fetch}=fixture();service.expiresAt=10000;let time=100;
 vi.mocked(service.waitUntilReady).mockImplementationOnce(async()=>{time+=700;});
 const driver=createModalExecutionDriver(config,resolve,fetch,()=>time);
 await (await driver.acquire('tenant')).fetch(new Request('https://public/v1/jobs'));
 expect(service.tunnels).toHaveBeenCalledWith(300);
});
it('cancels pending sandbox lookup and detaches a handle arriving afterwards',async()=>{
 const {service,fetch}=fixture();service.detach=vi.fn();
 let finish!:(value:ModalService)=>void;let started!:()=>void;
 const attached=new Promise<void>(resolve=>{started=resolve;});
 const resolve=()=>{started();return new Promise<ModalService>(done=>{finish=done;});};
 const driver=createModalExecutionDriver(config,resolve,fetch,()=>100);
 const controller=new AbortController();let cancelled=false;
 const result=(await driver.acquire('tenant')).fetch(new Request('https://public/v1/jobs',{signal:controller.signal})).catch(()=>{cancelled=true;});
 await attached;controller.abort();
 for(let turn=0;turn<10;turn++)await Promise.resolve();
 const observed=cancelled;finish(service);await result;
 for(let turn=0;turn<10;turn++)await Promise.resolve();
 expect(observed).toBe(true);expect(service.detach).toHaveBeenCalledOnce();expect(service.poll).not.toHaveBeenCalled();expect(fetch).not.toHaveBeenCalled();
});
it('bounds a stalled readiness call by the lease and clears its timer',async()=>{
 vi.useFakeTimers();
 try {
  const {service,resolve,fetch}=fixture();service.detach=vi.fn();
  let started!:()=>void;const ready=new Promise<void>(done=>{started=done;});
  vi.mocked(service.waitUntilReady).mockImplementationOnce(()=>{started();return new Promise<void>(()=>{});});
  const driver=createModalExecutionDriver(config,resolve,fetch,()=>100);
  const result=(await driver.acquire('tenant')).fetch(new Request('https://public/v1/jobs'));
  const rejected=expect(result).rejects.toThrow('expired');
  await ready;await vi.advanceTimersByTimeAsync(100);await rejected;
  expect(fetch).not.toHaveBeenCalled();expect(service.detach).toHaveBeenCalledOnce();expect(vi.getTimerCount()).toBe(0);
 } finally {vi.useRealTimers();}
});
