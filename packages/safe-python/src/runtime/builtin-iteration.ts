import { CallableIterator, type CallableIterationContext } from "./callable-iterator.js";
import { PythonRuntimeError } from "./error.js";
import type { ExecutionMeter } from "./execution-budget.js";
import { runtimeIterate } from "./runtime-iteration.js";
import { resolveIteration, type IterationContext } from "./protocol-iterator.js";
import { SequenceIterator } from "./sequence-iterator.js";
import type { BuiltinFunctionValue, RuntimeValue, RuntimeValues } from "./runtime-values.js";

/** Register explicitly in the execution's builtin namespace. One-argument iter
 * uses exact runtime adapters or the supplied type-level guest protocol.
 * The sentinel form delegates guest call/equality through an explicit capability. */
export function createIterBuiltin(values: RuntimeValues, meter: ExecutionMeter, context: CallableIterationContext<RuntimeValue>, protocol?: IterationContext<RuntimeValue>): BuiltinFunctionValue {
  meter.checkpoint(1, 64);
  return values.builtinFunction({
    name: "iter",
    invoke(positional, keywords, meter) {
      meter.checkpoint();
      if (keywords.items.size !== 0) throw new PythonRuntimeError("TypeError", "iter() takes no keyword arguments");
      if (positional.length < 1) throw new PythonRuntimeError("TypeError", "iter expected at least 1 argument, got 0");
      if (positional.length > 2) throw new PythonRuntimeError("TypeError", `iter expected at most 2 arguments, got ${positional.length}`);
      const source = positional[0];
      if (positional.length === 1) {
        switch (source.kind) {
          case "iterator": return source;
          case "list": case "tuple": case "str": case "bytes": case "range":
          case "dict": case "mappingproxy": case "dict_keys": case "dict_values":
          case "dict_items": case "set": case "frozenset":
            return values.iterator(runtimeIterate(source, values, meter));
        }
        if (protocol === undefined) return values.iterator(runtimeIterate(source, values, meter));
        const resolved = resolveIteration(source, protocol, meter);
        return resolved.sequence ? values.iterator(new SequenceIterator(resolved.value, protocol, meter)) : resolved.value;
      }
      return values.iterator(new CallableIterator(source, positional[1], context, meter));
    }
  });
}

/** Prepared iterators preserve raised exception payloads; a supplied default
 * handles StopIteration only. Optional guest slots preserve returned identity
 * and exception objects without converting through a host done record. */
export function createNextBuiltin(values: RuntimeValues, meter: ExecutionMeter, protocol?: Pick<IterationContext<RuntimeValue>, "hasNext" | "next" | "typeName" | "isStopIteration">): BuiltinFunctionValue {
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
        const valid = protocol?.hasNext(source) ?? false; meter.checkpoint();
        if (!valid) {
          const type = protocol ? protocol.typeName(source) : source.kind === "none" ? "NoneType" : source.kind === "not-implemented" ? "NotImplementedType" : source.kind;
          meter.checkpoint(); throw new PythonRuntimeError("TypeError", `'${type}' object is not an iterator`);
        }
      }
      let step: IteratorResult<RuntimeValue> | undefined, result: RuntimeValue | undefined;
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
      throw new PythonRuntimeError("StopIteration", "");
    }
  });
}
