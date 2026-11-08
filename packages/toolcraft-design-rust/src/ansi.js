import { createRequire } from "node:module";
import { createComponentPolicy } from "./component-host.js";
const native=createRequire(import.meta.url)("./toolcraft-design-rust.node");
const invoke=createComponentPolicy(native.designAnsiPolicy,{
  empty:()=>"",zero:()=>0,at:(value,index)=>value[index],charCode:(value,index)=>value.charCodeAt(index),
  lt:(a,b)=>a<b,add:(a,b)=>a+b,increment:value=>value+1,plusTwo:value=>value+2,
  min:Math.min,final:code=>code>=0x40&&code<=0x7e,
  invalidOperation(){throw new TypeError("Invalid ANSI operation");}
});
export function stripAnsi(value) {
  if(typeof value === "string") {
    if(!value.includes("\x1b")&&!value.includes("\u009b")) return value;
    return native.designStripAnsi(value);
  }
  return invoke("strip",[value]);
}
