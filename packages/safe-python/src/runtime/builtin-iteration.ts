import { CallableIterator, type CallableIterationContext } from "./callable-iterator.js";
import { PythonRuntimeError } from "./error.js";
import type { ExecutionMeter } from "./execution-budget.js";
import type { IterationContext } from "./protocol-iterator.js";
import { acquireRuntimeIterator } from "./runtime-iterator-acquisition.js";
import type { CompletionResult } from "./iterator-completion.js";
import type { BuiltinFunctionValue, RuntimeValue, RuntimeValues } from "./runtime-values.js";
import { runtimeCallable } from "./runtime-callability.js";
import { runtimeComparison } from "./runtime-comparison.js";

/** Register explicitly in the execution's builtin namespace. One-argument iter
 * uses exact runtime adapters or the supplied type-level guest protocol.
 * The sentinel form inherits invocation capabilities unless explicitly overridden. */
export function createIterBuiltin(values: RuntimeValues, meter: ExecutionMeter, context: Partial<CallableIterationContext<RuntimeValue>> = {}, explicitProtocol?: IterationContext<RuntimeValue>): BuiltinFunctionValue {
  meter.checkpoint(1, 64);
  return values.builtinFunction({
    name: "iter",
    invoke(positional, keywords, meter, invocation) {
      meter.checkpoint();
      if (keywords.items.size !== 0) throw new PythonRuntimeError("TypeError", "iter() takes no keyword arguments");
      if (positional.length < 1) throw new PythonRuntimeError("TypeError", "iter expected at least 1 argument, got 0");
      if (positional.length > 2) throw new PythonRuntimeError("TypeError", `iter expected at most 2 arguments, got ${positional.length}`);
      const source = positional[0];
      if (positional.length === 1) {
        const protocol = explicitProtocol ?? invocation?.iteration;
        return acquireRuntimeIterator(source,values,meter,protocol);
      }
      meter.checkpoint(0, 192);
      const callbacks: CallableIterationContext<RuntimeValue> = {
        isCallable(value) {
          if (context.isCallable !== undefined) return context.isCallable(value);
          if (invocation?.isCallable !== undefined) return invocation.isCallable(value);
          return runtimeCallable(value, meter);
        },
        call(value) {
          if (context.call !== undefined) return context.call(value);
          if (invocation !== undefined) { meter.checkpoint(0, 8); return invocation.call(value, []); }
          throw new Error("iter requires an execution call capability");
        },
        equal(left, right) {
          if (context.equal !== undefined) return context.equal(left, right);
          if (invocation?.compareTruth !== undefined) return invocation.compareTruth("==", left, right);
          return runtimeComparison("==", left, right, values, meter).value;
        },
        isStopIteration(error) {
          if (context.isStopIteration !== undefined) return context.isStopIteration(error);
          if (invocation !== undefined) return invocation.isStopIteration(error);
          return error instanceof PythonRuntimeError && error.name === "StopIteration";
        }
      };
      return values.iterator(new CallableIterator(source, positional[1], callbacks, meter));
    }
  });
}

/** Prepared iterators preserve raised exception payloads; a supplied default
 * handles StopIteration only. Optional guest slots preserve returned identity
 * and exception objects without converting through a host done record. */
export function createNextBuiltin(values: RuntimeValues, meter: ExecutionMeter, explicitProtocol?: Pick<IterationContext<RuntimeValue>, "hasNext" | "next" | "typeName" | "isStopIteration">): BuiltinFunctionValue {
  meter.checkpoint(1, 64);
  return values.builtinFunction({
    name: "next",
    invoke(positional, keywords, meter, invocation) {
      meter.checkpoint();
      if (keywords.items.size !== 0) throw new PythonRuntimeError("TypeError", "next() takes no keyword arguments");
      if (positional.length < 1) throw new PythonRuntimeError("TypeError", "next expected at least 1 argument, got 0");
      if (positional.length > 2) throw new PythonRuntimeError("TypeError", `next expected at most 2 arguments, got ${positional.length}`);
      const source = positional[0];
      const protocol = explicitProtocol ?? invocation?.iteration;
      if (source.kind !== "iterator") {
        const valid = protocol?.hasNext(source) ?? false; meter.checkpoint();
        if (!valid) {
          const type = protocol ? protocol.typeName(source) : source.kind === "none" ? "NoneType" : source.kind === "not-implemented" ? "NotImplementedType" : source.kind;
          meter.checkpoint(); throw new PythonRuntimeError("TypeError", `'${type}' object is not an iterator`);
        }
      }
      let step: CompletionResult<RuntimeValue> | undefined, result: RuntimeValue | undefined;
      try {
        if (source.kind !== "iterator") result = protocol!.next(source);
        else step = source.value.next();
      }
      catch (error) {
        meter.checkpoint();
        if (positional.length === 2) {
          const ended = (error instanceof PythonRuntimeError && error.name === "StopIteration") || (protocol?.isStopIteration(error) ?? false);
          meter.checkpoint(); if (ended) return positional[1];
        }
        throw error;
      }
      meter.checkpoint();
      if (source.kind !== "iterator") return result!;
      if (!step!.done) return step!.value;
      if (positional.length === 2) return positional[1];
      if (step!.done && step!.exception !== undefined) throw step!.exception.value;
      throw new PythonRuntimeError("StopIteration", "");
    }
  });
}
