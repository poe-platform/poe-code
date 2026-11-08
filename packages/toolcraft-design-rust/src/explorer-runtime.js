import {createRequire} from 'node:module';
import {appendFileSync} from 'node:fs';
import {createComponentPolicy} from './component-host.js';
import {Screen} from './screen.js';
import {createTerminalDriver} from './terminal-driver.js';
import {createDetailJobs} from './explorer-jobs.js';
import {computeExplorerLayout} from './explorer-layout.js';
import {renderExplorer} from './explorer-render.js';
import {step} from './explorer-reducer.js';
import {createInitialState,normalizeExplorerConfig,REGION_ALL,REGION_MODAL,REGION_FOOTER,REGION_TOAST} from './explorer-state.js';

const native=createRequire(import.meta.url)('./toolcraft-design-rust.node');
const flags={all:REGION_ALL,modal:REGION_MODAL,footer:REGION_FOOTER,toast:REGION_TOAST};

export async function runExplorer(config){
  if(process.stdout.isTTY!==true)throw new Error('explorer requires a TTY');
  const driver=createTerminalDriver({mouse:config.mouse});
  const runtime={driver,pendingEffects:new Set(),unsubscribeKeypress:undefined,unsubscribeResize:undefined,toastTimer:undefined,rowsRequestToken:0,reorderToken:0,stopped:false,renderScheduled:false,tracePath:process.env.POE_CODE_TUI_TRACE,settle:undefined};
  const policy=createComponentPolicy(native.designExplorerRuntimePolicy,{
    undefined:()=>undefined,null:()=>null,true:()=>true,false:()=>false,
    object:()=>({}),spread:value=>({...value}),
    assign:(object,key,value)=>{Object.defineProperty(object,key,{value,writable:true,enumerable:true,configurable:true});},
    same:(a,b)=>a===b,truthy:value=>!!value,nullish:value=>value==null,isString:value=>typeof value==='string',
    add:(a,b)=>a+b,gt:(a,b)=>a>b,or:(a,b)=>a|b,
    invoke:(fn,receiver,...args)=>Reflect.apply(fn,receiver,args),
    normalize:normalizeExplorerConfig,initial:createInitialState,screen:size=>new Screen(size),
    layout:computeExplorerLayout,step,render:renderExplorer,flag:name=>flags[name],
    now:()=>Date.now(),signal:()=>new AbortController().signal,bytes:frame=>Buffer.byteLength(frame),
    clearTimeout:id=>clearTimeout(id),
    jobs:()=>createDetailJobs(event=>{policy('detailEvent',[runtime,event]);}),
    handles:()=>({
      refresh:async()=>{await refreshRowsFromSource();},
      reloadDetail:rowId=>{policy('reload',[runtime,rowId]);},
      suspendAnd:async fn=>suspendAnd(fn),
      openModal:content=>{policy('openModal',[runtime,content]);},
      toast:(message,tone)=>{policy('toast',[runtime,message,tone]);},
      confirm:async prompt=>new Promise(resolve=>{policy('confirm',[runtime,prompt,resolve]);}),
      promptText:async options=>new Promise(resolve=>{policy('promptText',[runtime,options,resolve]);}),
      exit:after=>{policy('exit',[runtime,null,after]);}
    }),
    subscribeKey:driver=>driver.onEvent(event=>{policy('input',[runtime,event]);}),
    subscribeResize:driver=>driver.onResize(size=>{policy('resize',[runtime,size]);}),
    paste(text){for(const ch of text.replaceAll('\n','').replaceAll('\r',''))policy('pasteChar',[runtime,ch]);},
    effects(effects,previous){for(const effect of effects)policy('effect',[runtime,effect,previous]);},
    findRow:(rows,rowId)=>rows.find(candidate=>candidate.id===rowId),
    detailCallback:rowId=>()=>{policy('reload',[runtime,rowId]);},
    // Keep the source expressions as well as receivers for native TypeError diagnostics.
    detailItems:function(row,reloadDetail){return ctx=>this.config.detail.items(row,{...ctx,reloadDetail});}.bind(runtime),
    prepareItems:(items,context,rowId,token)=>items.map((item,itemIndex)=>{
      try{return policy('prepareItem',[runtime,item,context,rowId,token,itemIndex]);}
      catch(error){return {...item,renderedContent:error instanceof Error?`Error: ${error.message}`:'Error: detail failed'};}
    }),
    renderItem:(item,context)=>item.render(context),
    awaitContent:(content,rowId,token,itemIndex)=>content.then(
      resolved=>{policy('itemRendered',[runtime,rowId,token,itemIndex,resolved]);},
      error=>{policy('itemRendered',[runtime,rowId,token,itemIndex,error instanceof Error?`Error: ${error.message}`:'Error: detail failed']);}
    ),
    persistOrder:async function(movedId,orderedIds,previousRows,token){
      try{await this.config.reorder?.onReorder(orderedIds,{movedId,refresh:runtime.runtimeHandles.refresh,toast:runtime.runtimeHandles.toast});}
      catch(error){policy('persistError',[runtime,previousRows,token,error instanceof Error?error.message:'Could not persist order']);}
    }.bind(runtime),
    action:async effect=>{
      try{const value=await effect.fn();policy('dispatch',[runtime,effect.resumeWith(value)]);}
      catch(error){policy('toast',[runtime,error instanceof Error?error.message:'Action failed','error']);policy('dispatch',[runtime,effect.resumeWith(error)]);}
    },
    initialLoad(){loadRows().catch(error=>{policy('fail',[runtime,error]);});},
    immediate:()=>setImmediate(()=>{policy('renderScheduled',[runtime]);}),
    toastTimer:delay=>setTimeout(()=>{policy('dispatch',[runtime,{type:'toastExpired'}]);},delay),
    track(promise){runtime.pendingEffects.add(promise);promise.finally(()=>{runtime.pendingEffects.delete(promise);});},
    settle(result,after){Promise.allSettled([...runtime.pendingEffects]).then(()=>after?.()).then(()=>{runtime.settle?.resolve(result);}).catch(error=>{runtime.settle?.reject(error);});},
    reject:error=>runtime.settle?.reject(error),
    trace(type,fields){if(runtime.tracePath===undefined||runtime.tracePath.length===0)return;appendFileSync(runtime.tracePath,`${JSON.stringify({type,timestamp:new Date().toISOString(),...fields})}\n`);},
    invalidOperation(){throw new TypeError('Invalid explorer runtime operation');}
  });
  const loadRows=async function(requestToken=++runtime.rowsRequestToken){
    const rows=await this.config.rows();
    policy('rowsLoaded',[runtime,requestToken,rows]);
  }.bind(runtime);
  const refreshRowsFromSource=async function(){
    const requestToken=++runtime.rowsRequestToken;
    await this.config.refresh?.();
    await loadRows(requestToken);
  }.bind(runtime);
  async function suspendAnd(fn){
    policy('suspend',[runtime]);
    try{return await fn();}finally{policy('resume',[runtime]);}
  }
  policy('create',[runtime,config]);
  return new Promise((resolve,reject)=>{
    runtime.settle={resolve,reject};
    try{policy('run',[runtime]);}catch(error){policy('fail',[runtime,error]);}
  });
}
