import {createRequire} from "node:module";
import {createComponentPolicy} from "./component-host.js";
const native=createRequire(import.meta.url)("./toolcraft-design-rust.node");
const policy=createComponentPolicy(native.designExplorerLayoutPolicy,{
  object:()=>({}),assign:(value,key,item)=>{value[key]=item;},
  add:(a,b)=>a+b,subtract:(a,b)=>a-b,max:Math.max
});
export function computeExplorerLayout(opts){return policy("layout",[opts]);}
export function paneBodyRect(rect){return policy("body",[rect]);}
