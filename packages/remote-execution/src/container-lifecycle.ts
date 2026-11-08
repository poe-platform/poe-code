/** Expired leases must retire even when no HTTP requests arrive. The operator
 * owns the interval and failure reporting; shutdown stops ticks and drains work. */
export function createContainerLeaseSweeper(options:{intervalMs:number;sweep:()=>Promise<void>;onError:(error:unknown)=>void}):()=>Promise<void>{
 if(!Number.isSafeInteger(options.intervalMs)||options.intervalMs<1||options.intervalMs>2147483647)throw new RangeError('Lease sweep interval must be a positive bounded integer');
 let pending:Promise<void>|undefined;
 let stopped=false;
 const timer=setInterval(()=>{
  if(stopped||pending)return;
  pending=Promise.resolve().then(options.sweep).catch(options.onError).finally(()=>{pending=undefined;});
 },options.intervalMs);
 return async()=>{stopped=true;clearInterval(timer);await pending;};
}

/** The bootstrap owns the media server it constructs. Its native jobs and
 * transfers must retire before the operator disposes their backing storage. */
export function createContainerMediaLifecycle(options:{
 server:Parameters<typeof createContainerShutdown>[0];
 media:{sweep():Promise<void>;close():Promise<void>};
 intervalMs:number;onError:(error:unknown)=>void;closeOperator:()=>Promise<void>;
}):()=>Promise<void>{
 const {server,media,intervalMs,onError,closeOperator}=options;
 const sweep=media.sweep.bind(media);const closeMedia=media.close.bind(media);
 const stopSweeping=createContainerLeaseSweeper({intervalMs,sweep,onError});
 return createContainerShutdown(server,async()=>{
  const results=await Promise.allSettled([stopSweeping()]);
  results.push(...await Promise.allSettled([Promise.resolve().then(closeMedia)]));
  results.push(...await Promise.allSettled([Promise.resolve().then(closeOperator)]));
  const failures=results.filter((result):result is PromiseRejectedResult=>result.status==='rejected');
  if(failures.length)throw new AggregateError(failures.map(result=>result.reason),'Media deployment retirement failed');
 });
}

/** Stop admission first, retire native jobs/delegates, then drain HTTP sockets.
 * Multiple termination signals share one result, including cleanup failures. */
export function createContainerShutdown(
 server:{close(callback:(error?:Error)=>void):unknown;closeAllConnections():void},
 closeDeployment:()=>Promise<void>,
):()=>Promise<void>{
 let pending:Promise<void>|undefined;
 return ()=>{
  pending??=(async()=>{
   const listener=new Promise<void>((resolve,reject)=>{
    server.close(error=>error?reject(error):resolve());
   });
   const retirement=Promise.allSettled([Promise.resolve().then(closeDeployment)]).then(async results=>[
    ...results,...await Promise.allSettled([Promise.resolve().then(()=>server.closeAllConnections())]),
   ]);
   const results=(await Promise.all([Promise.allSettled([listener]),retirement])).flat();
   const failures=results.filter((result):result is PromiseRejectedResult=>result.status==='rejected');
   if(failures.length)throw new AggregateError(failures.map(result=>result.reason),'Container shutdown failed');
  })();
  return pending;
 };
}
