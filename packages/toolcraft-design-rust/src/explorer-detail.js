import {createRequire} from 'node:module';
import {createComponentPolicy} from './component-host.js';
import {prepareDetailContent} from './explorer-detail-content.js';
import {paneBodyRect} from './explorer-layout.js';
import {getExplorerStyles} from './explorer-theme.js';
import {drawPaneFrame} from './explorer-pane.js';
import {fitToWidth} from './explorer-text.js';
const native=createRequire(import.meta.url)('./toolcraft-design-rust.node');
const policy=createComponentPolicy(native.designExplorerDetailPolicy,{
  undefined:()=>undefined,null:()=>null,true:()=>true,false:()=>false,
  object:()=>({}),array:()=>[],styles:getExplorerStyles,body:paneBodyRect,frame:drawPaneFrame,
  assign:(value,key,item)=>{Object.defineProperty(value,key,{value:item,writable:true,enumerable:true,configurable:true});},
  at:(value,key)=>value[key],add:(a,b)=>a+b,subtract:(a,b)=>a-b,
  max:Math.max,min:Math.min,round:Math.round,divide:(a,b)=>a/b,multiply:(a,b)=>a*b,
  same:(a,b)=>a===b,le:(a,b)=>a<=b,lt:(a,b)=>a<b,ge:(a,b)=>a>=b,gt:(a,b)=>a>b,
  truthy:value=>!!value,nullish:value=>value===null||value===undefined,
  string:value=>`${value}`,template:(left,middle,right)=>`${left}${middle}${right}`,
  isString:value=>typeof value==='string',isError:value=>value instanceof Error,
  prepare:prepareDetailContent,fit:fitToWidth,
  find:(rows,state)=>rows.find(row=>policy('matches',[row,state])),
  title(method,receiver,row){if(typeof method!=='function')throw new TypeError('pane?.titleForRow is not a function');return Reflect.apply(method,receiver,[row]);},
  selected:(selected,id)=>selected.has(id),slice:(lines,start)=>lines.slice(start),
  render(item,rect,row){
    try{return {ok:true,value:item.render({width:rect.width,height:rect.height,row:row??{id:'',title:''},signal:new AbortController().signal})};}
    catch(error){return {ok:false,error};}
  },
  walkLines(content,screen,rect,cursor){for(const line of content.text.split('\n'))if(policy('content-line',[line,screen,rect,cursor]))break;},
  walkCells(cells,screen,rect,row,cursor){for(const cell of cells)if(policy('cell',[cell,screen,rect,row,cursor]))break;},
  clear(method,receiver,rect){if(typeof method!=='function')throw new TypeError('screen.clearRect is not a function');return Reflect.apply(method,receiver,[rect]);},
  put(method,receiver,...args){if(typeof method!=='function')throw new TypeError('screen.put is not a function');return Reflect.apply(method,receiver,args);},
  invalidOperation(){throw new TypeError('Invalid explorer detail operation');}
});
export function renderDetail(state,screen,layout){policy('render',[state,screen,layout]);}
