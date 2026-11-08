import {createRequire} from "node:module";
import {createComponentPolicy} from "./component-host.js";
export {createTerminalStringFilter} from "./output-preview.js";

const native=createRequire(import.meta.url)("./toolcraft-design-rust.node");
const policy=createComponentPolicy(native.designTerminalStringTailPolicy,{
  lt:(a,b)=>a<b,ge:(a,b)=>a>=b,le:(a,b)=>a<=b,
  at:(text,index)=>text[index],
  charCodeAt:(text,index)=>text.charCodeAt(index),
  finish:(end,text)=>Math.min(end+1,text.length)
});
export function terminalControlTailStart(text,start){
  if(!text.includes("\u001b")&&!text.includes("\u009b"))return start;
  return policy("tail",[text,start]);
}
