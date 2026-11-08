import {createRequire} from "node:module";
import {createComponentPolicy} from "./component-host.js";
import {getTheme} from "./theme.js";
import {plainTerminalText,displayWidth,truncateToWidth,graphemes,graphemeWidth} from "./terminal.js";
const native=createRequire(import.meta.url)("./toolcraft-design-rust.node");
const policy=createComponentPolicy(native.designDashboardFooterPolicy,{
  undefined:()=>undefined,true:()=>true,false:()=>false,
  object:()=>({}),array:()=>[],fitState:()=>({width:0}),
  add:(a,b)=>a+b,subtract:(a,b)=>a-b,divide:(a,b)=>a/b,
  floor:value=>Math.floor(value),ceil:value=>Math.ceil(value),min:(a,b)=>Math.min(a,b),max:(a,b)=>Math.max(a,b),
  le:(a,b)=>a<=b,gt:(a,b)=>a>b,same:(a,b)=>a===b,truthy:value=>!!value,nullish:value=>value==null,
  at:(value,index)=>value[index],set:(value,key,item)=>{value[key]=item;},
  invoke:(method,receiver,...args)=>Reflect.apply(method,receiver,args),
  string:value=>`${value}`,agentText:(agent,model)=>`${agent} · ${model}`,
  hintText:hint=>`${hint.key} ${hint.label}`,hint:(key,label)=>({key,label}),
  push:(array,value)=>array.push(value),cell:(ch,style)=>({ch,style}),
  mapHints:hints=>hints.map(hint=>policy("normalizeHint",[hint])),
  fitHints(hints,fitted,state,rect){for(const hint of hints)if(policy("fitHint",[hint,fitted,state,rect]))break;},
  hintCells(hints,cells,style){hints.forEach((hint,index)=>{policy("hintCells",[hint,index,cells,style]);});},
  keyCells(cells,key,style){for(const ch of graphemes(key))cells.push({ch,style});},
  labelCells(cells,label){for(const ch of graphemes(label))cells.push({ch,style:{}});},
  draw(buffer,cells,x,y){cells.forEach(cell=>{x=policy("drawCell",[buffer,cell,x,y]);});},
  getTheme,plainTerminalText,displayWidth,truncateToWidth,graphemeWidth,
  invalidOperation(){throw new TypeError("Invalid dashboard footer operation");}
});
export function defaultHints(){return policy("defaults",[]);}
export function renderFooter(buffer,rect,hints,session){policy("render",[buffer,rect,hints,session]);}
