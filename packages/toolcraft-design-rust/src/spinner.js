import {createRequire} from "node:module";
import {createComponentPolicy} from "./component-host.js";
import {resolveOutputFormat,stripAnsi} from "./logging.js";
import {color} from "./color.js";
import {SPINNER_FRAMES} from "./static.js";
const native=createRequire(import.meta.url)("./toolcraft-design-rust.node");
const invoke=createComponentPolicy(native.designSpinnerPolicy,{
  strip:stripAnsi,current:(state,value)=>{state.currentMessage=value;},truthy:value=>!!value,undefined:()=>undefined,
  noSpinner:()=>process.env.POE_NO_SPINNER==="1",tty:()=>!!process.stdout.isTTY,true:()=>true,false:()=>false,
  fallback:(state,value)=>{state.fallback=value;},index:(state,value)=>{state.frameIndex=value;},timer:(state,value)=>{state.timer=value;},
  markdownStart:state=>process.stdout.write(`- ${state.currentMessage}...\n`),
  fallbackStart:state=>process.stdout.write(`${color.gray("│")}  ${state.currentMessage}\n`),
  frame:index=>SPINNER_FRAMES[index%SPINNER_FRAMES.length],renderFrame:(frame,message)=>process.stdout.write(`\r\x1b[K${frame}  ${message}`),
  interval:state=>setInterval(()=>{invoke("tick",[state]);},16),increment:value=>value+1,clear:timer=>clearInterval(timer),same:(a,b)=>a===b,
  jsonStop:state=>process.stdout.write(`${JSON.stringify({type:"spinner",state:"stopped",message:state.currentMessage})}\n`),
  markdownStop:state=>process.stdout.write(`- ${state.currentMessage}\n`),green:value=>color.green(value),red:value=>color.red(value),
  fallbackStop:(state,symbol)=>process.stdout.write(`${symbol}  ${state.currentMessage}\n`),
  terminalStop:(state,symbol)=>process.stdout.write(`\r\x1b[K${symbol}  ${state.currentMessage}\n`),
  invalidOperation(){throw new TypeError("Invalid spinner operation");}
});
export function spinner(){
  const state={currentMessage:"",frameIndex:0,timer:undefined,fallback:false,format:resolveOutputFormat()};
  return {
    start(message=""){invoke("start",[state,message,undefined]);},
    message(message=""){invoke("message",[state,message,undefined]);},
    stop(message=state.currentMessage,code){invoke("stop",[state,message,code]);}
  };
}
