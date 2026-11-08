import {createRequire} from "node:module";
import {createComponentPolicy} from "./component-host.js";
const native=createRequire(import.meta.url)("./toolcraft-design-rust.node");
const policy=createComponentPolicy(native.designExplorerKeymapPolicy,{
  undefined:()=>undefined,true:()=>true,false:()=>false,
  object:()=>({}),array:()=>[],map:pairs=>new Map(pairs),
  truthy:value=>!!value,nullish:value=>value==null,same:(a,b)=>a===b,
  gt:(a,b)=>a>b,lt:(a,b)=>a<b,arrayIsArray:Array.isArray,isString:value=>typeof value==="string",
  optionalGet:(value,key)=>value?.[key],set:(value,key,item)=>{value[key]=item;},
  invoke:(fn,receiver,...args)=>Reflect.apply(fn,receiver,args),
  concat:(a,b)=>[...a,...b],one:value=>[value],pair:(a,b)=>[a,b],
  actionPairs:actions=>actions.map(action=>policy("pair",[action])),
  values:map=>[...map.values()],keys:value=>Object.keys(value),
  walk(operation,values,...args){for(const value of values)policy(operation,[value,...args]);},
  ctrl:key=>`Ctrl+${key}`,targetKey:target=>`${target.type}:${target.id}`,
  lowerAccelerator:action=>action.accelerator.toLowerCase(),
  helpAccelerator:action=>`Ctrl+${action.accelerator.toUpperCase()}`,
  bareError:action=>`Explorer action ${action.id} uses a bare key; use accelerator instead`,
  letterError:action=>`Explorer action ${action.id} accelerator must be one letter`,
  coreError:(action,accelerator)=>`Explorer action ${action.id} accelerator Ctrl+${accelerator.toUpperCase()} collides with a core key`,
  sharedError:(owner,action,accelerator)=>`Explorer actions ${owner} and ${action.id} share Ctrl+${accelerator.toUpperCase()}`,
  error(message){throw new Error(message);},
  resolved:(bindings,keysByTarget)=>({bindings,keysByTarget,resolve:event=>policy("event",[bindings,event])}),
  helpActions:actions=>actions.filter(action=>policy("hasAccelerator",[action])).map(action=>policy("helpAction",[action])),
  invalidOperation(){throw new TypeError("Invalid explorer keymap operation");}
});
export function resolveBindings(config,defaults={}){return policy("resolve",[config,defaults]);}
export function assertNoBareLetterBindings(config){policy("bare",[config]);}
export function assertAcceleratorsFree(config){policy("accelerators",[config]);}
export function keymapToHelp(config){return policy("help",[config]);}
