import {createRequire} from 'node:module';
import {createComponentPolicy} from './component-host.js';
const native=createRequire(import.meta.url)('./toolcraft-design-rust.node');
export const [LOADING_INDICATOR_MS,DETAIL_DEBOUNCE_MS]=native.designExplorerJobsDelays();
const policy=createComponentPolicy(native.designExplorerJobsPolicy,{
  undefined:()=>undefined,null:()=>null,isNull:value=>value===null,true:()=>true,false:()=>false,
  object:()=>({}),set:()=>new Set(),spread:ctx=>({...ctx}),
  assign:(value,key,item)=>{value[key]=item;},
  same:(a,b)=>a===b,truthy:value=>!!value,
  optionalToken:current=>current?.token,optionalController:current=>current?.controller,
  has:(set,token)=>set.has(token),add:(set,token)=>set.add(token),delete:(set,token)=>set.delete(token),
  now:()=>Date.now(),debounce:(now,last,delay)=>now-last<delay,
  controller:()=>new AbortController(),abortController:controller=>controller.abort(),
  clear:timer=>clearTimeout(timer),
  loadingTimer:(state,job,delay)=>setTimeout(()=>{policy('loading',[state,job]);},delay),
  onAbort:wait=>()=>{policy('waitAbort',[wait]);},
  waitTimer:(wait,delay)=>setTimeout(()=>{policy('waitElapsed',[wait]);},delay),
  listen:(signal,onAbort)=>signal.addEventListener('abort',onAbort,{once:true}),
  unlisten:(signal,onAbort)=>signal.removeEventListener('abort',onAbort),
  resolve:resolve=>resolve(),emit:(emit,event)=>emit(event),
  toError:error=>error instanceof Error?error:new Error(String(error)),
  invalidOperation(){throw new TypeError('Invalid explorer jobs operation');}
});
export function createDetailJobs(emit){
  const state=policy('create',[emit]);
  return {
    async schedule(rowId,nextToken,items,ctx){
      const job=policy('start',[state,rowId,nextToken]);
      try{
        if(job.debounce){
          const signal=job.controller.signal;
          await new Promise(resolve=>{policy('waitStart',[signal,resolve]);});
          if(policy('skip',[state,job]))return;
        }
        const loadedItems=await items(policy('context',[ctx,job]));
        policy('loaded',[state,job,loadedItems]);
      }catch(error){policy('error',[state,job,error]);}
      finally{policy('finish',[state,job]);}
    },
    abort(){policy('abort',[state]);}
  };
}
