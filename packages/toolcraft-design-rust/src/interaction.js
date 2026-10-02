import {createRequire} from "node:module";
import {createComponentPolicy} from "./component-host.js";
const native=createRequire(import.meta.url)("./toolcraft-design-rust.node");
export const invokeInteraction=createComponentPolicy(native.designInteractionPolicy,{
  idHas:(ids,command)=>!!ids.has(command.id),idAdd:(ids,command)=>ids.add(command.id),
  duplicateId(command){throw new Error(`Duplicate command: ${command.id}`);},
  duplicateKey(key){throw new Error(`Duplicate binding: ${key}`);},
  bindKeys(bindings,command){for(const key of command.keys)invokeInteraction("bind",[bindings,key,command]);},
  has:(map,key)=>!!map.has(key),set:(map,key,value)=>map.set(key,value),mapGet:(map,key)=>map.get(key),
  enabled:command=>command.enabled?.(),registryEnabled:command=>invokeInteraction("enabled",[command]),
  run:command=>command.run(),isFalse:value=>value===false,
  truthy:value=>!!value,nullish:value=>value==null,notUndefined:value=>value!==undefined,
  false:()=>false,true:()=>true,undefined:()=>undefined,zero:()=>0,
  controller:()=>new AbortController(),
  pushOverlay:(stack,focus,controller)=>stack.push({focus,controller}),
  pop:stack=>stack.pop(),abortOptional:overlay=>overlay?.controller.abort(),
  lastFocus:stack=>stack.at(-1)?.focus,popAbort:stack=>stack.pop().controller.abort(),
  integer:value=>!!Number.isInteger(value),belowOne:value=>value<1,
  invalidCapacity(){throw new RangeError("capacity must be a positive integer");},
  appendItem:(live,item)=>live.set(item.id,item),evict:live=>live.delete(live.keys().next().value),
  unseenIncrement:state=>{state.unseen++;},
  advancePosition:(state,delta)=>{state.position=Math.max(0,state.position+Math.trunc(delta));},
  hold:state=>{state.held=Array.from(state.live.values());},
  clearHeld:state=>{state.held=undefined;state.unseen=0;},
  liveItems:state=>Array.from(state.live.values()),
  follow:state=>{state.position=0;state.held=undefined;state.unseen=0;},
  normalize:value=>Math.max(0,Math.floor(value)),array:()=>[],
  decrement:value=>value-1,increment:value=>value+1,
  ge:(a,b)=>a>=b,gt:(a,b)=>a>b,lt:(a,b)=>a<b,same:(a,b)=>a===b,
  renderRows:(renderRows,items,index)=>renderRows(items[index]),at:(rows,index)=>rows[index],
  push:(rows,value)=>rows.push(value),shift:rows=>rows.shift(),reverse:rows=>rows.reverse(),
  selection:(rows,offset)=>({rows,offset}),tailOffset:(offset,visited,height)=>Math.min(offset,Math.max(0,visited-height)),
  invalidOperation(){throw new TypeError("Invalid interaction operation");}
});
