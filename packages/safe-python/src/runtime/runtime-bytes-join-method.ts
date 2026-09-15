import { PythonRuntimeError } from "./error.js";
import type { ExecutionMeter } from "./execution-budget.js";
import type { ImmutableBytes } from "./immutable-bytes.js";
import { collectIterator } from "./iterator-collection.js";
import { runtimeSequenceIterator } from "./runtime-sequence-iterator.js";
import type { ExpressionContext } from "./expression-evaluation.js";
import type { RuntimeBufferContext, RuntimeBufferLease } from "./runtime-buffer-context.js";
import { diagnosticTypeName } from "./diagnostic-type-name.js";
import { ListStorage } from "./list-storage.js";
import { runtimeExceptionMatches } from "./runtime-exception-matches.js";
import type { BuiltinFunctionValue, RuntimeValue, RuntimeValues } from "./runtime-values.js";

/** Consume generic iterables before member validation; an iterator failure
 * takes precedence over an invalid element already collected. */
export function createRuntimeBytesJoinMethod(receiver: Extract<RuntimeValue, { kind: "bytes" }>, values: RuntimeValues, meter: ExecutionMeter, iterate?: ExpressionContext<RuntimeValue>["iterate"], buffers?: RuntimeBufferContext): BuiltinFunctionValue {
  meter.checkpoint(1, 64);
  return values.builtinFunction({
    name: "join",
    invoke(positional, keywords, meter, invocation) {
      meter.checkpoint();
      if (keywords.items.size !== 0) throw new PythonRuntimeError("TypeError", "bytes.join() takes no keyword arguments");
      if (positional.length !== 1) throw new PythonRuntimeError("TypeError", `bytes.join() takes exactly one argument (${positional.length} given)`);
      const source = positional[0];
      let items: readonly RuntimeValue[] | ListStorage<RuntimeValue>;
      if (source.kind === "tuple") items = source.items;
      else if (source.kind === "list") items = source.items;
      else {
        const iterator = runtimeSequenceIterator(source, values, meter, "can only join an iterable", iterate, invocation);
        items = collectIterator(iterator, meter);
      }
      const length = items.length;
      if (length === 0) return values.bytes(new Uint8Array());
      const first = items instanceof ListStorage ? items.get(0n) : items[0];
      if (length === 1 && first.kind === "bytes") return first;
      meter.checkpoint(1, 64 + 16 * length);
      const parts: ImmutableBytes[] = new Array(length);
      const leases: (RuntimeBufferLease | undefined)[] = new Array(length);
      try {
        for (let index = 0; index < length; index++) {
          meter.checkpoint(); const item = items instanceof ListStorage ? items.get(BigInt(index)) : items[index];
          if (item.kind === "bytes") { parts[index] = item.value; continue; }
          try { leases[index] = buffers?.acquireSimple(item); }
          catch (error) {
            meter.checkpoint();
            if (!(error instanceof PythonRuntimeError) && !runtimeExceptionMatches(error, "BaseException", invocation)) throw error;
          }
          meter.checkpoint();
          if (leases[index] === undefined) {
            const nativeType = item.kind === "none" ? "NoneType" : item.kind === "not-implemented" ? "NotImplementedType" : item.kind;
            const type = buffers?.typeName === undefined ? nativeType : diagnosticTypeName(buffers.typeName(item), meter);
            throw new PythonRuntimeError("TypeError", `sequence item ${index}: expected a bytes-like object, ${type} found`);
          }
          if (items.length !== length) throw new PythonRuntimeError("RuntimeError", "sequence changed size during iteration");
        }
        // Later acquisitions can mutate earlier exports. Copy only after all
        // member validation and acquisition succeeds; copies run no guest code.
        for (let index = 0; index < leases.length; index++) {
          meter.checkpoint();
          if (leases[index] !== undefined) parts[index] = leases[index]!.copy();
          meter.checkpoint();
        }
        const result = receiver.value.join(parts, meter);
        return values.bytes(result, result.length === 0 ? "canonical" : "fresh");
      } finally {
        // Cleanup cannot checkpoint between releases: cancellation must not
        // leave later exports pinned. Providers guarantee non-throwing release.
        for (const lease of leases) lease?.release();
        meter.checkpoint();
      }
    }
  });
}
