import type {Pattern} from "../pattern-ast.js";
import type {UnpackedAssignment} from "./assignment-unpacking.js";
import type {ExecutionMeter} from "./execution-budget.js";
import {runtimeLength} from "./runtime-length.js";
import {runtimeGetItem} from "./runtime-subscription.js";
import type {BuiltinInvocationContext,RuntimeValue,RuntimeValues} from "./runtime-values.js";

/** Type classification precedes all guest protocols. Slot duck typing must not
 * make strings, mappings or arbitrary iterables sequence-pattern candidates.
 * Native type metadata also permits explicitly supplied host sequence types;
 * collections.abc registration remains part of the unfinished module layer.
 */
export function prepareRuntimeSequencePattern(pattern:Extract<Pattern,{kind:"sequence"}>,subject:RuntimeValue,
  unpack:(value:RuntimeValue,before:number,after:number|null)=>UnpackedAssignment<RuntimeValue>,
  values:RuntimeValues,meter:ExecutionMeter,invocation?:BuiltinInvocationContext):Iterator<{pattern:Pattern;value:RuntimeValue}>|undefined {
  meter.checkpoint();let eligible=subject.kind==="list"||subject.kind==="tuple"||subject.kind==="range";
  if(!eligible){
    const type=subject.kind==="instance"?subject.type:invocation?.actualType?.(subject);meter.checkpoint();
    for(const base of type?.value.mro??[]){
      meter.checkpoint();if(base.patternKind!==undefined){eligible=base.patternKind==="sequence";break;}
    }
  }
  if(!eligible)return undefined;
  let star=-1,allWild=true;
  for(let index=0;index<pattern.items.length;index++){
    meter.checkpoint();const item=pattern.items[index];
    if(item.kind==="star")star=index;
    if((item.kind!=="capture"&&item.kind!=="star")||item.name!==null)allWild=false;
  }
  const required=pattern.items.length-(star>=0?1:0);
  if(star<0||required!==0){
    const length=BigInt(runtimeLength(subject,meter,undefined,invocation));meter.checkpoint();
    if(star<0?length!==BigInt(required):length<BigInt(required))return undefined;
  }
  meter.checkpoint(0,192);
  function* items():Generator<{pattern:Pattern;value:RuntimeValue}> {
    if(allWild)return;
    const starNode=star<0?undefined:pattern.items[star];
    if(starNode?.kind==="star"&&starNode.name===null){
      for(let index=0;index<pattern.items.length;index++){
        meter.checkpoint();const item=pattern.items[index];
        if(item.kind==="star"||item.kind==="capture"&&item.name===null)continue;
        const offset=index<star?BigInt(index):BigInt(runtimeLength(subject,meter,undefined,invocation))-BigInt(pattern.items.length-index);
        meter.checkpoint();const value=runtimeGetItem(subject,values.integer(offset),values,meter,invocation);
        meter.checkpoint(1,40);yield {pattern:item,value};
      }
      return;
    }
    const parts=unpack(subject,star<0?pattern.items.length:star,star<0?null:pattern.items.length-star-1);
    meter.checkpoint();
    for(let index=0;index<pattern.items.length;index++){
      meter.checkpoint();const item=pattern.items[index];
      if(item.kind==="capture"&&item.name===null)continue;
      const value=star<0||index<star?parts.leading[index]:index===star?values.list(parts.starred!):parts.trailing[index-star-1];
      meter.checkpoint(0,40);yield {pattern:item,value};
    }
  }
  return items();
}
