import {createRequire} from "node:module";
import {createComponentPolicy} from "./component-host.js";
import {resolveOutputFormat} from "./logging.js";
import {color} from "./color.js";
import {spinner} from "./spinner.js";
const native=createRequire(import.meta.url)("./toolcraft-design-rust.node");
const invoke=createComponentPolicy(native.designWithSpinnerPolicy,{
  format:resolveOutputFormat,noSpinner:()=>process.env.POE_NO_SPINNER==="1",tty:()=>!!process.stdout.isTTY,
  same:(a,b)=>a===b,truthy:value=>!!value,undefined:()=>undefined,
  begin:state=>{state.spinner=spinner();state.start=Date.now();},
  readMessage:state=>{const {message}=state;return typeof message==="function"?message():message;},
  start:(state,message)=>state.spinner.start(message),
  schedule:state=>{state.timer=setInterval(()=>{invoke("tick",[state]);},1000);},
  clear:state=>clearInterval(state.timer),
  seconds:state=>Math.floor((Date.now()-state.start)/1000),lt:(a,b)=>a<b,
  shortElapsed:seconds=>`${seconds}s`,longElapsed:seconds=>`${Math.floor(seconds/60)}m ${seconds%60}s`,
  timedMessage:(message,elapsed)=>`${message} [${elapsed}]`,message:(state,message)=>state.spinner.message(message),
  stopMessage:(state,result)=>{const {stopMessage}=state;return stopMessage(result);},
  subtext:(state,result)=>{const {subtext}=state;return subtext(result);},
  stop:(state,...args)=>state.spinner.stop(...args),
  jsonSubtext:sub=>process.stdout.write(sub+"\n"),
  fallbackMessage:message=>process.stdout.write(`${color.green("◆")}  ${message}\n`),
  guidedSubtext(sub){for(const line of sub.split("\n"))process.stdout.write(`${color.gray("│")}     ${line}\n`);},
  invalidOperation(){throw new TypeError("Invalid withSpinner operation");}
});
export async function withSpinner(options){
  const {message,fn,stopMessage,subtext}=options;
  const state={message,stopMessage,subtext};
  const mode=invoke("begin",[state]);
  if(mode!==2){
    const result=await fn();invoke("finish",[state,result,mode]);return result;
  }
  try{
    const result=await fn();invoke("finish",[state,result,mode]);return result;
  }catch(error){invoke("fail",[state]);throw error;}
}
