import {constantRepeat} from "./constant-repeat.js";
import type {ExecutionMeter} from "./execution-budget.js";
import {runtimeBytesPayload} from "./runtime-bytes-payload.js";
import type {RuntimeValue,RuntimeValues} from "./runtime-values.js";

/** Empty concatenation may retain an exact operand, including when its partner
 * is a subtype. All other concatenations allocate an exact bytes result. */
export function runtimeBytesConcat(left:RuntimeValue,right:RuntimeValue,values:RuntimeValues,meter:ExecutionMeter):RuntimeValue {
  const a=runtimeBytesPayload(left),b=runtimeBytesPayload(right);meter.checkpoint();
  if(a===undefined||b===undefined)return values.notImplemented;
  if(a.value.length===0&&right.kind==="bytes")return right;
  if(b.value.length===0&&left.kind==="bytes")return left;
  const result=a.value.concat(b.value,meter);
  return values.bytes(result,result.length===0?"canonical":"fresh");
}

/** Unlike a bytes copy, subtype repetition always allocates, even for an empty
 * result or a count of one. Overflow validation precedes identity shortcuts. */
export function runtimeBytesRepeat(source:RuntimeValue,count:bigint,values:RuntimeValues,meter:ExecutionMeter):RuntimeValue {
  const payload=runtimeBytesPayload(source);meter.checkpoint();
  if(payload===undefined)throw Error("bytes repetition requires native storage");
  const result=constantRepeat(payload,values.integer(count),values,meter);
  return source.kind==="instance"&&result===payload?values.bytes(payload.value,"fresh"):result;
}
