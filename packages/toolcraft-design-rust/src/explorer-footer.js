import {createRequire} from 'node:module';
import {createComponentPolicy} from './component-host.js';
import {getExplorerStyles} from './explorer-theme.js';
import {cellWidth,fitToWidth} from './explorer-text.js';
const native=createRequire(import.meta.url)('./toolcraft-design-rust.node');
const policy=createComponentPolicy(native.designExplorerFooterPolicy,{
  undefined:()=>undefined,true:()=>true,false:()=>false,styles:getExplorerStyles,
  object:()=>({}),array:()=>[],pair:(a,b)=>[a,b],isArray:Array.isArray,
  assign:(value,key,item)=>{Object.defineProperty(value,key,{value:item,writable:true,enumerable:true,configurable:true});},
  add:(a,b)=>a+b,subtract:(a,b)=>a-b,max:Math.max,same:(a,b)=>a===b,
  le:(a,b)=>a<=b,lt:(a,b)=>a<b,ge:(a,b)=>a>=b,gt:(a,b)=>a>b,
  truthy:value=>!!value,nullish:value=>value===null||value===undefined,
  template:(left,middle,right)=>`${left}${middle}${right}`,string:value=>`${value}`,
  binding:(state,key)=>state.bindings.keysByTarget.get(key),accelerator:entry=>`Ctrl+${entry.action.accelerator.toUpperCase()}`,
  width:cellWidth,fit:fitToWidth,invoke:(method,receiver,...args)=>Reflect.apply(method,receiver,args),
  includes(method,receiver,key,message){if(typeof method!=='function')throw new TypeError(message);return !!Reflect.apply(method,receiver,[key]);},
  put(method,receiver,...args){if(typeof method!=='function')throw new TypeError('screen.put is not a function');return Reflect.apply(method,receiver,args);},
  clear(method,receiver,rect){if(typeof method!=='function')throw new TypeError('screen.clearRect is not a function');return Reflect.apply(method,receiver,[rect]);},
  walkActions(state,hints){for(const [id,entry]of state.actionState)policy('action',[state,hints,id,entry]);},
  walkHints(hints,screen,cursor,styles){for(const hint of hints)if(policy('hint',[hint,screen,cursor,styles]))break;},
  invalidOperation(){throw new TypeError('Invalid explorer footer operation');}
});
export function renderFooter(state,screen,layout){policy('render',[state,screen,layout]);}
