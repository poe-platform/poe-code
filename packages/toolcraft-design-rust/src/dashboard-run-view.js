import {createRequire} from "node:module";
import {createComponentPolicy} from "./component-host.js";
import {getTheme} from "./theme.js";
import {plainTerminalText} from "./dashboard-ansi.js";
import {layoutComposer} from "./composer-layout.js";
import {displayWidth,truncateToWidth} from "./terminal.js";
import {renderOutputPane} from "./dashboard-output.js";
import {formatElapsed,formatNumber} from "./dashboard-stats.js";
const native=createRequire(import.meta.url)("./toolcraft-design-rust.node");
const policy=createComponentPolicy(native.designDashboardRunViewPolicy,{
  undefined:()=>undefined,array:()=>[],object:()=>({}),bold:()=>({bold:true}),
  truthy:value=>!!value,nullish:value=>value==null,same:(a,b)=>a===b,lt:(a,b)=>a<b,le:(a,b)=>a<=b,gt:(a,b)=>a>b,ge:(a,b)=>a>=b,
  add:(a,b)=>a+b,subtract:(a,b)=>a-b,multiply:(a,b)=>a*b,divide:(a,b)=>a/b,min:(a,b)=>Math.min(a,b),max:(a,b)=>Math.max(a,b),floor:value=>Math.floor(value),
  at:(value,index)=>value[index],set:(value,key,item)=>{value[key]=item;},push:(array,item)=>array.push(item),last:value=>value.at(-1),
  invoke:(method,receiver,...args)=>Reflect.apply(method,receiver,args),concat:(a,b)=>`${a}${b}`,
  filter:(array,op,...args)=>array.filter(value=>policy(op,[value,...args])),
  find:(array,op,...args)=>array.find(value=>policy(op,[value,...args])),
  findIndex:(array,op,...args)=>array.findIndex(value=>policy(op,[value,...args])),
  map:(array,op,...args)=>array.map(value=>policy(op,[value,...args])),
  walk(op,array,...args){for(const value of array)policy(op,[value,...args]);},
  entries(op,array,...args){for(const [index,value]of array.entries())if(policy(op,[index,value,...args]))break;},
  join:(values,separator)=>values.join(separator),filterJoin:(...values)=>values.filter(Boolean).join(" · "),
  split:(value,separator)=>value.split(separator),slice:(value,start)=>value.slice(start),startsWith:(value,prefix)=>value.startsWith(prefix),endsWith:(value,suffix)=>value.endsWith(suffix),repeat:(value,count)=>value.repeat(count),
  rect:(x,y,width,height)=>({x,y,width,height}),point:(x,y)=>({x,y}),boldStyle:style=>({...style,bold:true}),
  markers:()=>({completed:"✓",running:"›",failed:"!",cancelled:"×",paused:"Ⅱ",pending:"○"}),
  statusMarkers:()=>({running:"●",error:"!",paused:"Ⅱ",idle:"○",done:"✓"}),
  outputOptions:(details,now)=>({conversation:true,details,now}),
  result:(scrollOffset,workOffset,outputRect,cursor)=>({scrollOffset,workOffset,outputRect,...(cursor?{cursor}:{})}),
  getTheme,plainTerminalText,layoutComposer,displayWidth,truncateToWidth,renderOutputPane,formatElapsed,formatNumber,
  invalidOperation(){throw new TypeError("Invalid dashboard run-view operation");}
});
export function renderRunView(buffer,options){return policy("render",[buffer,options]);}
