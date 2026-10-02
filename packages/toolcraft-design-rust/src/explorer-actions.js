import {createRequire} from "node:module";
import {createComponentPolicy} from "./component-host.js";
const native=createRequire(import.meta.url)("./toolcraft-design-rust.node");
const policy=createComponentPolicy(native.designExplorerActionsPolicy,{
  undefined:()=>undefined,null:()=>null,true:()=>true,
  object:()=>({}),array:()=>[],pair:(a,b)=>[a,b],
  same:(a,b)=>a===b,nullish:value=>value==null,truthy:value=>!!value,
  optionalGet:(value,key)=>value?.[key],at:(value,key)=>value[key],
  assign:(value,key,item)=>{value[key]=item;},invoke:(fn,receiver,...args)=>Reflect.apply(fn,receiver,args),
  mapDetails:items=>items.map(item=>policy("itemRow",[item])),
  filterSelected:(rows,state)=>rows.filter(row=>policy("selected",[state,row])),
  invalidOperation(){throw new TypeError("Invalid explorer action operation");}
});
export function resolveAction(state,keyEvent){return policy("resolve",[state,keyEvent]);}
export function buildActionContext(state,_action,source,runtimeHandles,rowsOverride){return policy("context",[state,_action,source,runtimeHandles,rowsOverride]);}
