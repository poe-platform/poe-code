import {createRequire} from "node:module";
import {callNative,protect} from "./host-errors.js";

const native=createRequire(import.meta.url)("./toolcraft-rust.node");
let depth=0;
function invoke(operation,args){
  if(depth>=128)throw new RangeError("Maximum call stack size exceeded");
  depth++;
  try{return callNative(native.stackTrimPolicy,operation,args,host);}
  finally{depth--;}
}
const operations={
  undefined:()=>undefined,true:()=>true,false:()=>false,
  list:(...values)=>values,first:lines=>lines[0],section:header=>({header,lines:[]}),
  split:(stack,separator)=>stack.split(separator),
  trimStart:line=>line.trimStart(),startsWith:(line,prefix)=>line.startsWith(prefix),
  replaceAll:(line,from,to)=>line.replaceAll(from,to),includes:(line,pattern)=>line.includes(pattern),
  truthy:value=>!!value,zero:value=>value===0,one:value=>value===1,
  add:(a,b)=>a+b,interpolate:(prefix,count,suffix)=>`${prefix}${count}${suffix}`,
  push:(values,value)=>values.push(value),
  appendLast:(sections,line)=>sections[sections.length-1]?.lines.push(line),
  eachLine(lines,sections){for(const line of lines.slice(1))invoke("line",[line,sections]);},
  eachFrame(lines,userFrames,skippedFrames){for(const line of lines)invoke("frame",[line,userFrames,skippedFrames]);},
  mapSections:sections=>sections.map(section=>invoke("section",[section])),
  sumHidden:trimmed=>trimmed.reduce((count,section)=>invoke("count",[count,section]),0),
  joinSections:trimmed=>trimmed.flatMap(section=>section.lines).join("\n"),
  untouchedSection:section=>({lines:[section.header,...section.lines],hiddenFrameCount:0}),
  trimmedSection:(section,userFrames,skippedFrames)=>({
    lines:[section.header,...userFrames,invoke("summary",[skippedFrames.length])],
    hiddenFrameCount:skippedFrames.length
  }),
  invalidOperation(){throw new TypeError("Invalid stack diagnostic operation");}
};
const host={operate:protect((name,args)=>operations[name](...args)),get:protect((value,key)=>value[key])};

export function enableSourceMaps(){process.setSourceMapsEnabled?.(true);}
export function formatDebugStack(stack,mode){return invoke("format",[stack,mode]);}
export function trimStack(stack){return invoke("trim",[stack]);}
