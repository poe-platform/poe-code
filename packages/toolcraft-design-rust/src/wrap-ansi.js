import { createRequire } from "node:module";
import { createComponentPolicy } from "./component-host.js";
import stringWidth from "./string-width.js";
const native=createRequire(import.meta.url)("./toolcraft-design-rust.node");
const groups=/(?:\[(?<code>\d+)m|\]8;;(?<uri>.*)\u0007)/y;
const lines=/\r?\n/;
const invoke=createComponentPolicy(native.designWrapAnsiPolicy,{
  zero:()=>0,empty:()=>"",undefined:()=>undefined,
  isFalse:value=>value===false,truthy:value=>!!value,isZero:value=>value===0,
  lt:(a,b)=>a<b,le:(a,b)=>a<=b,ge:(a,b)=>a>=b,gt:(a,b)=>a>b,same:(a,b)=>a===b,
  add:(a,b)=>a+b,subtract:(a,b)=>a-b,increment:value=>++value,decrement:value=>--value,
  iterator:word=>word[Symbol.iterator](),next:iterator=>iterator.next(),
  width:stringWidth,words:text=>text.split(" "),at:(value,index)=>value[index],
  last:rows=>rows.at(-1),lastOrEmpty:rows=>rows.at(-1)??"",rows:()=>[""],
  push:(rows,value)=>rows.push(value),pushEmpty:rows=>rows.push(""),
  append:(rows,value)=>{rows[rows.length-1]+=value;},appendSpace:rows=>{rows[rows.length-1]+=" ";},
  setLast:(rows,value)=>{rows[rows.length-1]=value;},multiple:rows=>rows.length>1,
  mergeLast:rows=>{rows[rows.length-2]+=rows.pop();},
  startsLink:(word,index)=>word.startsWith("]8;;",index+1),
  trim:text=>text.trim(),trimStart:text=>text.trimStart(),
  trimmedWords:(words,last)=>words.slice(0,last).join(" ")+words.slice(last).join(""),
  breaksHere:(width,remaining,columns)=>1+Math.floor((width-remaining-1)/columns),
  breaksNext:(width,columns)=>Math.floor((width-1)/columns),
  trimRows:rows=>rows.map(row=>invoke("trimRight",[row])),joinRows:rows=>rows.join("\n"),
  highSurrogate:character=>character>="\ud800"&&character<="\udbff",
  groups(text,index){groups.lastIndex=index+1;return groups.exec(text)?.groups;},
  groupCode:groups=>groups?.code,groupUri:groups=>groups?.uri,
  parseFloat:value=>Number.parseFloat(value),endCode:value=>value===39,
  closing:code=>native.designWrapAnsiClosingCode(code),
  ansi:code=>`\x1b[${code}m`,link:url=>`\x1b]8;;${url}\x07`,closeLink:()=>"\x1b]8;;\x07",
  invalidOperation(){throw new TypeError("Invalid ANSI wrap operation");}
});

export function wrapAnsi(string,columns,options) {
  return String(string).normalize().split(lines)
    .map(line=>invoke("line",[line,columns,options===undefined?{}:options])).join("\n");
}
