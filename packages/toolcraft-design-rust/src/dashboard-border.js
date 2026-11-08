import {createRequire} from "node:module";
import {createComponentPolicy} from "./component-host.js";
import {plainTerminalText,displayWidth,truncateToWidth} from "./terminal.js";
const native=createRequire(import.meta.url)("./toolcraft-design-rust.node");
const policy=createComponentPolicy(native.designDashboardBorderPolicy,{
  undefined:()=>undefined,true:()=>true,false:()=>false,
  add:(a,b)=>a+b,subtract:(a,b)=>a-b,
  max:(a,b)=>Math.max(a,b),min:(a,b)=>Math.min(a,b),
  same:(a,b)=>a===b,le:(a,b)=>a<=b,lt:(a,b)=>a<b,ge:(a,b)=>a>=b,gt:(a,b)=>a>b,
  truthy:value=>!!value,repeat:(value,count)=>value.repeat(count),
  invoke:(method,receiver,...args)=>Reflect.apply(method,receiver,args),
  joined:(...parts)=>parts.join(""),
  titled:(line,title)=>`${line} ${title} `,
  framed:(left,content,right)=>`${left}${content}${right}`,
  plainTerminalText,displayWidth,truncateToWidth,
  invalidOperation(){throw new TypeError("Invalid dashboard border operation");}
});
export function renderBorder(buffer,layout,opts){policy("render",[buffer,layout,opts]);}
