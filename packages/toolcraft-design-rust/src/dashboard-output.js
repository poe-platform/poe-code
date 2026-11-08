import {createRequire} from "node:module";
import {createComponentPolicy} from "./component-host.js";
import {getTheme} from "./theme.js";
import {supportsColor} from "./color-support.js";
import {parse,render} from "./markdown.js";
import {hasAnsi,parseAnsi} from "./dashboard-ansi.js";
import {displayWidth,expandTabs,graphemes,graphemeWidth} from "./terminal.js";
import {formatElapsed} from "./dashboard-elapsed.js";
import {selectViewportTail} from "./viewport.js";
const native=createRequire(import.meta.url)("./toolcraft-design-rust.node");
const agentLines=new WeakMap();
const policy=createComponentPolicy(native.designDashboardOutputPolicy,{
  undefined:()=>undefined,object:()=>({}),array:()=>[],true:()=>true,false:()=>false,
  add:(a,b)=>a+b,subtract:(a,b)=>a-b,max:(a,b)=>Math.max(a,b),min:(a,b)=>Math.min(a,b),
  le:(a,b)=>a<=b,lt:(a,b)=>a<b,gt:(a,b)=>a>b,ge:(a,b)=>a>=b,same:(a,b)=>a===b,truthy:value=>!!value,nullish:value=>value==null,finite:Number.isFinite,
  at:(value,index)=>value[index],set:(value,key,item)=>{value[key]=item;},
  invoke:(method,receiver,...args)=>Reflect.apply(method,receiver,args),
  walk(operation,values,...args){for(const value of values)policy(operation,[value,...args]);},
  walkUntil(operation,values,...args){for(const value of values)if(policy(operation,[value,...args]))break;},
  line:(prefix,prefixStyle,style,text)=>({prefix,prefixStyle,style,text}),
  withSegments:(line,segments)=>({...line,segments}),segment:(text,style)=>({text,style:{...style}}),
  token:(kind,value)=>({kind,value}),rect:(x,y,width,height)=>({x,y,width,height}),
  push:(array,value)=>array.push(value),pop:array=>array.pop(),shift:array=>array.shift(),
  slice:(value,...args)=>value.slice(...args),join:(value,separator)=>value.join(separator),
  trim:value=>value.trim(),charCodeAt:(value,index)=>value.charCodeAt(index),
  segmentText:segments=>segments.map(segment=>segment.text).join(""),
  emptyLines:lines=>lines.map(()=>""),
  wrapLines:(lines,width)=>lines.flatMap(line=>policy("paragraph",[expandTabs(line),width])),
  cloneLines:lines=>lines.map(line=>({...line})),
  someFootnotes:children=>children.some(child=>policy("footnotes",[child])),hasChildren:node=>"children" in node,
  replaceText:(item,text)=>({...item,text}),
  summary:(count,ts)=>({role:"action",kind:"status",ts,text:`${count} earlier actions · d Details`}),
  appendAll:(target,items)=>target.push(...items),
  details:(label,detail)=>`${label}\n${detail}`,durationLabel:(label,duration)=>`${label} · ${duration}`,
  elapsedSlice:duration=>duration.slice(3),
  cacheGet:item=>agentLines.get(item),cacheSet:(item,value)=>agentLines.set(item,value),
  cached:(text,width,theme,color,budget,complete,lines)=>({text,width,theme,color,budget,complete,lines}),
  agentResult:(lines,complete)=>({lines,complete}),
  renderOptions:width=>({width,showFrontmatter:true}),
  newlineCount:fragment=>fragment.split("\n").length-1,
  reverseJoin:fragments=>fragments.reverse().join(""),
  attemptMarkdown(...args){try{return {value:policy("agentBuild",args)};}catch{return {failed:true};}},
  viewport:(items,height,offset,rect,options)=>selectViewportTail(items,height,offset,item=>policy("itemRows",[item,rect,options,offset])),
  getTheme,supportsColor,get parse(){return parse;},get render(){return render;},hasAnsi,parseAnsi,get displayWidth(){return displayWidth;},expandTabs,graphemes,graphemeWidth,formatElapsed,
  invalidOperation(){throw new TypeError("Invalid dashboard output operation");}
});
export function computeVisualLines(items,width,preformatted=false){return policy("compute",[items,width,preformatted]);}
export function renderOutputPane(buffer,rect,items,scrollOffset=0,options={}){return policy("render",[buffer,rect,items,scrollOffset,options]);}
