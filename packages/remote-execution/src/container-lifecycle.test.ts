import {expect,it,vi} from 'vitest';
import {createContainerShutdown,createContainerLeaseSweeper,createContainerMediaLifecycle} from './container-lifecycle.js';

it('retires the owned media service before operator storage and socket cleanup',async()=>{
 vi.useFakeTimers();
 try{
  const events:string[]=[];let finish!:()=>void;let closed!:(error?:Error)=>void;
  const server={close(callback:(error?:Error)=>void){events.push('listener');closed=callback;},closeAllConnections(){events.push('sockets');closed();}};
  const media={sweep:vi.fn(async()=>{}),close:vi.fn(async()=>{events.push('media');await new Promise<void>(resolve=>{finish=resolve;});})};
  const closeOperator=vi.fn(async()=>{events.push('storage');});
  const shutdown=createContainerMediaLifecycle({server,media,intervalMs:100,onError:vi.fn(),closeOperator});
  await vi.advanceTimersByTimeAsync(100);expect(media.sweep).toHaveBeenCalledOnce();
  const first=shutdown();expect(shutdown()).toBe(first);
  await vi.advanceTimersByTimeAsync(300);
  expect(events).toEqual(['listener','media']);expect(media.sweep).toHaveBeenCalledOnce();
  finish();await first;
  expect(events).toEqual(['listener','media','storage','sockets']);expect(media.close).toHaveBeenCalledOnce();
 }finally{vi.useRealTimers();}
});

it('preserves media retirement failure while still retiring operator resources',async()=>{
 const failure=new Error('Native retirement unknown');const operatorFailure=new Error('Storage retirement failed');
 const closeOperator=vi.fn(async()=>{throw operatorFailure;});
 const shutdown=createContainerMediaLifecycle({server:{close(callback){callback();},closeAllConnections:vi.fn()},
  media:{sweep:vi.fn(async()=>{}),close:vi.fn(async()=>{throw failure;})},intervalMs:100,onError:vi.fn(),closeOperator});
 const first=shutdown();
 await expect(first).rejects.toMatchObject({errors:[expect.objectContaining({errors:[failure,operatorFailure]})]});
 expect(shutdown()).toBe(first);expect(closeOperator).toHaveBeenCalledOnce();
});

it('sweeps idle leases without overlapping and awaits an active sweep on shutdown',async()=>{
 vi.useFakeTimers();
 try{
  let finish!:()=>void;
  const sweep=vi.fn(()=>new Promise<void>(resolve=>{finish=resolve;}));
  const stop=createContainerLeaseSweeper({intervalMs:100,sweep,onError:vi.fn()});
  await vi.advanceTimersByTimeAsync(300);
  expect(sweep).toHaveBeenCalledOnce();
  const settled=vi.fn();const closing=stop().then(settled);
  await vi.advanceTimersByTimeAsync(300);
  expect(settled).not.toHaveBeenCalled();
  finish();await closing;
  await vi.advanceTimersByTimeAsync(300);
  expect(sweep).toHaveBeenCalledOnce();
 }finally{vi.useRealTimers();}
});

it('reports sweep failure and allows a later cleanup attempt',async()=>{
 vi.useFakeTimers();
 try{
  const failure=new Error('Lease retirement failed');
  const sweep=vi.fn().mockRejectedValueOnce(failure).mockResolvedValue(undefined);
  const onError=vi.fn();
  const stop=createContainerLeaseSweeper({intervalMs:100,sweep,onError});
  await vi.advanceTimersByTimeAsync(100);
  expect(onError).toHaveBeenCalledWith(failure);
  await vi.advanceTimersByTimeAsync(100);
  expect(sweep).toHaveBeenCalledTimes(2);
  await stop();
 }finally{vi.useRealTimers();}
});

it.each([0,-1,1.5,NaN,Infinity,2147483648])('requires an explicit bounded lease sweep interval (%s)',intervalMs=>{
 expect(()=>createContainerLeaseSweeper({intervalMs,sweep:vi.fn(),onError:vi.fn()})).toThrow('Lease sweep interval');
});

it('shares signal-triggered shutdown and drains connections after delegate retirement',async()=>{
 let finish!:()=>void;
 let closed!: (error?:Error)=>void;
 const events:string[]=[];
 const server={
  close:vi.fn((callback:(error?:Error)=>void)=>{events.push('stop accepting');closed=callback;}),
  closeAllConnections:vi.fn(()=>{events.push('drain connections');closed();}),
 };
 const retire=vi.fn(()=>new Promise<void>(resolve=>{events.push('retire delegates');finish=resolve;}));
 const shutdown=createContainerShutdown(server,retire);
 const first=shutdown();const second=shutdown();
 expect(first).toBe(second);
 await Promise.resolve();
 expect(events).toEqual(['stop accepting','retire delegates']);
 expect(server.closeAllConnections).not.toHaveBeenCalled();
 finish();await Promise.all([first,second]);
 expect(events).toEqual(['stop accepting','retire delegates','drain connections']);
 expect(retire).toHaveBeenCalledOnce();expect(server.close).toHaveBeenCalledOnce();
});

it('awaits listener closure even after delegates have retired',async()=>{
 let closed!: (error?:Error)=>void;
 const server={close:vi.fn((callback:(error?:Error)=>void)=>{closed=callback;}),closeAllConnections:vi.fn()};
 const shutdown=createContainerShutdown(server,vi.fn(async()=>{}));
 const settled=vi.fn();const pending=shutdown().then(settled);
 await vi.waitFor(()=>expect(server.closeAllConnections).toHaveBeenCalledOnce());
 expect(settled).not.toHaveBeenCalled();
 closed();await pending;expect(settled).toHaveBeenCalledOnce();
});

it('drains connections on cleanup failure and retains all failures on repeated signals',async()=>{
 const delegateFailure=new Error('Delegate still alive');
 const listenerFailure=new Error('Listener close failed');
 let closed!: (error?:Error)=>void;
 const server={close:vi.fn((callback:(error?:Error)=>void)=>{closed=callback;}),closeAllConnections:vi.fn(()=>closed(listenerFailure))};
 const retire=vi.fn(async()=>{throw delegateFailure;});
 const shutdown=createContainerShutdown(server,retire);
 const pending=shutdown();
 await expect(pending).rejects.toMatchObject({errors:[listenerFailure,delegateFailure]});
 expect(shutdown()).toBe(pending);
 await expect(shutdown()).rejects.toThrow('Container shutdown failed');
 expect(retire).toHaveBeenCalledOnce();expect(server.closeAllConnections).toHaveBeenCalledOnce();
});

it('keeps delegate failures when socket draining also fails',async()=>{
 const delegateFailure=new Error('Delegate retirement failed');
 const socketFailure=new Error('Socket drain failed');
 const server={close:vi.fn((callback:(error?:Error)=>void)=>callback()),closeAllConnections:vi.fn(()=>{throw socketFailure;})};
 const shutdown=createContainerShutdown(server,vi.fn(async()=>{throw delegateFailure;}));
 await expect(shutdown()).rejects.toMatchObject({errors:[delegateFailure,socketFailure]});
});
