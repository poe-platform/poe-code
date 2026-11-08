import {createRequire} from 'node:module';
import {createComponentPolicy} from './component-host.js';
import {getExplorerStyles} from './explorer-theme.js';
import {drawPaneFrame,paneBodyRect} from './explorer-pane.js';
import {cellWidth,centerCells,fitToWidth,splitGraphemeCells,stripAnsi} from './explorer-text.js';
const native=createRequire(import.meta.url)('./toolcraft-design-rust.node');
const policy=createComponentPolicy(native.designExplorerListPolicy,{
  undefined:()=>undefined,true:()=>true,false:()=>false,styles:getExplorerStyles,
  object:()=>({}),array:()=>[],set:positions=>new Set(positions),at:(value,key)=>value[key],
  assign:(value,key,item)=>{Object.defineProperty(value,key,{value:item,writable:true,enumerable:true,configurable:true});},
  add:(a,b)=>a+b,subtract:(a,b)=>a-b,divide:(a,b)=>a/b,max:Math.max,floor:Math.floor,same:(a,b)=>a===b,
  le:(a,b)=>a<=b,lt:(a,b)=>a<b,ge:(a,b)=>a>=b,gt:(a,b)=>a>b,truthy:value=>!!value,nullish:value=>value===null||value===undefined,
  template:(left,middle,right)=>`${left}${middle}${right}`,string:value=>`${value}`,prefix:(marker,cursor)=>`${marker} ${cursor} `,
  selected:(state,row)=>state.selected.has(row.id),positions:(state,index)=>state.matchPositions.get(index),has:(positions,index)=>positions.has(index),
  width:cellWidth,center:centerCells,fit:fitToWidth,split:splitGraphemeCells,strip:stripAnsi,pane:drawPaneFrame,body:paneBodyRect,
  invoke:(method,receiver,...args)=>Reflect.apply(method,receiver,args),
  put(method,receiver,...args){if(typeof method!=='function')throw new TypeError('screen.put is not a function');return Reflect.apply(method,receiver,args);},
  clear(method,receiver,rect){if(typeof method!=='function')throw new TypeError('screen.clearRect is not a function');return Reflect.apply(method,receiver,[rect]);},
  repeat(method,receiver,count){if(typeof method!=='function')throw new TypeError('"─".repeat is not a function');return Reflect.apply(method,receiver,[count]);},
  walkRows(state,lines,context){for(const index of state.filtered)policy('line',[state,lines,context,index]);},
  findCursor:lines=>lines.findIndex(line=>policy('isCursor',[line])),
  walkSegments(segments,...args){for(const segment of segments)policy('segment',[segment,...args]);},
  invalidOperation(){throw new TypeError('Invalid explorer list operation');}
});
export function renderList(state,screen,layout){policy('render',[state,screen,layout]);}
export function visibleStart(lines,height,scrolloff=3){return policy('visible',[lines,height,scrolloff]);}
