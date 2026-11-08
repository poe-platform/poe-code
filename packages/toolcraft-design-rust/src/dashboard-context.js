import {createRequire} from "node:module";
import {createComponentPolicy} from "./component-host.js";
import {computeVisualLines} from "./dashboard-output.js";
import {plainTerminalText} from "./dashboard-ansi.js";
import {truncateToWidth} from "./terminal.js";
const native=createRequire(import.meta.url)("./toolcraft-design-rust.node");
const policy=createComponentPolicy(native.designDashboardContextPolicy,{
  undefined:()=>undefined,same:(a,b)=>a===b,le:(a,b)=>a<=b,gt:(a,b)=>a>b,ge:(a,b)=>a>=b,
  add:(a,b)=>a+b,subtract:(a,b)=>a-b,divide:(a,b)=>a/b,max:(a,b)=>Math.max(a,b),floor:value=>Math.floor(value),
  at:(value,index)=>value[index],set:(value,index,item)=>{value[index]=item;},
  invoke:(method,receiver,...args)=>Reflect.apply(method,receiver,args),
  entries:(context,rect)=>context.map(text=>policy("entry",[text,rect])),
  lines:(text,width)=>computeVisualLines([{kind:"info",text,ts:0}],width),
  flat:entries=>entries.flat(),slice:(lines,end)=>lines.slice(0,end),
  ellipsis:text=>`${text}…`,queued:count=>`… more plans (${count} queued)`,
  replaceText:(line,text)=>({...line,text}),rectHeight:(rect,height)=>({...rect,height}),
  remaining:(rect,count)=>({...rect,y:rect.y+count,height:rect.height-count}),
  paint:(lines,buffer,rect)=>lines.forEach((line,row)=>policy("paint",[line,row,buffer,rect])),
  dim:row=>({dim:row>0}),plainTerminalText,truncateToWidth,
  invalidOperation(){throw new TypeError("Invalid dashboard context operation");}
});
export function renderContextPane(buffer,rect,context){return policy("render",[buffer,rect,context]);}
