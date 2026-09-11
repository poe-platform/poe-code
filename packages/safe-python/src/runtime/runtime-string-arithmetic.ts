import {constantConcat} from "./constant-concat.js";
import {constantRepeat} from "./constant-repeat.js";
import type {ExecutionMeter} from "./execution-budget.js";
import {runtimeStringPayload} from "./runtime-string-payload.js";
import type {RuntimeValue,RuntimeValues} from "./runtime-values.js";

/** String concatenation identity shortcuts require both operands to be exact.
 * Any subtype operand produces an exact result, never its backing wrapper. */
export function runtimeStringConcat(left:RuntimeValue,right:RuntimeValue,values:RuntimeValues,meter:ExecutionMeter):RuntimeValue {
  meter.checkpoint();
  const a=runtimeStringPayload(left),b=runtimeStringPayload(right);
  if(a===undefined||b===undefined)return values.notImplemented;
  if(left.kind==="str"&&right.kind==="str")return constantConcat(left,right,values,meter);
  return values.stringPoints(a.value.concat(b.value,meter));
}

/** Count validation precedes empty and one-copy shortcuts in the shared kernel.
 * A subtype's nonempty one-copy result must be a fresh exact string. */
export function runtimeStringRepeat(source:RuntimeValue,count:bigint,values:RuntimeValues,meter:ExecutionMeter):RuntimeValue {
  meter.checkpoint();
  const payload=runtimeStringPayload(source);
  if(payload===undefined)throw Error("string repetition requires string storage");
  const result=constantRepeat(payload,values.integer(count),values,meter);
  return source.kind==="instance"&&result===payload&&payload.value.length!==0?values.stringPoints(payload.value):result;
}
