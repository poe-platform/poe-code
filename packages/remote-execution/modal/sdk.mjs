/** Operator-owned bindings must be durable across gateway restarts. Never
 * derive a sandbox ID, volume name or account from client request headers. */
export function createModalServiceResolver({client,lookup,now=Date.now}){
 return async (namespaceId,options)=>{
  const stored=await lookup(namespaceId);
  // Lookup may return a borrowed record that rotates while the SDK attaches.
  // Keep execution class and lease tied to the selected sandbox ID.
  const binding=stored&&{sandboxId:stored.sandboxId,executionClass:stored.executionClass,expiresAt:stored.expiresAt};
  if(!binding||!['standard-sandbox','vm-sandbox'].includes(binding.executionClass)||!binding.sandboxId||!Number.isFinite(binding.expiresAt))throw new Error('Explicit Sandbox binding required');
  if(binding.expiresAt<=now()&&options?.purpose!=='terminate')throw new Error('Sandbox binding expired');
  client??=new (await import('modal')).ModalClient();
  const sandbox=await client.sandboxes.fromId(binding.sandboxId);
  if(binding.expiresAt<=now()&&options?.purpose!=='terminate'){
   sandbox.detach();
   throw new Error('Sandbox binding expired during attachment');
  }
  return Object.assign(sandbox,{executionClass:binding.executionClass,expiresAt:binding.expiresAt});
 };
}

/** Only an explicitly authorized operator calls this provisioning helper.
 * imageId pins an existing immutable image containing the common bootstrap,
 * portable server and qualified native backend. No app/image/volume creation.
 * Provisioning output must be persisted as a trusted tenant binding. */
export async function deployModalService({client,authorization,appName,imageId,config,lifetimeMs,idleTimeoutMs,readinessProbe,env,signal,volumeMounts={}}){
 if(authorization?.allowSandboxCreation!==true)throw new Error('Explicit billable Sandbox creation authorization required');
 signal?.throwIfAborted();
 const {executionClass,port,readinessTimeoutMs}=config??{};
 if(!['standard-sandbox','vm-sandbox'].includes(executionClass))throw new Error('Explicit Sandbox execution class required');
 if(config.transport!=='https'||!Number.isSafeInteger(port)||port<1||port>65535||!Number.isSafeInteger(readinessTimeoutMs)||readinessTimeoutMs<=0)throw new Error('Explicit HTTPS service port and readiness deadline required');
 if(env?.POE_CODE_SERVER_PORT!==undefined&&env.POE_CODE_SERVER_PORT!==String(port))throw new Error('Service port must match provider config');
 // Pin the validated environment, including application credentials, before
 // asynchronous lookups can rotate a borrowed operator configuration.
 env={...env,POE_CODE_SERVER_PORT:String(port)};
 if(!appName||!imageId?.startsWith('im-')||!Number.isSafeInteger(lifetimeMs)||lifetimeMs<=0||!Number.isSafeInteger(idleTimeoutMs)||idleTimeoutMs<=0)throw new Error('Existing app, immutable image ID and lifetimes required');
 if(lifetimeMs>24*60*60*1000)throw new Error('Sandbox lifetime must not exceed 24 hours');
 // These operator-owned selections are independent of request headers. Require
 // a tenant subdirectory rather than exposing the entire shared volume.
 const mounts=Object.entries(volumeMounts).map(([path,selection])=>{
  const {name,subPath,readOnly}=selection??{};
  for(const value of [path,subPath]){
   if(typeof value!=='string'||!value.startsWith('/')||value.includes('\0')||value.slice(1).split('/').some(part=>!part||part==='.'||part==='..'))throw new Error('Explicit canonical volume mount and tenant subpath required');
  }
  if(typeof name!=='string'||!name||typeof readOnly!=='boolean')throw new Error('Existing volume name and explicit readOnly selection required');
  return {path,name,subPath,readOnly};
 });
 // The listener and TCP readiness probe share the declarative port. Operators
 // can supply an exec probe for additional bootstrap checks; session/build
 // admission still belongs to the portable API rather than this TCP check.
 readinessProbe??=(await import('modal')).Probe.withTcp(port);
 client??=new (await import('modal')).ModalClient();
 signal?.throwIfAborted();
 // Read-only SDK lookups do not accept an AbortSignal. Stop waiting without
 // continuing provisioning when cancellation wins; observe late rejections.
 async function lookup(operation){
  if(!signal)return operation();
  signal.throwIfAborted();
  let abort;
  const cancelled=new Promise((_,reject)=>{
   abort=()=>reject(signal.reason);
   signal.addEventListener('abort',abort,{once:true});
  });
  try {
   const value=await Promise.race([Promise.resolve().then(operation),cancelled]);
   signal.throwIfAborted();
   return value;
  } finally {signal.removeEventListener('abort',abort);}
 }
 const app=await lookup(()=>client.apps.fromName(appName,{createIfMissing:false}));
 signal?.throwIfAborted();
 const image=await lookup(()=>client.images.fromId(imageId));
 signal?.throwIfAborted();
 const volumes={};
 for(const {path,name,subPath,readOnly} of mounts){
  const volume=await lookup(()=>client.volumes.fromName(name,{createIfMissing:false}));
  volumes[path]=volume.withMountOptions({subPath,readOnly});
 }
 signal?.throwIfAborted();
 const startedAt=Date.now();
 const sandbox=await client.sandboxes.create(app,image,{
  command:['node','/app/bootstrap.mjs'],encryptedPorts:[port],
  timeoutMs:lifetimeMs,idleTimeoutMs,readinessProbe,env,
  experimentalOptions:{vm_runtime:executionClass==='vm-sandbox'},
  ...(mounts.length?{volumes}:{}),
 });
 try {
  // Creation is not interruptible in the pinned SDK. Once it returns, cleanup
  // still owns the sandbox even if cancellation arrived while it was pending.
  signal?.throwIfAborted();
  const leaseDeadline=startedAt+lifetimeMs;
  if(leaseDeadline<=Date.now())throw new Error('Sandbox lease expired during creation');
  const readinessDeadline=Math.min(Date.now()+readinessTimeoutMs,leaseDeadline);
  // Bound the complete admission sequence, including SDK calls without their
  // own timeout. A late completion must never publish a trusted binding.
  let timer;let abort;
  const expired=new Promise((_,reject)=>{
   abort=()=>reject(signal.reason);
   signal?.addEventListener('abort',abort,{once:true});
   timer=setTimeout(()=>reject(new Error('Sandbox readiness deadline or lease expired')),readinessDeadline-Date.now());
  });
  try {
  await Promise.race([sandbox.waitUntilReady(readinessDeadline-Date.now()),expired]);
  signal?.throwIfAborted();
  if(startedAt+lifetimeMs<=Date.now())throw new Error('Sandbox lease expired during readiness');
  if(readinessDeadline<=Date.now())throw new Error('Sandbox readiness deadline exceeded');
  if(await Promise.race([sandbox.poll(),expired])!==null)throw new Error('Sandbox finished during readiness');
  signal?.throwIfAborted();
  if(startedAt+lifetimeMs<=Date.now())throw new Error('Sandbox lease expired during running-state check');
  if(readinessDeadline<=Date.now())throw new Error('Sandbox readiness deadline exceeded');
  return {sandboxId:sandbox.sandboxId,executionClass,expiresAt:startedAt+lifetimeMs,imageId};
  } finally {clearTimeout(timer);signal?.removeEventListener('abort',abort);}
 } catch(error) {
  try {await sandbox.terminate({wait:true});}
  catch(cleanup) {throw new AggregateError([error,cleanup],'Sandbox readiness and termination failed');}
  throw error;
 } finally {sandbox.detach();}
}
