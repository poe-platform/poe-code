import {createRequire} from 'node:module';
import {createComponentPolicy} from './component-host.js';
import {stripAnsi} from './ansi.js';
import {getExplorerStyles} from './explorer-theme.js';
import {fitToWidth,padEndCells} from './explorer-text.js';
const native=createRequire(import.meta.url)('./toolcraft-design-rust.node');
const policy=createComponentPolicy(native.designExplorerModalPolicy,{
  undefined:()=>undefined,null:()=>null,true:()=>true,object:()=>({}),array:(...values)=>values,
  assign:(value,key,item)=>{Object.defineProperty(value,key,{value:item,writable:true,enumerable:true,configurable:true});},
  at:(value,key)=>value[key],add:(a,b)=>a+b,subtract:(a,b)=>a-b,multiply:(a,b)=>a*b,divide:(a,b)=>a/b,
  min:Math.min,max:Math.max,floor:Math.floor,same:(a,b)=>a===b,le:(a,b)=>a<=b,lt:(a,b)=>a<b,gt:(a,b)=>a>b,
  truthy:value=>!!value,nullish:value=>value===null||value===undefined,
  template:(left,middle,right)=>`${left}${middle}${right}`,
  styles:getExplorerStyles,fit:fitToWidth,pad:padEndCells,strip:stripAnsi,
  invoke(method,receiver,message,...args){if(typeof method!=='function')throw new TypeError(message);return Reflect.apply(method,receiver,args);},
  spread:(first,lines)=>[first,...lines],
  walkEntries(entries,state,query,lines){for(const entry of entries)policy('entry',[entry,state,query,lines]);},
  invalidOperation(){throw new TypeError('Invalid explorer modal operation');}
});
export function renderModal(state,screen){policy('render',[state,screen]);}
