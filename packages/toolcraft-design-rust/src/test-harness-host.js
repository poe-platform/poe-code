import {createRequire} from "node:module";
import {createComponentPolicy} from "./component-host.js";
const native=createRequire(import.meta.url)("./toolcraft-design-rust.node");
export const harnessPolicy=createComponentPolicy(native.designTestHarnessPolicy,{
  undefined:()=>undefined,true:()=>true,false:()=>false,truthy:value=>!!value,nullish:value=>value==null,
  set:(object,key,value)=>{object[key]=value;},string:value=>String(value),
  push:(array,value)=>array.push(value),
  join(array){
    const method=array.join;
    if(typeof method!=="function")throw new TypeError("this.writes.join is not a function");
    return Reflect.apply(method,array,[""]);
  },
  pushWrites(array,value){
    const method=array.push;
    if(typeof method!=="function")throw new TypeError("this.writes.push is not a function");
    return Reflect.apply(method,array,[value]);
  },
  gt:(a,b)=>a>b,increment:value=>value+1,
  keyEvent:(type,name,ch,ctrl,alt,shift)=>({type,name,ch,ctrl,alt,shift}),
  dispatchKey(driver,event){for(const handler of driver.eventHandlers)handler(event);},
  invalidOperation(){throw new TypeError("Invalid testing harness operation");}
});
