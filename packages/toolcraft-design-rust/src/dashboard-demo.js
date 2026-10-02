import path from "node:path";
import process from "node:process";
import {fileURLToPath} from "node:url";
import {createRequire} from "node:module";
import {createComponentPolicy} from "./component-host.js";
import {createDashboard} from "./dashboard-runtime.js";

const native=createRequire(import.meta.url)("./toolcraft-design-rust.node");
const config=native.designDashboardDemoConfig();
const policy=createComponentPolicy(native.designDashboardDemoPolicy,{
  undefined:()=>undefined,true:()=>true,false:()=>false,object:()=>({}),
  assign:(value,key,item)=>{value[key]=item;},at:(value,key)=>value[key],nullish:value=>value==null,
  add:(a,b)=>a+b,sub:(a,b)=>a-b,mul:(a,b)=>a*b,mod:(a,b)=>a%b,
  clampRandom:(random,ceiling)=>Math.max(0,Math.min(ceiling,random())),
  floorIndex:(value,length)=>Math.floor(value*length),clock:now=>now(),
  invokeAppend(method,dashboard,item){
    if(typeof method!=="function")throw new TypeError("dashboard.appendOutput is not a function");
    return Reflect.apply(method,dashboard,[item]);
  },
  invokeStats(method,dashboard,item){
    if(typeof method!=="function")throw new TypeError("dashboard.updateStats is not a function");
    return Reflect.apply(method,dashboard,[item]);
  },
  stopDemo:stopDemo=>stopDemo(),destroy:dashboard=>dashboard.destroy(),exit:code=>process.exit(code),
  invalidOperation(){throw new TypeError("Invalid dashboard demo operation");}
});

export function startDashboardDemo(dashboard,runtime={}){
  const setIntervalFn=runtime.setInterval??globalThis.setInterval.bind(globalThis);
  const clearIntervalFn=runtime.clearInterval??globalThis.clearInterval.bind(globalThis);
  const setTimeoutFn=runtime.setTimeout??globalThis.setTimeout.bind(globalThis);
  const clearTimeoutFn=runtime.clearTimeout??globalThis.clearTimeout.bind(globalThis);
  const now=runtime.now??Date.now;
  const random=runtime.random??Math.random;
  const state={};
  policy("init",[state,dashboard]);
  const outputTimer=setIntervalFn(()=>{policy("output",[state,dashboard,config,random,now]);},config.outputInterval);
  const statsTimer=setIntervalFn(()=>{policy("stats",[state,dashboard,config]);},config.statsInterval);
  const finishTimeout=setTimeoutFn(()=>{cleanup();policy("finish",[state,dashboard,config]);},config.duration);
  function cleanup(){
    if(!policy("cleanup",[state]))return;
    clearTimeoutFn(finishTimeout);
    clearIntervalFn(outputTimer);
    clearIntervalFn(statsTimer);
  }
  return cleanup;
}

export async function main(){
  const dashboard=createDashboard(policy("options",[]));
  const stopDemo=startDashboardDemo(dashboard);
  const state={};
  const shutdown=exitCode=>{policy("shutdown",[state,dashboard,stopDemo,exitCode]);};
  dashboard.onCommand(command=>{if(policy("quit",[command]))shutdown(0);});
  process.once("SIGINT",()=>{shutdown(0);});
  process.once("SIGTERM",()=>{shutdown(0);});
  dashboard.start();
}

const entry=process.argv[1];
const isMain=typeof entry==="string"&&path.resolve(entry)===fileURLToPath(import.meta.url);
if(isMain){
  main().catch(error=>{
    const message=error instanceof Error?error.message:String(error);
    process.stderr.write(`${message}\n`);
    process.exitCode=1;
  });
}
