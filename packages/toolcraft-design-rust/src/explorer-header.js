import {createRequire} from 'node:module';
import {createComponentPolicy} from './component-host.js';
import {getExplorerStyles} from './explorer-theme.js';
import {cellWidth,fitToWidth,padEndCells} from './explorer-text.js';
const native=createRequire(import.meta.url)('./toolcraft-design-rust.node');
const policy=createComponentPolicy(native.designExplorerHeaderPolicy,{
  undefined:()=>undefined,styles:getExplorerStyles,
  subtract:(a,b)=>a-b,max:Math.max,same:(a,b)=>a===b,le:(a,b)=>a<=b,gt:(a,b)=>a>b,
  truthy:value=>!!value,nullish:value=>value===null||value===undefined,
  template:(left,middle,right)=>`${left}${middle}${right}`,string:value=>`${value}`,
  lower:state=>state.title.toLocaleLowerCase(),width:cellWidth,fit:fitToWidth,pad:padEndCells,
  put(method,receiver,...args){if(typeof method!=='function')throw new TypeError('screen.put is not a function');return Reflect.apply(method,receiver,args);},
  clear(method,receiver,rect){if(typeof method!=='function')throw new TypeError('screen.clearRect is not a function');return Reflect.apply(method,receiver,[rect]);},
  repeat(method,receiver,count){if(typeof method!=='function')throw new TypeError('"─".repeat is not a function');return Reflect.apply(method,receiver,[count]);},
  invalidOperation(){throw new TypeError('Invalid explorer header operation');}
});
export function renderHeader(state,screen,layout){policy('render',[state,screen,layout]);}
