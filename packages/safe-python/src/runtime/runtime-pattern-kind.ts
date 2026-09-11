import type {BuiltinInvocationContext,RuntimeValue} from "./runtime-values.js";
import type {ExecutionMeter} from "./execution-budget.js";

/** Pattern flags use actual native types/MRO metadata, never guest protocols,
 * textual class names or an overridable __class__ attribute. */
export function runtimePatternKind(value:RuntimeValue,meter:ExecutionMeter,invocation?:BuiltinInvocationContext):"sequence"|"mapping"|undefined {
  meter.checkpoint();
  if(value.kind==="list"||value.kind==="tuple"||value.kind==="range")return "sequence";
  if(value.kind==="dict"||value.kind==="mappingproxy")return "mapping";
  const type=value.kind==="instance"?value.type:invocation?.actualType?.(value);meter.checkpoint();
  for(const base of type?.value.mro??[]){meter.checkpoint();if(base.patternKind!==undefined)return base.patternKind;}
  return undefined;
}
