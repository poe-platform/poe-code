import {createRequire} from "node:module";
import {createComponentPolicy} from "./component-host.js";
import {resolveBindings} from "./explorer-keymap.js";
const native=createRequire(import.meta.url)("./toolcraft-design-rust.node");
const policy=createComponentPolicy(native.designExplorerStatePolicy,{
  undefined:()=>undefined,null:()=>null,true:()=>true,false:()=>false,
  array:()=>[],object:()=>({}),map:()=>new Map(),set:()=>new Set(),
  same:(a,b)=>a===b,nullish:value=>value==null,truthy:value=>!!value,
  lt:(a,b)=>a<b,gt:(a,b)=>a>b,finite:Number.isFinite,max:(a,b)=>Math.max(a,b),floor:value=>Math.floor(value),
  callable:value=>typeof value==="function",has:(value,key)=>key in value,
  at:(value,index)=>value[index],optionalGet:(value,key)=>value?.[key],assign:(value,key,item)=>{value[key]=item;},
  invoke:(fn,receiver,...args)=>Reflect.apply(fn,receiver,args),spread:value=>({...value}),
  findList:panes=>panes.find(pane=>policy("isList",[pane])),
  findCompanion:(panes,list)=>panes.find(pane=>pane!==list),
  detail:companion=>({items:async(row,ctx)=>{
    const content=await companion.render(row,ctx);
    return policy("detailResult",[row,ctx,content]);
  }}),
  listDetail:companion=>({items:async()=>policy("listResult",[await companion.rows()])}),
  emptyDetail:()=>({items:async()=>[]}),
  content:content=>()=>content,emptyRender:()=>()=>"",
  mapRows:rows=>rows.map(row=>policy("listRow",[row])),
  indices:rows=>rows.map((_,index)=>index),
  walk(operation,values,...args){for(const value of values)policy(operation,[value,...args]);},
  sharedList:config=>config.panes?.some(pane=>policy("sharedPane",[pane,config])),
  definitions:panes=>panes?.map(({id,title,kind,...pane})=>policy("pane",[id,title,kind,pane])),
  duplicate:action=>`Duplicate explorer action id: ${action.id}`,
  error(message){throw new Error(message);},resolveBindings,
  invalidOperation(){throw new TypeError("Invalid explorer state operation");}
});
export const {REGION_HEADER,REGION_LIST,REGION_DETAIL,REGION_FOOTER,REGION_MODAL,REGION_TOAST,REGION_ALL}=policy("regions",[]);
export function normalizeExplorerConfig(config){return policy("normalize",[config]);}
export function createInitialState(config,size){return policy("create",[config,size]);}
export function resolveExplorerLayoutMode(cols,rows=24){return policy("layout",[cols,rows]);}
