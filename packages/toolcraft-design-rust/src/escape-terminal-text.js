import {createRequire} from "node:module";
import {createComponentPolicy} from "./component-host.js";
const native=createRequire(import.meta.url)("./toolcraft-design-rust.node");
const invoke=createComponentPolicy(native.designEscapeTerminalPolicy,{
  point:character=>character.codePointAt(0),le:(a,b)=>a<=b,ge:(a,b)=>a>=b,same:(a,b)=>a===b,
  escaped:code=>`\\u${code.toString(16).padStart(4,"0")}`,
  invalidOperation(){throw new TypeError("Invalid terminal escape operation");}
});
export function escapeTerminalText(text) {
  let result="";
  for(const character of text)result+=invoke("character",[character]);
  return result;
}
