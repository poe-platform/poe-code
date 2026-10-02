import {createRequire} from "node:module";
import {createComponentPolicy} from "./component-host.js";
import {resolveOutputFormat,stripAnsi} from "./logging.js";
import {color} from "./color.js";
import {text} from "./text.js";
import {symbols} from "./symbols.js";
const native=createRequire(import.meta.url)("./toolcraft-design-rust.node");
const invoke=createComponentPolicy(native.designPromptOutputPolicy,{
  format:resolveOutputFormat,strip:stripAnsi,undefined:()=>undefined,
  emit:(operation,...args)=>process.stdout.write(invoke(operation,args)),
  inline:value=>value.replaceAll("\r\n"," ").replaceAll("\n"," ").replaceAll("\r"," "),
  gray:value=>color.gray(value),red:value=>color.red(value),yellow:value=>color.yellow(value),introText:value=>text.intro(value),
  heading:title=>`# ${title}\n\n`,prefix:value=>`${value}  `,line:(prefix,value)=>`${prefix}${value}\n`,
  outroMarkdown:message=>`---\n${message}\n`,outroJson:message=>`${JSON.stringify({type:"outro",message})}\n`,
  newline:value=>`${value}\n`,endPrefix:(prefix,end)=>`${prefix}${end}  `,ending:(prefix,message)=>`${prefix}${message}\n\n`,
  symbol:name=>symbols[name],symbolOptions:symbol=>({symbol}),jsonLog:(level,message)=>`${JSON.stringify({level,message})}\n`,
  options({symbol=color.gray("│"),secondarySymbol=color.gray("│"),spacing=1,withGuide=true}={}){return {symbol,secondarySymbol,spacing,withGuide};},
  array:()=>[],guide:value=>value!==false,split:msg=>msg.split("\n"),lt:(a,b)=>a<b,gt:(a,b)=>a>b,same:(a,b)=>a===b,
  push:(lines,value)=>lines.push(value),increment:value=>value+1,
  first(contentLines){const [firstLine="",...continuationLines]=contentLines;return {firstLine,continuationLines};},pair:(a,b)=>`${a}${b}`,
  continuation(rest,lines,prefix,empty){for(const line of rest)invoke("logLine",[line,lines,prefix,empty]);},
  terminalOutput:lines=>`${lines.join("\n")}\n`,
  invalidOperation(){throw new TypeError("Invalid prompt output operation");}
});
export function intro(title){invoke("intro",[title]);}
export function introPlain(title){invoke("introPlain",[title]);}
export function outro(message){invoke("outro",[message]);}
export function cancel(msg=""){invoke("cancel",[msg]);}
export function message(msg,options){invoke("message",[msg,options]);}
export function info(msg){invoke("info",[msg]);}
export function success(msg){invoke("success",[msg]);}
export function warn(msg){invoke("warn",[msg]);}
export function error(msg){invoke("error",[msg]);}
export const log={info,success,message,warn,error};
