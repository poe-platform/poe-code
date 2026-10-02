import {createRequire} from "node:module";
import {Readable} from "node:stream";
import {createComponentPolicy} from "./component-host.js";
import {graphemes} from "./graphemes.js";
import {wrapAnsi} from "./wrap-ansi.js";
import stringWidth from "./string-width.js";
import {CANCEL} from "./cancel-symbol.js";
import {ttyPrompt,readStream,readGenericStream,pendingCarriageReturns} from "./prompt-streams.js";
const native=createRequire(import.meta.url)("./toolcraft-design-rust.node");
const aliases={k:"up",j:"down",h:"left",l:"right"};
const keyActions={up:"up",down:"down",left:"left",right:"right",space:"space",return:"enter",enter:"enter",escape:"cancel"};
export const invoke=createComponentPolicy(native.designPromptCorePolicy,{
  false:()=>false,true:()=>true,undefined:()=>undefined,truthy:value=>!!value,nullish:value=>value==null,same:(a,b)=>a===b,
  set:(p,key,value)=>{p[key]=value;},alias:value=>aliases[value],keyAction:value=>keyActions[value],
  add:(a,b)=>a+b,subtract:(a,b)=>a-b,lt:(a,b)=>a<b,gt:(a,b)=>a>b,ge:(a,b)=>a>=b,increment:value=>value+1,
  emit:(p,...args)=>p.emit(...args),emitProperty:(p,name,key)=>p.emit(name,p[key]),
  emitConfirmation:(p,char)=>p.emit("confirm",char.toLowerCase()==="y"),emitKey:(p,char,key)=>p.emit("key",char.toLowerCase(),key),setValue:(p,value)=>p.setValue(value),setUserInput:(p,value)=>p.setUserInput(value),
  clearInput:p=>{p.userInput="";p._cursor=0;p.emit("userInput",p.userInput);},
  minCursor:p=>{p._cursor=Math.min(p._cursor,p.userInput.length);},
  commandArgs(values,tokens){for(const value of values)if(invoke("commandArg",[value,tokens]))break;},
  alignCursor(p,value){const state={boundary:0};for(const segment of graphemes(value))if(invoke("alignSegment",[state,p,segment]))break;return state.boundary;},
  before:p=>p.userInput.slice(0,p._cursor),after:p=>p.userInput.slice(p._cursor),
  lastSize:value=>graphemes(value).at(-1)?.length??0,firstSize:value=>graphemes(value)[0]?.length??0,
  cutInput:p=>p.setUserInput(p.userInput.slice(0,p._cursor)),
  backspaceInput:(p,before,after)=>p.setUserInput(`${before.slice(0,p._cursor)}${after}`),
  deleteInput:(p,before,after)=>p.setUserInput(`${before}${after.slice(graphemes(after)[0]?.length??0)}`),
  insertInput:(p,before,char,after)=>p.setUserInput(`${before}${char}${after}`),
  validation:p=>p.validate?.(p.value),validationMessage:error=>error instanceof Error?error.message:error,
  throwValidation(error){throw error instanceof Error?error:new Error(error);},
  confirmKey:char=>/^[yn]$/i.test(char),
  updateTrackedInput:(p,char,key,action)=>p.updateTrackedInput(char,key,action),
  render:p=>p.render(),close:p=>p.close(),
  frame:p=>invoke("wrapFrame",[p.output,p.renderFrame(p)??""]),
  firstWrite:(p,frame)=>p.output.write(`\x1b[?25l${frame}`),
  replaceWrite(p,frame){const n=p.previousFrame.split("\n").length-1;p.output.write(`\x1b[999D${n>0?`\x1b[${n}A`:n<0?`\x1b[${-n}B`:""}\x1b[J${frame}`);},
  detach(p){p.input.removeListener("keypress",p.onKeypress);p.input.removeListener("close",p.onCancel);p.output.removeListener("resize",p.render);p.signal?.removeEventListener("abort",p.onCancel);p.readlineInterface?.removeListener("close",p.onCancel);},
  showCursor:p=>p.output.write("\x1b[?25h\n"),windows:()=>process.platform.startsWith("win"),rawOff:p=>p.input.setRawMode(false),
  closeReadline:p=>p.readlineInterface?.close(),unpipe:p=>p.input.unpipe?.(),removeAll:p=>p.removeAllListeners(),
  signalAborted:p=>!!p.signal?.aborted,cancelled:value=>value===CANCEL,resolvedCancel:()=>Promise.resolve(CANCEL),resolvedEmpty:()=>Promise.resolve(""),
  nonTty:p=>p.promptNonTty().then(value=>invoke("nonTtyResult",[p,value])),ttyPrompt,
  readable:input=>input instanceof Readable,readStream:(p,input)=>readStream(p,input,invoke),readGenericStream,
  pending:state=>pendingCarriageReturns.get(state.input),deletePending:state=>pendingCarriageReturns.delete(state.input),
  lineFeed:(chunk,offset)=>(typeof chunk==="string"?chunk[offset]==="\n":chunk[offset]===10),freshCR:previous=>Date.now()-previous<=100,
  character:(state,chunk,offset)=>typeof chunk==="string"?chunk[offset]:state.decoder.write(chunk.subarray(offset,offset+1)),
  ends:(value,suffix)=>value.endsWith(suffix),appendLine:(state,value)=>{state.line+=value;},
  appendTrimmed:(state,value)=>{state.line+=value.slice(0,-1);},rememberCR:state=>pendingCarriageReturns.set(state.input,Date.now()),
  settleLine:(state,chunk,offset)=>state.settle(state.line,chunk.slice(offset)),unshift:(state,chunk)=>state.input.unshift(chunk,state.input.readableEncoding??undefined),
  args:argv=>argv.slice(2),array:()=>[],startsFlag:arg=>arg.startsWith("-"),push:(array,value)=>array.push(value),
  nonTtyMessage:tokens=>`Interactive prompt requires a TTY. Re-run with \`${[...tokens,"--yes"].join(" ")}\` to accept defaults non-interactively, or set POE_NO_PROMPT=1 in CI.`,
  max1:value=>Math.max(1,value),width:stringWidth,wrap:(text,width)=>wrapAnsi(text,width,{hard:true,trim:false}),
  prefixLines:(value,prefix,startPrefix)=>value.split("\n").map((line,index)=>`${index===0?startPrefix:prefix}${line}`).join("\n"),
  invalidOperation(){throw new TypeError("Invalid prompt operation");}
});
