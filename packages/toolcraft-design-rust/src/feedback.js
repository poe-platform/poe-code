import {createRequire} from "node:module";
import {createComponentPolicy} from "./component-host.js";
import {plainTerminalText} from "./terminal.js";
import {fitToWidth} from "./explorer-text.js";
import {limitOutputPreview} from "./output-preview.js";
const native=createRequire(import.meta.url)("./toolcraft-design-rust.node");
export const invokeFeedback=createComponentPolicy(native.designFeedbackPolicy,{
  integer:value=>!!Number.isInteger(value),lt:(a,b)=>a<b,gt:(a,b)=>a>b,le:(a,b)=>a<=b,same:(a,b)=>a===b,
  undefined:()=>undefined,null:()=>null,isNull:value=>value===null,nullish:value=>value==null,truthy:value=>!!value,
  invalidCapacity(){throw new RangeError("positive capacity required");},
  plain:plainTerminalText,fit:fitToWidth,
  noticeMarker:(notice,info,success,warning,error)=>({info,success,warning,error})[notice.level],
  markerText:marker=>`${marker}`,
  noticeText:(marker,text)=>`${marker} ${text}`,progressText:(marker,label,progress)=>`${marker} ${label} ${progress}`,
  finiteTotal:item=>!!Number.isFinite(item.total),finiteCompleted:item=>!!Number.isFinite(item.completed),finite:value=>!!Number.isFinite(value),
  percentage:item=>`${Math.round(Math.max(0,Math.min(1,item.completed/item.total))*100)}%`,
  publishNotice:(notices,id,notice,now,durationMs)=>notices.set(id,{notice:{...notice,text:limitOutputPreview(notice.text)},expires:now()+Math.max(0,durationMs)}),
  evict:notices=>notices.delete(notices.keys().next().value),clock:now=>now(),delete:(notices,id)=>notices.delete(id),
  expireEntries(notices,time){for(const [id,entry] of notices)invokeFeedback("expire",[notices,id,entry,time]);},
  noticeSnapshots:notices=>Array.from(notices.values(),entry=>({...entry.notice})),
  setIndex:(values,cursor,value)=>{values[cursor]=value;},
  metricAdvance:(state,capacity)=>{state.cursor=(state.cursor+1)%capacity;state.count=Math.min(state.count+1,capacity);},
  metricRenderSamples:(state,capacity,width)=>Array.from({length:Math.min(state.count,Math.max(0,width))},(_,i)=>state.values[(state.cursor-Math.min(state.count,Math.max(0,width))+i+capacity)%capacity]),
  knownSamples:(samples,missing)=>samples.filter(value=>value!==missing),min:known=>Math.min(...known),max:known=>Math.max(...known),
  sparkMap:(samples,min,max)=>samples.map(value=>invokeFeedback("spark",[value,min,max])),join:spark=>spark.join(""),
  sparkIndex:(value,min,max)=>Math.round((value-min)/(max-min)*7),at:(levels,index)=>levels[index],
  metricLatest:(state,capacity)=>state.values[(state.cursor-1+capacity)%capacity],metricText:(latest,unit,spark)=>`${latest} ${unit} ${spark}`,
  invalidOperation(){throw new TypeError("Invalid feedback operation");}
});
