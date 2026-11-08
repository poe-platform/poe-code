import {createRequire} from "node:module";
import {createComponentPolicy} from "./component-host.js";
import {createDashboard} from "./dashboard-runtime.js";
import {createDashboardLineBuffer} from "./line-buffer.js";

const native=createRequire(import.meta.url)("./toolcraft-design-rust.node");
const policy=createComponentPolicy(native.designPipelineScenarioPolicy,{
  undefined:()=>undefined,true:()=>true,false:()=>false,object:()=>({}),array:(...values)=>values,
  define:(object,key,value)=>Object.defineProperty(object,key,{value,enumerable:true,writable:true,configurable:true}),
  add:(a,b)=>a+b,template:value=>`${value}`,repeat:(value,count)=>value.repeat(count),
  invoke(method,receiver,value,name){
    if(typeof method!=="function")throw new TypeError(`${name} is not a function`);
    return Reflect.apply(method,receiver,[value]);
  },
  buffer:()=>createDashboardLineBuffer(line=>append("tool",line)),
  flush:output=>output.flush(),
  interval:(burst,delay)=>{timer=setInterval(()=>{policy("tick",[state,dashboard,burst]);},delay);},
  invalidOperation(){throw new TypeError("Invalid pipeline scenario operation");}
});

const scenario=process.argv[2]??"streaming";
const labelControl=policy("label",[scenario]);
const dashboard=createDashboard(policy("options",[scenario,labelControl]));
const state={count:0};
let timer;
const append=(kind,text)=>{policy("append",[state,dashboard,kind,text]);};
const shutdown=()=>{
  clearInterval(timer);
  dashboard.destroy();
};
dashboard.onCommand(command=>{if(policy("quit",[command]))shutdown();});
process.once("SIGINT",shutdown);
process.once("SIGTERM",shutdown);
dashboard.start();
policy("initial",[state,dashboard,scenario,labelControl]);
if(timer===undefined)timer=setInterval(()=>{},1000);
