import {createRequire} from 'node:module';
import {createComponentPolicy} from './component-host.js';
import {graphemes} from './terminal-width.js';
import {buildActionContext,resolveAction} from './explorer-actions.js';
import {prepareDetailContent} from './explorer-detail-content.js';
import {filterRows} from './explorer-filter.js';
import {computeExplorerLayout,paneBodyRect} from './explorer-layout.js';
import {REGION_ALL,REGION_DETAIL,REGION_FOOTER,REGION_HEADER,REGION_LIST,REGION_MODAL,resolveExplorerLayoutMode} from './explorer-state.js';
const native=createRequire(import.meta.url)('./toolcraft-design-rust.node');
const noEffects=[];
const defaultHandles={refresh:async()=>undefined,reloadDetail:()=>undefined,suspendAnd:async fn=>fn(),openModal:()=>undefined,toast:()=>undefined,confirm:async()=>false,promptText:async()=>null,exit:()=>undefined};
const flags={all:REGION_ALL,detail:REGION_DETAIL,footer:REGION_FOOTER,header:REGION_HEADER,list:REGION_LIST,modal:REGION_MODAL};
const policy=createComponentPolicy(native.designExplorerReducerPolicy,{
  undefined:()=>undefined,null:()=>null,true:()=>true,false:()=>false,object:()=>({}),array:(...values)=>values,
  spread:value=>({...value}),spreadArray:value=>[...value],set:()=>new Set(),setFrom:value=>new Set(value),map:()=>new Map(),mapFrom:value=>new Map(value),
  assign:(value,key,item)=>{Object.defineProperty(value,key,{value:item,writable:true,enumerable:true,configurable:true});},
  at:(value,key)=>value[key],write:(value,key,item)=>{value[key]=item;},
  same:(a,b)=>a===b,truthy:value=>!!value,nullish:value=>value===null||value===undefined,
  callable:value=>typeof value==='function',isString:value=>typeof value==='string',finite:Number.isFinite,
  add:(a,b)=>a+b,subtract:(a,b)=>a-b,divide:(a,b)=>a/b,negate:value=>-value,or:(a,b)=>a|b,
  lt:(a,b)=>a<b,le:(a,b)=>a<=b,gt:(a,b)=>a>b,ge:(a,b)=>a>=b,min:Math.min,max:Math.max,floor:Math.floor,
  template:(left,middle,right)=>`${left}${middle}${right}`,string:value=>`${value}`,
  flag:name=>flags[name],noEffects:()=>noEffects,defaults:()=>defaultHandles,
  layoutMode:resolveExplorerLayoutMode,layout:computeExplorerLayout,body:paneBodyRect,prepare:prepareDetailContent,filter:filterRows,
  context:buildActionContext,resolveAction,graphemes,
  invoke:(method,receiver,...args)=>Reflect.apply(method,receiver,args),
  invokeChecked(method,receiver,message,...args){if(typeof method!=='function')throw new TypeError(message);return Reflect.apply(method,receiver,args);},
  map1:(values,operation,...args)=>values.map(value=>policy(operation,[value,...args])),
  map2:(values,operation,...args)=>values.map((value,index)=>policy(operation,[value,index,...args])),
  filter1:(values,operation,...args)=>values.filter(value=>policy(operation,[value,...args])),
  some1:(values,operation,...args)=>values.some(value=>policy(operation,[value,...args])),
  every1:(values,operation,...args)=>values.every(value=>policy(operation,[value,...args])),
  findIndex1:(values,operation,...args)=>values.findIndex(value=>policy(operation,[value,...args])),
  walk(values,operation,...args){for(const value of values)policy(operation,[value,...args]);},
  walkEntries(values,operation,...args){for(const [id,entry]of values)policy(operation,[id,entry,...args]);},
  allValues(values,operation,...args){for(const value of values)if(!policy(operation,[value,...args]))return false;return true;},
  primary(values,state,handles){for(const [id,entry]of values){const result=policy('primaryEntry',[id,entry,state,handles]);if(result!==undefined)return result;}return policy('mark',[state,0]);},
  noop:()=>()=>undefined,errorRender:error=>()=>error.message,
  effect:(next,action,current,handles,rows)=>({type:'suspend',fn:async()=>action.handler(policy('dispatchContext',[next,action,current,handles,rows])),resumeWith:()=>policy('resumeEvent',[action])}),
  error(message){throw new Error(message);},
  invalidOperation(){throw new TypeError('Invalid explorer reducer operation');}
});
export function step(state,event,runtimeHandles=defaultHandles){return policy('step',[state,event,runtimeHandles]);}
