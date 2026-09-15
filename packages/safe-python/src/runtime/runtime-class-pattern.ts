import type {Pattern} from "../pattern-ast.js";
import type {ExecutionMeter} from "./execution-budget.js";
import {evaluateExpression,type ExpressionContext} from "./expression-evaluation.js";
import {runtimeClassInstance} from "./runtime-class-instance.js";
import {runtimeExceptionMatches} from "./runtime-exception-matches.js";
import {PythonRuntimeError} from "./error.js";
import {representationObject} from "./representation-protocol.js";
import {createRuntimeFormatContext} from "./runtime-format.js";
import type {BuiltinInvocationContext,RuntimeValue,RuntimeValues} from "./runtime-values.js";

/** Class attributes are acquired eagerly before any child pattern comparison.
 * Missing attributes fail the match; other guest exceptions remain observable. */
export function prepareRuntimeClassPattern(pattern:Extract<Pattern,{kind:"class"}>,subject:RuntimeValue,
  expressions:ExpressionContext<RuntimeValue>,values:RuntimeValues,meter:ExecutionMeter,invocation?:BuiltinInvocationContext):Iterator<{pattern:Pattern;value:RuntimeValue}>|undefined {
  const type=evaluateExpression(pattern.class,expressions,meter);
  if(type.kind!=="type")throw new PythonRuntimeError("TypeError","called match pattern must be a class");
  if(!runtimeClassInstance(subject,type,expressions,meter,invocation))return undefined;
  meter.checkpoint(0,256);const children:Array<{pattern:Pattern;value:RuntimeValue}>=[],seen=new Set<string>();
  const optional=(object:RuntimeValue,name:string):RuntimeValue|undefined=>{
    try{return expressions.attribute(object,name);}
    catch(error){if(runtimeExceptionMatches(error,"AttributeError",invocation))return undefined;throw error;}
    finally{meter.checkpoint();}
  };
  const attribute=(name:string,child:Pattern):boolean=>{
    meter.checkpoint(1,40+name.length*2);
    if(seen.has(name)){
      const formatting=invocation?.formatting??createRuntimeFormatContext(values,meter,{defaultRepr(){throw Error("class attribute repr requires string protocols");}});
      const represented=representationObject(values.string(name),"repr",formatting,meter);let text="";
      for(const point of formatting.string(represented)!){meter.checkpoint(1,point>0xffff?4:2);text+=String.fromCodePoint(point);}
      throw new PythonRuntimeError("TypeError",`${type.value.name}() got multiple sub-patterns for attribute ${text}`);
    }
    seen.add(name);const value=optional(subject,name);if(value===undefined)return false;
    meter.checkpoint(0,48);children.push({pattern:child,value});return true;
  };
  if(pattern.positional.length){
    const args=optional(type,"__match_args__");
    if(args!==undefined&&args.kind!=="tuple")throw new PythonRuntimeError("TypeError",`${type.value.name}.__match_args__ must be a tuple (got ${invocation!.typeName!(args)})`);
    const self=args===undefined&&type.value.matchSelf;
    const allowed=self?1:args?.items.length??0;
    if(pattern.positional.length>allowed)throw new PythonRuntimeError("TypeError",`${type.value.name}() accepts ${allowed} positional sub-pattern${allowed===1?"":"s"} (${pattern.positional.length} given)`);
    for(let index=0;index<pattern.positional.length;index++){
      if(self){meter.checkpoint(0,48);children.push({pattern:pattern.positional[index],value:subject});continue;}
      const name=args!.items[index];meter.checkpoint();
      if(name.kind!=="str")throw new PythonRuntimeError("TypeError",`__match_args__ elements must be strings (got ${invocation!.typeName!(name)})`);
      let text="";for(const point of name.value){meter.checkpoint(1,point>0xffff?4:2);text+=String.fromCodePoint(point);}
      if(!attribute(text,pattern.positional[index]))return undefined;
    }
  }
  for(const keyword of pattern.keywords)if(!attribute(keyword.name.name,keyword.pattern))return undefined;
  meter.checkpoint(0,64);return children[Symbol.iterator]();
}
