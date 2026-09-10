import type { ExpressionCall } from "./call-arguments.js";
import type { ExecutionMeter } from "./execution-budget.js";
import { PythonRuntimeError } from "./error.js";
import { runtimeExceptionMatches } from "./runtime-exception-matches.js";
import { OrderedKeyMap, type KeyOperations } from "./ordered-key-map.js";
import { runtimeDictionaryStorage } from "./runtime-dictionary-storage.js";
import { runtimeIterate } from "./runtime-iteration.js";
import { mergeRuntimeMappingProxy } from "./runtime-mapping-proxy.js";
import { hasRuntimeInstanceAttributes, type BuiltinInvocationContext, type DictionaryValue, type RuntimeValue, type RuntimeValues } from "./runtime-values.js";
import { diagnosticTypeName } from "./diagnostic-type-name.js";
import { isRuntimeMethodDecoratorSubclass } from "./runtime-method-decorator.js";
import type { IterationContext } from "./protocol-iterator.js";
import { mergeRuntimeMapping } from "./runtime-mapping-merge.js";
import { PythonKeyError } from "./runtime-dictionary-access.js";
import { representationObject } from "./representation-protocol.js";

export interface RuntimeCallContext {
  readonly values: RuntimeValues;
  readonly keys: KeyOperations<RuntimeValue>;
  readonly iteration?: IterationContext<RuntimeValue>;
  readonly invocation?: BuiltinInvocationContext;
  /** Error-only guest formatting, including the callable's trailing (). */
  name(callee: RuntimeValue): string;
  /** Diagnostic str fallback when no invocation formatting policy is supplied.
   * Duplicate keys can be arbitrary objects; this is not keyword validation. */
  keywordName(key: RuntimeValue): string;
  /** Guest call-slot presence, queried only after all expansion succeeds. */
  callable(callee: RuntimeValue): boolean;
  /** Execute after callability and caller-side keyword validation. Explicit
   * native capabilities may own name validation inside their invocation. Keyword
   * keys retain Python code points, including surrogate sequences: converting
   * them to host Map<string, ...> can collapse distinct Python strings.
   */
  invoke(callee: RuntimeValue, positional: readonly RuntimeValue[], keywords: DictionaryValue): RuntimeValue;
}

/** Per-expression collector. No callability checks or formatting during setup.
 * Exact dict keyword merges reject duplicates with cached hashes; non-string
 * validation waits until invocation (or an opted-in native callee's checks).
 * Custom mappings use explicit invocation/iteration capabilities. Full temporary
 * accounting and guest exception-object integration remain wider responsibilities.
 */
export function beginRuntimeCall(callee: RuntimeValue, context: RuntimeCallContext, meter: ExecutionMeter): ExpressionCall<RuntimeValue> {
  meter.checkpoint(1, 320);
  const positional: RuntimeValue[] = [];
  const keywords = context.values.dictionary(new OrderedKeyMap<RuntimeValue, RuntimeValue>(context.keys, meter, runtimeDictionaryStorage));
  const duplicate = (key: RuntimeValue): never => {
    const name = context.name(callee); meter.checkpoint();
    const formatting=context.invocation?.formatting;
    let keyword:string;
    if(formatting===undefined)keyword=context.keywordName(key);
    else {
      const represented=representationObject(key,"str",formatting,meter);
      keyword="";
      for(const point of formatting.string(represented)!){meter.checkpoint(1,point>0xffff?4:2);keyword+=String.fromCodePoint(point);}
    }
    meter.checkpoint();
    throw new PythonRuntimeError("TypeError", `${name} got multiple values for keyword argument '${keyword}'`);
  };
  // Merge catches must finish before diagnostic formatting runs guest code.
  const duplicateKey=(key:RuntimeValue):never=>{throw new PythonKeyError(key,meter);};
  return {
    positional(value) { meter.checkpoint(1, 8); positional.push(value); },
    starred(value, loneStar = false) {
      const iterator = runtimeIterate(value, context.values, meter, context.iteration, name => {
        const prefix = loneStar ? `${context.name(callee)} argument after` : "Value after";
        meter.checkpoint();
        throw new PythonRuntimeError("TypeError", `${prefix} * must be an iterable, not ${name}`);
      }, !loneStar);
      while (true) {
        meter.checkpoint(); const item = iterator.next(); meter.checkpoint();
        if (item.done) return;
        meter.checkpoint(0, 8); positional.push(item.value);
      }
    },
    keywords(entries) {
      const group = new OrderedKeyMap<RuntimeValue, RuntimeValue>(context.keys, meter);
      for (const [name, value] of entries) { meter.checkpoint(); group.set(context.values.string(name), value); }
      keywords.items.update(group, duplicate);
    },
    mapping(value) {
      meter.checkpoint();
      try {
        if (value.kind === "dict") keywords.items.update(value.items, duplicateKey);
        else if (value.kind === "mappingproxy") mergeRuntimeMappingProxy(keywords, value, meter, duplicateKey, { values: context.values, invocation: context.invocation });
        else mergeRuntimeMapping(keywords, value, context.values, meter, context.invocation, context.iteration, duplicateKey);
      } catch (error) {
        meter.checkpoint();
        if (runtimeExceptionMatches(error,"KeyError",context.invocation)) {
          const args=error instanceof PythonKeyError?error.args:context.invocation?.exceptionArguments?.(error);
          if(args?.length===1)duplicate(args[0]);
          throw error;
        }
        if (!runtimeExceptionMatches(error,"AttributeError",context.invocation)) throw error;
        const type = hasRuntimeInstanceAttributes(value) ? diagnosticTypeName(value.type.value.name, meter, 200)
          : value.kind === "none" ? "NoneType" : value.kind === "not-implemented" ? "NotImplementedType" : value.kind;
        const name = context.name(callee); meter.checkpoint();
        throw new PythonRuntimeError("TypeError", `${name} argument after ** must be a mapping, not ${type}`);
      }
    },
    invoke() {
      meter.checkpoint(1, 32);
      const callable = context.callable(callee); meter.checkpoint();
      if (!callable) {
        const name = hasRuntimeInstanceAttributes(callee) ? diagnosticTypeName(callee.type.value.name, meter, 200)
          : callee.kind === "none" ? "NoneType" : callee.kind === "not-implemented" ? "NotImplementedType" : callee.kind;
        throw new PythonRuntimeError("TypeError", `'${name}' object is not callable`);
      }
      if (callee.kind !== "instance" && !isRuntimeMethodDecoratorSubclass(callee) && callee.kind !== "classmethod_descriptor"
        && callee.kind !== "wrapper_descriptor" && callee.kind !== "method-wrapper"
        && (callee.kind !== "type" || (callee.immutable && callee.keywordValidation !== "callee"))
        && (callee.kind !== "builtin_function_or_method" || callee.value.keywordValidation !== "callee")) {
        const iterator = keywords.items.iterate(key => key);
        for (let item = iterator.next(); !item.done; item = iterator.next()) {
          meter.checkpoint();
          if (item.value.kind !== "str") throw new PythonRuntimeError("TypeError", "keywords must be strings");
        }
      }
      const result = context.invoke(callee, Object.freeze(positional), keywords);
      meter.checkpoint(); return result;
    }
  };
}
