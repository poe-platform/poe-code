import type {Pattern} from "../pattern-ast.js";
import type {ExecutionMeter} from "./execution-budget.js";
import {evaluateExpression,type ExpressionContext} from "./expression-evaluation.js";
import {runtimePatternKind} from "./runtime-pattern-kind.js";
import {runtimeLength} from "./runtime-length.js";
import {runtimeSetAccess} from "./runtime-set.js";
import {runtimeDictionaryAccess} from "./runtime-dictionary-access.js";
import {representationObject} from "./representation-protocol.js";
import {createRuntimeFormatContext} from "./runtime-format.js";
import {PythonRuntimeError} from "./error.js";
import type {BuiltinInvocationContext,RuntimeValue,RuntimeValues} from "./runtime-values.js";

/** Acquire all keyed values before matching subpatterns. get() is bound once,
 * uses a fresh plain-object sentinel and never invokes __missing__. Rest copies
 * are delayed until keyed subpatterns succeed, and delete the actual match keys
 * through ordinary dict protocols. No iteration/attribute duck typing grants
 * mapping eligibility. ABC registration belongs to the future module layer. */
export function prepareRuntimeMappingPattern(pattern:Extract<Pattern,{kind:"mapping"}>,subject:RuntimeValue,
  expressions:ExpressionContext<RuntimeValue>,values:RuntimeValues,meter:ExecutionMeter,invocation?:BuiltinInvocationContext):Iterator<{pattern:Pattern;value:RuntimeValue}>|undefined {
  if(runtimePatternKind(subject,meter,invocation)!=="mapping")return undefined;
  if(pattern.entries.length&&BigInt(runtimeLength(subject,meter,undefined,invocation))<BigInt(pattern.entries.length))return undefined;
  meter.checkpoint(0,256);const keys:RuntimeValue[]=[],found:RuntimeValue[]=[];
  for(const entry of pattern.entries){meter.checkpoint(1,8);keys.push(evaluateExpression(entry.key,expressions,meter));}
  if(keys.length){
    const get=subject.kind==="dict"?undefined:expressions.attribute(subject,"get");meter.checkpoint();
    const seen=expressions.beginSet([]).finish();if(seen.kind!=="set")throw Error("mapping pattern requires native set storage");
    let missing:RuntimeValue|undefined;
    if(get!==undefined){
      if(invocation?.objectType===undefined)throw Error("mapping get sentinels require the canonical object type");
      missing=values.instance(invocation.objectType);
    }
    for(const key of keys){
      meter.checkpoint();
      if(runtimeSetAccess(seen,key,"contains-exact",values,meter,invocation)){
        const formatting=invocation?.formatting??createRuntimeFormatContext(values,meter,{defaultRepr(){throw Error("mapping key repr requires object protocols");}});
        const represented=representationObject(key,"repr",formatting,meter);let text="";
        for(const point of formatting.string(represented)!){meter.checkpoint(1,point>0xffff?4:2);text+=String.fromCodePoint(point);}
        throw new PythonRuntimeError("ValueError",`mapping pattern checks duplicate key (${text})`);
      }
      runtimeSetAccess(seen,key,"add",values,meter,invocation);
      let value:RuntimeValue;
      if(subject.kind==="dict"){
        const entry=runtimeDictionaryAccess(subject,key,"lookup",meter);if(entry===undefined)return undefined;value=entry.value;
      }else{
        const call=expressions.beginCall(get!);call.positional(key);call.positional(missing!);value=call.invoke();meter.checkpoint();
        if(value===missing)return undefined;
      }
      meter.checkpoint(0,8);found.push(value);
    }
  }
  function* items():Generator<{pattern:Pattern;value:RuntimeValue}> {
    for(let index=0;index<pattern.entries.length;index++){
      meter.checkpoint(1,40);yield {pattern:pattern.entries[index].pattern,value:found[index]};
    }
    if(pattern.rest!==null){
      const copy=expressions.beginDictionary([]);copy.update(subject);const rest=copy.finish();
      if(rest.kind!=="dict")throw Error("mapping rest requires native dict storage");
      for(const key of keys){meter.checkpoint();runtimeDictionaryAccess(rest,key,{kind:"delete"},meter);}
      meter.checkpoint(0,104);yield {pattern:{kind:"capture",name:pattern.rest,start:pattern.rest.start,end:pattern.rest.end},value:rest};
    }
  }
  meter.checkpoint(0,192);return items();
}
