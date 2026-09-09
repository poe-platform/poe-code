import { CallableIterator, type CallableIterationContext } from "./callable-iterator.js";
import { PythonRuntimeError } from "./error.js";
import type { ExecutionMeter } from "./execution-budget.js";
import { runtimeIterate } from "./runtime-iteration.js";
import type { BuiltinFunctionValue, RuntimeValue, RuntimeValues } from "./runtime-values.js";

/** Register explicitly in the execution's builtin namespace. One-argument iter
 * uses exact runtime adapters; guest __iter__/indexed fallback remain separate.
 * The sentinel form delegates guest call/equality through an explicit capability. */
export function createIterBuiltin(values: RuntimeValues, meter: ExecutionMeter, context: CallableIterationContext<RuntimeValue>): BuiltinFunctionValue {
  meter.checkpoint(1, 64);
  return values.builtinFunction({
    name: "iter",
    invoke(positional, keywords, meter) {
      meter.checkpoint();
      if (keywords.items.size !== 0) throw new PythonRuntimeError("TypeError", "iter() takes no keyword arguments");
      if (positional.length < 1) throw new PythonRuntimeError("TypeError", "iter expected at least 1 argument, got 0");
      if (positional.length > 2) throw new PythonRuntimeError("TypeError", `iter expected at most 2 arguments, got ${positional.length}`);
      const source = positional[0];
      if (positional.length === 1) return source.kind === "iterator" ? source : values.iterator(runtimeIterate(source, values, meter));
      return values.iterator(new CallableIterator(source, positional[1], context, meter));
    }
  });
}

/** Prepared iterators preserve raised exception payloads; a supplied default
 * handles StopIteration only. Guest __next__ slots and exception objects remain
 * external to this exact-value binding. */
export function createNextBuiltin(values: RuntimeValues, meter: ExecutionMeter): BuiltinFunctionValue {
  meter.checkpoint(1, 64);
  return values.builtinFunction({
    name: "next",
    invoke(positional, keywords, meter) {
      meter.checkpoint();
      if (keywords.items.size !== 0) throw new PythonRuntimeError("TypeError", "next() takes no keyword arguments");
      if (positional.length < 1) throw new PythonRuntimeError("TypeError", "next expected at least 1 argument, got 0");
      if (positional.length > 2) throw new PythonRuntimeError("TypeError", `next expected at most 2 arguments, got ${positional.length}`);
      const source = positional[0];
      if (source.kind !== "iterator") {
        const type = source.kind === "none" ? "NoneType" : source.kind === "not-implemented" ? "NotImplementedType" : source.kind;
        throw new PythonRuntimeError("TypeError", `'${type}' object is not an iterator`);
      }
      let step: IteratorResult<RuntimeValue>;
      try { step = source.value.next(); }
      catch (error) {
        meter.checkpoint();
        if (positional.length === 2 && error instanceof PythonRuntimeError && error.name === "StopIteration") return positional[1];
        throw error;
      }
      meter.checkpoint();
      if (!step.done) return step.value;
      if (positional.length === 2) return positional[1];
      throw new PythonRuntimeError("StopIteration", "");
    }
  });
}
