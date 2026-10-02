import assert from 'node:assert/strict';
import {test} from 'node:test';
import * as reference from '../../toolcraft-design/dist/explorer/jobs.js';

async function capture(api,scenario){
  const saved={setTimeout,clearTimeout,now:Date.now};
  const trace=[],timers=new Map();let now=1000,id=0;
  globalThis.setTimeout=(fn,delay)=>{trace.push(['timer',delay]);const timer=++id;timers.set(timer,{fn,at:now+delay});return timer;};
  globalThis.clearTimeout=timer=>{trace.push(['clear',timer]);timers.delete(timer);};
  Date.now=()=>now;
  const tick=async ms=>{
    now+=ms;
    for(const [timer,{fn,at}]of timers)if(at<=now){timers.delete(timer);fn();}
    for(let i=0;i<6;i++)await Promise.resolve();
  };
  const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
  try{await scenario({trace,timers,tick,deferred,setNow:value=>{now=value;}});}
  catch(error){trace.push(['rejected',error?.name,error?.message]);}
  finally{trace.push(['remaining',timers.size]);globalThis.setTimeout=saved.setTimeout;globalThis.clearTimeout=saved.clearTimeout;Date.now=saved.now;}
  return trace;
}
const summarize=event=>({...event,items:event.items?.map(item=>item.id),error:event.error&&[event.error.name,event.error.message]});

test('detail jobs preserve replacement, debounce, loading and stale-result sequencing',async()=>{
  const native=await import('toolcraft-design-rust/explorer/jobs');
  assert.deepEqual(Object.keys(native),Object.keys(reference));
  assert.equal(native.LOADING_INDICATOR_MS,reference.LOADING_INDICATOR_MS);
  assert.equal(native.DETAIL_DEBOUNCE_MS,reference.DETAIL_DEBOUNCE_MS);
  for(const gap of [0,29,30,149,150]){
    const run=api=>capture(api,async({trace,tick,deferred})=>{
      const jobs=api.createDetailJobs(function(event){trace.push(['emit',this===undefined,summarize(event)]);});
      const requests=[deferred(),deferred(),deferred()];
      const ctx={get width(){trace.push(['width']);return 40;},row:{id:'row'},signal:{ignored:true}};
      const schedule=index=>jobs.schedule(String(index),index,function(value){trace.push(['items',index,this===undefined,value.row===ctx.row,value.signal.aborted]);value.signal.addEventListener('abort',()=>trace.push(['abort',index]));return requests[index].promise;},ctx);
      const first=schedule(0);await tick(gap);const second=schedule(1);const third=schedule(2);
      trace.push(['scheduled']);requests[0].resolve([{id:'stale'}]);await tick(30);await tick(150);
      requests[1].resolve([{id:'second'}]);requests[2].resolve([{id:'third'}]);
      await Promise.all([first,second,third]);jobs.abort();
    });
    assert.deepEqual(await run(native),await run(reference),String(gap));
  }
});

test('detail jobs preserve explicit abort suppression and clock boundaries',async()=>{
  const native=await import('toolcraft-design-rust/explorer/jobs');
  for(const time of [0,29,30,1000,NaN,Infinity,-1])for(const abortAt of [0,30,150]){
    const run=api=>capture(api,async({trace,tick,deferred,setNow})=>{
      setNow(time);const jobs=api.createDetailJobs(event=>trace.push(summarize(event)));
      const pending=deferred();const job=jobs.schedule('row',7,ctx=>{trace.push(['called',ctx.signal.aborted]);return pending.promise;},{});
      await tick(abortAt);jobs.abort();jobs.abort();pending.resolve([]);await job;await tick(200);
    });
    assert.deepEqual(await run(native),await run(reference),JSON.stringify({time,abortAt}));
  }
});

test('detail jobs retain error identity, callback receivers and cleanup on emit errors',async()=>{
  const native=await import('toolcraft-design-rust/explorer/jobs');
  for(const failure of [new Error('failed'),undefined,null,7,Symbol('failure'),{toString(){return 'object failure';}}])for(const emitThrows of [false,true]){
    const run=api=>capture(api,async({trace})=>{
      let count=0;
      const jobs=api.createDetailJobs(event=>{trace.push([summarize(event),event.error===failure]);if(emitThrows&&++count===1)throw failure;});
      await jobs.schedule('row',4,()=>emitThrows?[]:Promise.reject(failure),{});
    });
    assert.deepEqual(await run(native),await run(reference));
  }
  for(const api of [native,reference]){
    const trace=await capture(api,async({trace})=>{
    const failure={identity:'coercion'};
    const jobs=api.createDetailJobs(()=>{});
    await assert.rejects(jobs.schedule('row',1,()=>{throw {toString(){throw failure;}};},{}),error=>error===failure);
    trace.push(['identity verified']);
    jobs.abort();
    });
    assert.deepEqual(trace.at(-2),['identity verified']);
  }
});

test('detail jobs retain reentrant abort and scheduling cleanup order',async()=>{
  const native=await import('toolcraft-design-rust/explorer/jobs');
  const run=api=>capture(api,async({trace,deferred,tick})=>{
    const jobs=api.createDetailJobs(event=>trace.push(summarize(event)));
    const pending=deferred();
    const first=jobs.schedule('first',1,ctx=>{ctx.signal.addEventListener('abort',()=>jobs.abort(),{once:true});return pending.promise;},{});
    try{await jobs.schedule('second',2,()=>[],{});}catch(error){trace.push(['schedule error',error.name,error.message]);}
    pending.resolve([]);await first;await tick(200);jobs.abort();
  });
  assert.deepEqual(await run(native),await run(reference));
});
