import {createRequire} from "node:module";
import {createComponentPolicy} from "./component-host.js";
const native=createRequire(import.meta.url)("./toolcraft-design-rust.node");
const PASTE_START=Buffer.from("\x1b[200~"),PASTE_END=Buffer.from("\x1b[201~");
function key(name,ctrl=false,alt=false,shift=false){return {type:"key",name,ctrl,alt,shift};}
const policy=createComponentPolicy(native.designTerminalInputPolicy,{
  undefined:()=>undefined,array:()=>[],add:(a,b)=>a+b,subtract:(a,b)=>a-b,
  ge:(a,b)=>a>=b,gt:(a,b)=>a>b,le:(a,b)=>a<=b,lt:(a,b)=>a<b,same:(a,b)=>a===b,truthy:value=>!!value,
  number:value=>Number(value),at:(value,index)=>value[index],stringAt:(value,index)=>value.at(index),
  slice:(value,start,end)=>value.slice(start,end),split:(value,separator)=>value.split(separator),
  startsWith:(value,prefix)=>!!value.startsWith(prefix),endsWith:(value,suffix)=>!!value.endsWith(suffix),
  fromCharCode:value=>String.fromCharCode(value),controlName:byte=>`control-${byte}`,
  key,
  character:(ch,alt)=>({type:"key",name:ch,ch,ctrl:false,alt,shift:ch.toLocaleUpperCase()===ch&&ch.toLocaleLowerCase()!==ch}),
  wheel:(direction,x,y)=>({type:"wheel",direction,x,y}),withAlt:event=>({...event,alt:true}),
  decoded:(ch,bytes)=>({ch,bytes}),push:(events,event)=>events.push(event),
  pushPaste:(events,pending,end)=>events.push({type:"paste",text:pending.subarray(0,end).toString("utf8")}),
  everyEscape:pending=>!!pending.every(byte=>byte===27),emptyBuffer:()=>Buffer.alloc(0),
  bufferFrom:chunk=>Buffer.from(chunk),bufferConcat:(pending,chunk)=>Buffer.concat([pending,chunk]),
  subarray:(value,start,end)=>value.subarray(start,end),suffix:(value,start)=>value.subarray(start),
  utf8:value=>value.toString("utf8"),ascii:value=>value.toString("ascii"),
  pasteStart:pending=>!!pending.subarray(0,PASTE_START.length).equals(PASTE_START),pasteEnd:pending=>pending.indexOf(PASTE_END),
  pasteStartLength:()=>PASTE_START.length,pasteEndLength:()=>PASTE_END.length,
  setPending:(state,value)=>{state.pending=value;},setPaste:(state,value)=>{state.paste=value;},
  setTimer:(state,value)=>{state.timer=value;},setEscapeReady:(state,value)=>{state.escapeReady=value;},
  clearTimer:timer=>clearTimeout(timer),armTimer:state=>{state.timer=setTimeout(()=>policy("timeout",[state]),state.escTimeoutMs);},
  emitKey:(options,name)=>options.onEvent(key(name)),
  invalidOperation:()=>{throw new TypeError("Invalid terminal input operation");}
});
export function createInputParser(options={}) {
  const escTimeoutMs=options.escTimeoutMs??50;
  const state={pending:Buffer.alloc(0),paste:false,timer:undefined,escapeReady:false,options,escTimeoutMs};
  return {
    feed(chunk){return policy("feed",[state,chunk]);},
    flush(){return policy("parse",[state]);},
    destroy(){policy("destroy",[state]);}
  };
}
