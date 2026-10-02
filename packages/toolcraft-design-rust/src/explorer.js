import {createRequire} from 'node:module';
import {createComponentPolicy} from './component-host.js';
export {runExplorer} from './explorer-runtime.js';
export {createInitialState,normalizeExplorerConfig} from './explorer-state.js';
export {resolveBindings} from './explorer-keymap.js';

const native=createRequire(import.meta.url)('./toolcraft-design-rust.node');
const policy=createComponentPolicy(native.designExplorerPolicy,{
  object:()=>({}),array:(...items)=>items,
  assign:(object,key,value)=>{Object.defineProperty(object,key,{value,writable:true,enumerable:true,configurable:true});},
  items:fn=>({items:async row=>policy('items',[row,fn])}).items,
  render:(row,fn)=>({render:ctx=>fn(row,ctx)}).render,
  invalidOperation(){throw new TypeError('Invalid explorer detail operation');}
});
export function singleDetail(fn){return policy('single',[fn]);}
