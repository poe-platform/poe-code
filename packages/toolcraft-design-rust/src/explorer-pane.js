import {createRequire} from 'node:module';
import {createComponentPolicy} from './component-host.js';
import {fitToWidth,padEndCells} from './explorer-text.js';
const native=createRequire(import.meta.url)('./toolcraft-design-rust.node');
const policy=createComponentPolicy(native.designExplorerPanePolicy,{
  undefined:()=>undefined,add:(a,b)=>a+b,subtract:(a,b)=>a-b,max:Math.max,
  same:(a,b)=>a===b,le:(a,b)=>a<=b,lt:(a,b)=>a<b,gt:(a,b)=>a>b,truthy:value=>!!value,
  title:(horizontal,title)=>`${horizontal} ${title} `,
  template:(left,middle,right)=>`${left}${middle}${right}`,
  fit:fitToWidth,pad:padEndCells,
  repeat(method,receiver,count){if(typeof method!=='function')throw new TypeError('horizontal.repeat is not a function');return Reflect.apply(method,receiver,[count]);},
  put(method,receiver,...args){if(typeof method!=='function')throw new TypeError('screen.put is not a function');return Reflect.apply(method,receiver,args);},
  invalidArguments(){throw new TypeError('Invalid explorer pane arguments');}
});
export function drawPaneFrame(screen,rect,title,style={},options={}){policy('render',[screen,rect,title,style,options]);}
export {paneBodyRect} from './explorer-layout.js';
