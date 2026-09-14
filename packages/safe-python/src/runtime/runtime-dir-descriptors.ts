import { diagnosticTypeName } from "./diagnostic-type-name.js";
import { PythonRuntimeError } from "./error.js";
import type { ExecutionMeter } from "./execution-budget.js";
import { OrderedKeyMap, type KeyOperations } from "./ordered-key-map.js";
import { runtimeDictionaryCopySource } from "./runtime-dictionary-copy-source.js";
import { runtimeDictionaryPayload } from "./runtime-dictionary-payload.js";
import { runtimeDictionaryStorage } from "./runtime-dictionary-storage.js";
import { runtimeExceptionMatches } from "./runtime-exception-matches.js";
import { runtimeLength } from "./runtime-length.js";
import { mergeRuntimeMapping } from "./runtime-mapping-merge.js";
import { mergeRuntimeMappingProxy } from "./runtime-mapping-proxy.js";
import { runtimeGetItem } from "./runtime-subscription.js";
import type { RuntimeValue, RuntimeValues, TypeValue } from "./runtime-values.js";

/** Explicit base descriptors perform ordinary __dict__/__class__/__bases__
 * lookup, including overrides. They return insertion-ordered keys, unsorted.
 * Only dir() sorts. An explicit traversal stack retains base callback order. */
export function installRuntimeDirDescriptors(object: TypeValue, type: TypeValue, values: RuntimeValues, keys: KeyOperations<RuntimeValue>, meter: ExecutionMeter): void {
  for (const owner of [object, type]) {
    meter.checkpoint(1, 96);
    owner.value.namespace.items.set(values.string("__dir__"), values.methodDescriptor({
      owner, name: "__dir__", doc: owner === type ? "Specialized __dir__ implementation for types." : "Default dir() implementation.", textSignature: "($self, /)",
      accepts: receiver => owner === object || receiver.kind === "type",
      invoke(receiver, args, kwargs, meter, invocation) {
        meter.checkpoint();
        if (kwargs.items.size) throw new PythonRuntimeError("TypeError", `${owner.value.name}.__dir__() takes no keyword arguments`);
        if (args.length) throw new PythonRuntimeError("TypeError", `${owner.value.name}.__dir__() takes no arguments (${args.length} given)`);
        if (!invocation?.attribute) throw Error("directory descriptors require interpreter attribute capabilities");
        const optional = (value: RuntimeValue, name: string): RuntimeValue | undefined => {
          try { return invocation.attribute!(value, name); }
          catch (error) { if (!runtimeExceptionMatches(error, "AttributeError", invocation)) throw error; }
          finally { meter.checkpoint(); }
        };
        const dictionary = values.dictionary(new OrderedKeyMap<RuntimeValue, RuntimeValue>(keys, meter, runtimeDictionaryStorage));
        const merge = (source: RuntimeValue): void => {
          const native = runtimeDictionaryCopySource(source, values, meter, invocation);
          if (native !== undefined) dictionary.items.update(native.items);
          else if (source.kind === "mappingproxy") mergeRuntimeMappingProxy(dictionary, source, meter, undefined, { values, invocation });
          else mergeRuntimeMapping(dictionary, source, values, meter, invocation, invocation.iteration);
          meter.checkpoint();
        };
        let root: RuntimeValue | undefined = receiver;
        if (owner === object) {
          const own = optional(receiver, "__dict__");
          if (own !== undefined && runtimeDictionaryPayload(own) !== undefined) merge(own);
          root = optional(receiver, "__class__");
        }
        const stack: { bases: RuntimeValue; length: bigint; index: bigint }[] = [];
        while (root !== undefined || stack.length) {
          meter.checkpoint();
          if (root !== undefined) {
            const own = optional(root, "__dict__");
            if (own !== undefined) merge(own);
            const bases = optional(root, "__bases__");
            if (bases !== undefined) {
              // PySequence_Size excludes a mapping-only native length slot.
              if (bases.kind === "dict" || bases.kind === "mappingproxy") throw new PythonRuntimeError("TypeError", `${bases.kind} is not a sequence`);
              const length = BigInt(runtimeLength(bases, meter, undefined, invocation));
              meter.checkpoint(1, 48);
              stack.push({ bases, length, index: 0n });
            }
            root = undefined;
          }
          while (stack.length) {
            meter.checkpoint();
            const next = stack[stack.length - 1];
            if (next.index === next.length) { stack.pop(); continue; }
            const bases = next.bases;
            const native = bases.kind === "list" || bases.kind === "tuple" || bases.kind === "str" || bases.kind === "bytes" || bases.kind === "range";
            if (!native && !invocation.iteration?.hasSequenceItem(bases)) throw new PythonRuntimeError("TypeError", `'${diagnosticTypeName(invocation.typeName!(bases), meter)}' object does not support indexing`);
            root = runtimeGetItem(bases, values.integer(next.index++), values, meter, invocation);
            break;
          }
        }
        const result = values.list([]);
        for (const [key] of dictionary.items.snapshot()) { meter.checkpoint(); result.items.append(key); }
        return result;
      }
    }));
  }
}
