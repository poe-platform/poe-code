import {expect,it,vi} from 'vitest';
// The SDK adapter is JavaScript in the independent pinned deployment package.
// @ts-expect-error deployment module is intentionally outside src's TS build
import {createModalServiceResolver,deployModalService} from '../modal/sdk.mjs';
import config from './providers/modal.js';
import {createModalExecutionDriver} from './modal-driver.js';
it('mounts only explicitly selected existing volumes with pinned tenant options',async()=>{
 const sdk=client();const mounted={volumeId:'vo-existing'};
 const withMountOptions=vi.fn(()=>mounted);
 const volumes={fromName:vi.fn(async()=>({withMountOptions}))};
 const mounts={'/data':{name:'shared',subPath:'/tenants/a',readOnly:true}};
 sdk.apps.fromName.mockImplementationOnce(async()=>{mounts['/data'].subPath='/tenants/b';return {};});
 await deployModalService({client:{...sdk,volumes},authorization:{allowSandboxCreation:true},appName:'existing',imageId:'im-pinned',config,lifetimeMs:5000,idleTimeoutMs:1000,readinessProbe:{},volumeMounts:mounts});
 expect(volumes.fromName).toHaveBeenCalledWith('shared',{createIfMissing:false});
 expect(withMountOptions).toHaveBeenCalledWith({subPath:'/tenants/a',readOnly:true});
 expect(sdk.sandboxes.create.mock.calls[0]?.[2].volumes).toEqual({'/data':mounted});
});
it.each(['/','relative','/tenants/../other','/tenants//a'])('rejects unscoped volume subpath %j before cloud lookup',async subPath=>{
 const sdk=client();
 await expect(deployModalService({client:sdk,authorization:{allowSandboxCreation:true},appName:'existing',imageId:'im-pinned',config,lifetimeMs:5000,idleTimeoutMs:1000,readinessProbe:{},volumeMounts:{'/data':{name:'shared',subPath,readOnly:false}}})).rejects.toThrow('volume');
 expect(sdk.apps.fromName).not.toHaveBeenCalled();
 expect(sdk.sandboxes.create).not.toHaveBeenCalled();
});
it('cancels existing volume lookup without provisioning after late completion',async()=>{
 const sdk=client();const abort=new AbortController();const reason=new Error('operator cancelled');
 let finish!:(value:object)=>void;let started!:()=>void;
 const entered=new Promise<void>(resolve=>{started=resolve;});
 const volumes={fromName:vi.fn(()=>{started();return new Promise<object>(resolve=>{finish=resolve;});})};
 const pending=deployModalService({client:{...sdk,volumes},authorization:{allowSandboxCreation:true},appName:'existing',imageId:'im-pinned',config,lifetimeMs:5000,idleTimeoutMs:1000,readinessProbe:{},signal:abort.signal,volumeMounts:{'/data':{name:'shared',subPath:'/tenants/a',readOnly:false}}});
 const rejected=expect(pending).rejects.toBe(reason);
 await entered;abort.abort(reason);await rejected;
 const withMountOptions=vi.fn();finish({withMountOptions});
 for(let turn=0;turn<10;turn++)await Promise.resolve();
 expect(withMountOptions).not.toHaveBeenCalled();expect(sdk.sandboxes.create).not.toHaveBeenCalled();
});
it('stops SDK admission calls when readiness consumes the complete deadline',async()=>{
 const clock=vi.spyOn(Date,'now').mockReturnValue(1000);
 try {
  const sdk=client();
  const service={sandboxId:'sb-existing',detach:vi.fn(),waitUntilReady:vi.fn(async()=>{clock.mockReturnValue(2000);}),poll:vi.fn(async()=>null),terminate:vi.fn(async()=>{})};
  sdk.sandboxes.create.mockResolvedValueOnce(service);
  await expect(deployModalService({client:sdk,authorization:{allowSandboxCreation:true},appName:'existing',imageId:'im-pinned',config:{...config,readinessTimeoutMs:1000},lifetimeMs:5000,idleTimeoutMs:1000,readinessProbe:{}})).rejects.toThrow('readiness deadline');
  expect(service.poll).not.toHaveBeenCalled();
  expect(service.terminate).toHaveBeenCalledWith({wait:true});
  expect(service.detach).toHaveBeenCalledOnce();
 } finally {clock.mockRestore();}
});
it('pins service credentials and port before asynchronous cloud lookups',async()=>{
 const sdk=client();const env={SERVICE_TOKEN:'original',POE_CODE_SERVER_PORT:String(config.port)};
 sdk.apps.fromName.mockImplementationOnce(async()=>{
  env.SERVICE_TOKEN='replacement';env.POE_CODE_SERVER_PORT='9090';return {};
 });
 await deployModalService({client:sdk,authorization:{allowSandboxCreation:true},appName:'existing',imageId:'im-pinned',config,lifetimeMs:5000,idleTimeoutMs:1000,readinessProbe:{},env});
 expect(sdk.sandboxes.create.mock.calls[0]?.[2].env).toEqual({SERVICE_TOKEN:'original',POE_CODE_SERVER_PORT:String(config.port)});
});
it('pins the validated readiness deadline while cloud creation is pending',async()=>{
 const sdk=client();const selected={...config,readinessTimeoutMs:1000};
 const clock=vi.spyOn(Date,'now').mockReturnValue(1000);
 const service={sandboxId:'sb-existing',detach:vi.fn(),waitUntilReady:vi.fn(async()=>{}),poll:vi.fn(async()=>null),terminate:vi.fn(async()=>{})};
 sdk.sandboxes.create.mockImplementationOnce(async()=>{
  selected.readinessTimeoutMs=1;
  return service;
 });
 try {
  await deployModalService({client:sdk,authorization:{allowSandboxCreation:true},appName:'existing',imageId:'im-pinned',config:selected,lifetimeMs:5000,idleTimeoutMs:1000,readinessProbe:{}});
  expect(service.waitUntilReady).toHaveBeenCalledWith(1000);
 } finally {clock.mockRestore();}
});
it('pins durable binding metadata before asynchronous SDK attachment',async()=>{
 const sdk=client();
 const binding={sandboxId:'sb-original',executionClass:'standard-sandbox',expiresAt:200};
 sdk.sandboxes.fromId.mockImplementationOnce(async()=>{
  Object.assign(binding,{sandboxId:'sb-replacement',executionClass:'vm-sandbox',expiresAt:500});
  return {detach:vi.fn()};
 });
 const resolve=createModalServiceResolver({client:sdk,lookup:async()=>binding,now:()=>100});
 const service=await resolve('tenant');
 expect(sdk.sandboxes.fromId).toHaveBeenCalledWith('sb-original');
 expect(service).toMatchObject({executionClass:'standard-sandbox',expiresAt:200});
});
it('detaches a binding that expires during SDK attachment without terminating an existing service',async()=>{
 const sdk=client();let now=100;const detach=vi.fn();const terminate=vi.fn();
 sdk.sandboxes.fromId.mockImplementationOnce(async()=>{now=200;return {detach,terminate};});
 const resolve=createModalServiceResolver({client:sdk,lookup:async()=>({sandboxId:'sb-existing',executionClass:'standard-sandbox',expiresAt:200}),now:()=>now});
 await expect(resolve('tenant')).rejects.toThrow('expired');
 expect(detach).toHaveBeenCalledOnce();expect(terminate).not.toHaveBeenCalled();
});
it.each(['app','image'])('rejects cancellation promptly during stalled %s lookup without creating a sandbox',async stage=>{
 const sdk=client();const abort=new AbortController();const reason=new Error('operator cancelled');
 let finish!:(value:object)=>void;let started!:()=>void;
 const entered=new Promise<void>(resolve=>{started=resolve;});
 const lookup=stage==='app'?sdk.apps.fromName:sdk.images.fromId;
 lookup.mockImplementationOnce(()=>{started();return new Promise<object>(resolve=>{finish=resolve;});});
 let failure:unknown;
 const pending=deployModalService({client:sdk,authorization:{allowSandboxCreation:true},appName:'existing',imageId:'im-pinned',config,lifetimeMs:5000,idleTimeoutMs:1000,readinessProbe:{},signal:abort.signal}).catch((error:unknown)=>{failure=error;});
 await entered;abort.abort(reason);
 for(let turn=0;turn<20;turn++)await Promise.resolve();
 const observed=failure;
 finish({});await pending;
 expect(observed).toBe(reason);expect(sdk.sandboxes.create).not.toHaveBeenCalled();
 if(stage==='app')expect(sdk.images.fromId).not.toHaveBeenCalled();
});
it('rejects cancelled provisioning before any cloud lookup',async()=>{
 const sdk=client();const reason=new Error('operator cancelled');
 await expect(deployModalService({client:sdk,authorization:{allowSandboxCreation:true},appName:'existing',imageId:'im-pinned',config,lifetimeMs:5000,idleTimeoutMs:1000,readinessProbe:{},signal:AbortSignal.abort(reason)})).rejects.toBe(reason);
 expect(sdk.apps.fromName).not.toHaveBeenCalled();expect(sdk.sandboxes.create).not.toHaveBeenCalled();
});
it('cancels provisioning during readiness and terminates the owned sandbox',async()=>{
 const sdk=client();const abort=new AbortController();const reason=new Error('operator cancelled');
 let started!:()=>void;const entered=new Promise<void>(resolve=>{started=resolve;});
 const service={sandboxId:'sb-existing',detach:vi.fn(),waitUntilReady:vi.fn(()=>{started();return new Promise<void>(()=>{});}),poll:vi.fn(async()=>null),terminate:vi.fn(async()=>{})};
 sdk.sandboxes.create.mockResolvedValueOnce(service);
 const pending=deployModalService({client:sdk,authorization:{allowSandboxCreation:true},appName:'existing',imageId:'im-pinned',config,lifetimeMs:5000,idleTimeoutMs:1000,readinessProbe:{},signal:abort.signal});
 const rejected=expect(pending).rejects.toBe(reason);
 await entered;abort.abort(reason);await rejected;
 expect(service.terminate).toHaveBeenCalledWith({wait:true});expect(service.detach).toHaveBeenCalledOnce();expect(service.poll).not.toHaveBeenCalled();
});
it('cleans up creation that completes after cancellation without publishing a binding',async()=>{
 const sdk=client();const abort=new AbortController();const reason=new Error('operator cancelled');
 const service={sandboxId:'sb-existing',detach:vi.fn(),waitUntilReady:vi.fn(async()=>{}),terminate:vi.fn(async()=>{})};
 sdk.sandboxes.create.mockImplementationOnce(async()=>{abort.abort(reason);return service;});
 await expect(deployModalService({client:sdk,authorization:{allowSandboxCreation:true},appName:'existing',imageId:'im-pinned',config,lifetimeMs:5000,idleTimeoutMs:1000,readinessProbe:{},signal:abort.signal})).rejects.toBe(reason);
 expect(service.terminate).toHaveBeenCalledWith({wait:true});expect(service.detach).toHaveBeenCalledOnce();expect(service.waitUntilReady).not.toHaveBeenCalled();
});
it('does not create resources when cancellation arrives during app lookup',async()=>{
 const sdk=client();const abort=new AbortController();const reason=new Error('operator cancelled');
 sdk.apps.fromName.mockImplementationOnce(async()=>{abort.abort(reason);return {};});
 await expect(deployModalService({client:sdk,authorization:{allowSandboxCreation:true},appName:'existing',imageId:'im-pinned',config,lifetimeMs:5000,idleTimeoutMs:1000,readinessProbe:{},signal:abort.signal})).rejects.toBe(reason);
 expect(sdk.images.fromId).not.toHaveBeenCalled();expect(sdk.sandboxes.create).not.toHaveBeenCalled();
});
it.each(['readiness','poll'])('bounds stalled deployment %s by the readiness deadline and terminates it',async stage=>{
 vi.useFakeTimers();
 try {
  const sdk=client();
  const service={sandboxId:'sb-existing',detach:vi.fn(),waitUntilReady:vi.fn(async()=>{}),poll:vi.fn(async()=>null),terminate:vi.fn(async()=>{})};
  if(stage==='readiness')service.waitUntilReady.mockImplementation(()=>new Promise(()=>{}));
  else service.poll.mockImplementation(()=>new Promise(()=>{}));
  sdk.sandboxes.create.mockResolvedValueOnce(service);
  const pending=deployModalService({client:sdk,authorization:{allowSandboxCreation:true},appName:'existing',imageId:'im-pinned',config:{...config,readinessTimeoutMs:100},lifetimeMs:5000,idleTimeoutMs:1000,readinessProbe:{}});
  let failure:unknown;
  const settled=pending.catch((error:unknown)=>{failure=error;});
  await vi.advanceTimersByTimeAsync(100);
  expect(service.terminate).toHaveBeenCalledWith({wait:true});
  await settled;
  expect(failure).toBeInstanceOf(Error);
  expect((failure as Error).message).toContain('readiness deadline');
  expect(service.detach).toHaveBeenCalledOnce();
 } finally {vi.useRealTimers();}
});
it('allows explicit termination of an expired durable binding without allowing requests',async()=>{
 const sdk=client();const terminate=vi.fn(async()=>{});const detach=vi.fn();
 sdk.sandboxes.fromId.mockResolvedValue({terminate,detach});
 const resolve=createModalServiceResolver({client:sdk,lookup:async()=>({sandboxId:'sb-expired',executionClass:'standard-sandbox',expiresAt:100}),now:()=>100});
 const fetch=vi.fn(async()=>new Response(null));
 const driver=createModalExecutionDriver(config,resolve,fetch,()=>100);
 await expect((await driver.acquire('tenant')).fetch(new Request('https://public/v1/jobs'))).rejects.toThrow('expired');
 expect(sdk.sandboxes.fromId).not.toHaveBeenCalled();
 await driver.destroy('tenant');
 expect(terminate).toHaveBeenCalledWith({wait:true});expect(detach).toHaveBeenCalledOnce();
 expect(fetch).not.toHaveBeenCalled();
});
it('does not publish a deployment binding before the service is ready',async()=>{
 const clock=vi.spyOn(Date,'now').mockReturnValue(1000);
 try {
 const sdk=client();let ready!:()=>void;
 const waitUntilReady=vi.fn(()=>new Promise<void>(resolve=>{ready=resolve;}));
 const detach=vi.fn();const poll=vi.fn(async()=>null);
 sdk.sandboxes.create.mockResolvedValueOnce({sandboxId:'sb-existing',detach,waitUntilReady,poll});
 let published=false;
 const pending=deployModalService({client:sdk,authorization:{allowSandboxCreation:true},appName:'existing',imageId:'im-pinned',config,lifetimeMs:300000,idleTimeoutMs:60000,readinessProbe:{}}).then(value=>{published=true;return value;});
 for(let turn=0;turn<10;turn++)await Promise.resolve();
 const premature=published;
 ready?.();await pending;
 expect(premature).toBe(false);
 expect(waitUntilReady).toHaveBeenCalledWith(config.readinessTimeoutMs);
 expect(poll).toHaveBeenCalledOnce();expect(detach).toHaveBeenCalledOnce();
 } finally {clock.mockRestore();}
});
it('terminates a newly created service when readiness fails and retains cleanup failures',async()=>{
 const sdk=client();const detach=vi.fn();const failure=new Error('readiness failed');const cleanup=new Error('termination failed');
 const terminate=vi.fn().mockRejectedValue(cleanup);
 sdk.sandboxes.create.mockResolvedValueOnce({sandboxId:'sb-existing',detach,waitUntilReady:vi.fn().mockRejectedValue(failure),terminate});
 await expect(deployModalService({client:sdk,authorization:{allowSandboxCreation:true},appName:'existing',imageId:'im-pinned',config,lifetimeMs:300000,idleTimeoutMs:60000,readinessProbe:{}})).rejects.toMatchObject({errors:[failure,cleanup]});
 expect(terminate).toHaveBeenCalledWith({wait:true});expect(detach).toHaveBeenCalledOnce();
});
it('preserves readiness failure after successful termination',async()=>{
 const sdk=client();const failure=new Error('readiness failed');
 const service={sandboxId:'sb-existing',detach:vi.fn(),waitUntilReady:vi.fn().mockRejectedValue(failure),terminate:vi.fn(async()=>{})};
 sdk.sandboxes.create.mockResolvedValueOnce(service);
 await expect(deployModalService({client:sdk,authorization:{allowSandboxCreation:true},appName:'existing',imageId:'im-pinned',config,lifetimeMs:300000,idleTimeoutMs:60000,readinessProbe:{}})).rejects.toBe(failure);
 expect(service.terminate).toHaveBeenCalledWith({wait:true});expect(service.detach).toHaveBeenCalledOnce();
});
it('refuses a service that exits after its readiness probe succeeds',async()=>{
 const sdk=client();const service={sandboxId:'sb-existing',detach:vi.fn(),waitUntilReady:vi.fn(async()=>{}),poll:vi.fn(async()=>137),terminate:vi.fn(async()=>{})};
 sdk.sandboxes.create.mockResolvedValueOnce(service);
 await expect(deployModalService({client:sdk,authorization:{allowSandboxCreation:true},appName:'existing',imageId:'im-pinned',config,lifetimeMs:300000,idleTimeoutMs:60000,readinessProbe:{}})).rejects.toThrow('finished');
 expect(service.terminate).toHaveBeenCalledWith({wait:true});expect(service.detach).toHaveBeenCalledOnce();
});
it('deducts cold creation time from the remaining readiness lease',async()=>{
 const clock=vi.spyOn(Date,'now').mockReturnValue(1000);
 try {
  const sdk=client();const service={sandboxId:'sb-existing',detach:vi.fn(),waitUntilReady:vi.fn(async()=>{clock.mockReturnValue(6000);}),poll:vi.fn(async()=>null),terminate:vi.fn(async()=>{})};
  sdk.sandboxes.create.mockImplementationOnce(async()=>{clock.mockReturnValue(4000);return service;});
  await expect(deployModalService({client:sdk,authorization:{allowSandboxCreation:true},appName:'existing',imageId:'im-pinned',config,lifetimeMs:5000,idleTimeoutMs:1000,readinessProbe:{}})).rejects.toThrow('lease expired');
  expect(service.waitUntilReady).toHaveBeenCalledWith(2000);expect(service.poll).not.toHaveBeenCalled();
  expect(service.terminate).toHaveBeenCalledWith({wait:true});expect(service.detach).toHaveBeenCalledOnce();
 } finally {clock.mockRestore();}
});
function client(){return {apps:{fromName:vi.fn(async()=>({}))},images:{fromId:vi.fn(async()=>({}))},sandboxes:{create:vi.fn(async()=>({sandboxId:'sb-existing',detach:vi.fn(),waitUntilReady:vi.fn(async()=>{}),poll:vi.fn(async()=>null),terminate:vi.fn(async()=>{})})),fromId:vi.fn(async()=>({poll:async()=>null,waitUntilReady:async()=>{},tunnels:async()=>({}),terminate:async()=>{}}))}};}
it('does not publish a binding that expires during the final running-state check',async()=>{
 const clock=vi.spyOn(Date,'now').mockReturnValue(1000);
 try {
  const sdk=client();
  const service={sandboxId:'sb-existing',detach:vi.fn(),waitUntilReady:vi.fn(async()=>{}),poll:vi.fn(async()=>{clock.mockReturnValue(6000);return null;}),terminate:vi.fn(async()=>{})};
  sdk.sandboxes.create.mockResolvedValueOnce(service);
  await expect(deployModalService({client:sdk,authorization:{allowSandboxCreation:true},appName:'existing',imageId:'im-pinned',config,lifetimeMs:5000,idleTimeoutMs:1000,readinessProbe:{}})).rejects.toThrow('lease expired');
  expect(service.terminate).toHaveBeenCalledWith({wait:true});
  expect(service.detach).toHaveBeenCalledOnce();
 } finally {clock.mockRestore();}
});
it('derives the default readiness probe from the declarative service port',async()=>{
 const sdk=client();
 await deployModalService({client:sdk,authorization:{allowSandboxCreation:true},appName:'existing',imageId:'im-pinned',config:{...config,port:9090},lifetimeMs:300000,idleTimeoutMs:60000});
 expect(sdk.sandboxes.create.mock.calls[0]?.[2].readinessProbe.toProto()).toMatchObject({tcpPort:9090});
});
it('rejects expired durable bindings before SDK attachment',async()=>{
 const sdk=client();
 const resolve=createModalServiceResolver({client:sdk,lookup:async()=>({sandboxId:'sb-expired',executionClass:'standard-sandbox',expiresAt:Date.now()-1})});
 await expect(resolve('tenant')).rejects.toThrow('expired');
 expect(sdk.sandboxes.fromId).not.toHaveBeenCalled();
});
it.each([24*60*60*1000+1,Number.MAX_SAFE_INTEGER])('rejects undocumented Sandbox lifetime %s before cloud lookup',async lifetimeMs=>{
 const sdk=client();
 await expect(deployModalService({client:sdk,authorization:{allowSandboxCreation:true},appName:'existing',imageId:'im-pinned',config,lifetimeMs,idleTimeoutMs:60000,readinessProbe:{}})).rejects.toThrow('24 hours');
 expect(sdk.apps.fromName).not.toHaveBeenCalled();
 expect(sdk.sandboxes.create).not.toHaveBeenCalled();
});
it('deploys the declared service port and execution class from the driver config',async()=>{
 const sdk=client();
 await deployModalService({client:sdk,authorization:{allowSandboxCreation:true},appName:'existing',imageId:'im-pinned',config:{transport:'https',executionClass:'vm-sandbox',port:9090,readinessTimeoutMs:1000},lifetimeMs:300000,idleTimeoutMs:60000,readinessProbe:{},env:{SERVICE_TOKEN:'secret'}});
 expect(sdk.sandboxes.create.mock.calls[0]?.[2]).toMatchObject({encryptedPorts:[9090],env:{SERVICE_TOKEN:'secret',POE_CODE_SERVER_PORT:'9090'},experimentalOptions:{vm_runtime:true}});
});
it.each([0,65536,1.5])('rejects invalid service port %s before accessing cloud resources',async port=>{
 const sdk=client();
 await expect(deployModalService({client:sdk,authorization:{allowSandboxCreation:true},appName:'existing',imageId:'im-pinned',config:{...config,port},lifetimeMs:300000,idleTimeoutMs:60000,readinessProbe:{}})).rejects.toThrow('port');
 expect(sdk.apps.fromName).not.toHaveBeenCalled();expect(sdk.sandboxes.create).not.toHaveBeenCalled();
});
it('rejects an environment port conflicting with the declared tunnel before cloud lookup',async()=>{
 const sdk=client();
 await expect(deployModalService({client:sdk,authorization:{allowSandboxCreation:true},appName:'existing',imageId:'im-pinned',config,lifetimeMs:300000,idleTimeoutMs:60000,readinessProbe:{},env:{POE_CODE_SERVER_PORT:'9090'}})).rejects.toThrow('match');
 expect(sdk.apps.fromName).not.toHaveBeenCalled();expect(sdk.sandboxes.create).not.toHaveBeenCalled();
});
it('requires provisioning authorization before any SDK calls',async()=>{
 const sdk=client();await expect(deployModalService({client:sdk})).rejects.toThrow('authorization');expect(sdk.apps.fromName).not.toHaveBeenCalled();expect(sdk.sandboxes.create).not.toHaveBeenCalled();
});
it('pins an existing image and app and preserves common service argv',async()=>{
 const sdk=client();const options={client:sdk,authorization:{allowSandboxCreation:true},appName:'existing',imageId:'im-pinned',config,lifetimeMs:300000,idleTimeoutMs:60000,readinessProbe:{},env:{SERVICE_TOKEN:'secret'}};
 const binding=await deployModalService(options);
 expect(sdk.apps.fromName).toHaveBeenCalledWith('existing',{createIfMissing:false});expect(sdk.images.fromId).toHaveBeenCalledWith('im-pinned');
 expect(sdk.sandboxes.create.mock.calls[0]?.[2]).toMatchObject({command:['node','/app/bootstrap.mjs'],env:options.env,encryptedPorts:[8080],timeoutMs:300000});expect(binding.imageId).toBe('im-pinned');
});
it('attaches tenant bindings without creating any resources',async()=>{
 const sdk=client();const lookup=vi.fn(async(namespaceId:string)=>({sandboxId:`sb-${namespaceId}`,executionClass:'standard-sandbox',expiresAt:200}));
 const resolve=createModalServiceResolver({client:sdk,lookup,now:()=>100});await resolve('a');await resolve('b');
 expect(sdk.sandboxes.fromId.mock.calls).toEqual([['sb-a'],['sb-b']]);expect(sdk.sandboxes.create).not.toHaveBeenCalled();expect(sdk.apps.fromName).not.toHaveBeenCalled();
});
it('selects a VM only when its execution class is explicitly declared',async()=>{
 const sdk=client();
 await deployModalService({client:sdk,authorization:{allowSandboxCreation:true},appName:'existing',imageId:'im-pinned',config:{...config,executionClass:'vm-sandbox'},lifetimeMs:300000,idleTimeoutMs:60000,readinessProbe:{}});
 expect(sdk.sandboxes.create.mock.calls[0]?.[2]).toMatchObject({experimentalOptions:{vm_runtime:true}});
});
it('detaches the provisioned handle while retaining the running service binding',async()=>{
 const sdk=client();const detach=vi.fn();
 sdk.sandboxes.create.mockResolvedValueOnce({sandboxId:'sb-existing',detach,waitUntilReady:vi.fn(async()=>{}),poll:vi.fn(async()=>null)});
 const binding=await deployModalService({client:sdk,authorization:{allowSandboxCreation:true},appName:'existing',imageId:'im-pinned',config,lifetimeMs:300000,idleTimeoutMs:60000,readinessProbe:{}});
 expect(binding.sandboxId).toBe('sb-existing');expect(detach).toHaveBeenCalledOnce();
});
