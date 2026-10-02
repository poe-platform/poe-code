import {createRequire} from "node:module";
import {createComponentPolicy} from "./component-host.js";
import {getTheme} from "./theme.js";
import {plainTerminalText} from "./dashboard-ansi.js";
import {displayWidth,graphemes,graphemeWidth,truncateToWidth} from "./terminal.js";
import {computeVisualLines} from "./dashboard-output.js";
import {formatElapsed} from "./dashboard-elapsed.js";
export {formatElapsed} from "./dashboard-elapsed.js";
const native=createRequire(import.meta.url)("./toolcraft-design-rust.node");
const policy=createComponentPolicy(native.designDashboardStatsPolicy,{
  undefined:()=>undefined,object:()=>({}),array:()=>[],
  same:(a,b)=>a===b,le:(a,b)=>a<=b,lt:(a,b)=>a<b,gt:(a,b)=>a>b,truthy:value=>!!value,nullish:value=>value==null,
  add:(a,b)=>a+b,subtract:(a,b)=>a-b,max:(a,b)=>Math.max(a,b),min:(a,b)=>Math.min(a,b),
  at:(value,index)=>value[index],set:(value,key,item)=>{value[key]=item;},
  invoke:(method,receiver,...args)=>Reflect.apply(method,receiver,args),
  walkUntil(operation,values,...args){for(const value of values)if(policy(operation,[value,...args]))break;},
  push:(array,value)=>array.push(value),slice:(value,...args)=>value.slice(...args),
  upper:value=>value.toUpperCase(),repeat:(value,count)=>value.repeat(count),
  number:value=>new Intl.NumberFormat("en-US").format(value),
  progress:(label,count,total)=>`${label} ${count}${total}`,fraction:(count,total)=>`${count}/${total}`,slash:value=>`/${value}`,
  pair:(first,second)=>`${first} · ${second}`,metrics:(primary,elapsed,tokens)=>`${primary} · ${elapsed} · ${tokens} tokens`,
  messages:(first,second)=>[first,second].map(plainTerminalText),
  line:(prefix,prefixStyle,style,text)=>({prefix,prefixStyle,style,text}),
  rect:(x,y,width,height)=>({x,y,width,height}),replaceText:(line,text)=>({...line,text}),ellipsis:text=>`${text}…`,
  actionLines:(action,width)=>computeVisualLines([{kind:"status",text:action,ts:0}],width),
  mapActions:(lines,width,style)=>lines.map(line=>policy("actionLine",[line,width,style])),
  append:(lines,blank,heading,actions)=>lines.push(blank,heading,...actions),
  filter:lines=>lines.filter(line=>policy("nonempty",[line])),
  prioritize:(first,progress,actions,secondary)=>[first,...progress,...actions,...secondary],
  getTheme,plainTerminalText,displayWidth,graphemes,graphemeWidth,truncateToWidth,formatElapsed,
  invalidOperation(){throw new TypeError("Invalid dashboard stats operation");}
});
export function formatNumber(value){return policy("number",[value]);}
export function statsToLines(stats,width){return policy("lines",[stats,width]);}
export function renderStatsPane(buffer,rect,stats){policy("render",[buffer,rect,stats]);}
export function renderCompactStatsPane(buffer,rect,stats){policy("compact",[buffer,rect,stats]);}
