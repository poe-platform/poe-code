import {createRequire} from "node:module";
import {createComponentPolicy} from "./component-host.js";
import {color} from "./color.js";
import {symbols} from "./symbols.js";
import {getTheme} from "./theme.js";
import {resolveOutputFormat} from "./logging.js";
const native=createRequire(import.meta.url)("./toolcraft-design-rust.node");
const inline=value=>value.replaceAll("\r\n"," ").replaceAll("\n"," ").replaceAll("\r"," ");
const invoke=createComponentPolicy(native.designStaticPolicy,{
  frames:(...values)=>values,empty:()=>"",array:()=>[],truthy:value=>!!value,nullish:value=>value==null,same:(a,b)=>a===b,
  integer:value=>!!Number.isInteger(value),finite:value=>!!Number.isFinite(value),invalidSelection(){throw new Error("selectedIndex must be a finite integer.");},
  markdownSpinner:(options,suffix)=>`- ${inline(options.message)}${invoke("markdownTimer",[options])}${suffix}`,
  markdownTimer:options=>` [${inline(options.timer)}]`,
  runningJson:options=>`${JSON.stringify({type:"spinner",state:"running",message:options.message,...(options.timer?{timer:options.timer}:{})})}\n`,
  stoppedJson:options=>`${JSON.stringify({type:"spinner",state:"stopped",message:options.message,code:options.code??0,...(options.timer?{timer:options.timer}:{}),...(options.subtext?{subtext:options.subtext}:{})})}\n`,
  frameIndex:(frame,frames)=>((frame%frames.length)+frames.length)%frames.length,
  frameColor:(frames,index)=>color.magenta(frames[index]),green:value=>color.green(value),red:value=>color.red(value),
  timer:options=>color.dim(` [${options.timer}]`),bar:()=>color.gray(symbols.bar),
  runningText:(character,options,timer,bar)=>`${character}  ${options.message}${timer}\n${bar}`,
  stoppedText:(symbol,options,timer)=>`${symbol}  ${options.message}${timer}`,
  subtext:(output,bar,options)=>output+`\n${bar}     ${color.dim(options.subtext)}`,
  markdownMenu:(options,selected)=>[`**${inline(options.message)}**`,...options.options.map((option,index)=>`- [${invoke("selectionMark",[index,selected])}] ${inline(option.label)}`)].join("\n"),
  jsonMenu:(options,selected)=>JSON.stringify({type:"menu",message:options.message,options:options.options,selected}),
  theme:getTheme,menuHeader:(lines,options)=>lines.push(`${color.cyan(symbols.active)}  ${options.message}`),push:(lines,value)=>lines.push(value),
  menuOptions:(options,selected,theme,bar,lines)=>options.options.forEach((option,index)=>{invoke("menuOption",[option,index,selected,theme,bar,lines]);}),
  active:()=>color.cyan(symbols.active),inactive:()=>color.gray(symbols.inactive),accent:(theme,option)=>theme.accent(option.label),
  hint:option=>color.dim(` (${option.hint})`),menuLine:(lines,bar,prefix,label,hint)=>lines.push(`${bar}  ${prefix} ${label}${hint}`),
  menuFooter:(lines,bar)=>lines.push(`${bar}`),join:lines=>lines.join("\n"),
  invalidOperation(){throw new TypeError("Invalid static rendering operation");}
});
export const SPINNER_FRAMES=Object.freeze(invoke("frames",[]));
export function renderSpinnerFrame(options){return invoke("running",[options,resolveOutputFormat(),SPINNER_FRAMES]);}
export function renderSpinnerStopped(options){return invoke("stopped",[options,resolveOutputFormat()]);}
export function renderMenu(opts){return invoke("menu",[opts,resolveOutputFormat()]);}
