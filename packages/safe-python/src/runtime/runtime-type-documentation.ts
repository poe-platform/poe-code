import {PythonRuntimeError} from "./error.js";
import type {ExecutionMeter} from "./execution-budget.js";
import type {RuntimeValues, TypeValue} from "./runtime-values.js";

/** CPython internal-doc signature framing. The payload is already strict UTF-8
 * and NUL-terminated by the allocator. This is framing, not signature syntax
 * validation: malformed parameter lists remain visible to introspection. */
export function parseRuntimeTypeDocumentation(name: string, doc: string, meter: ExecutionMeter): {doc: string; signature?: string} {
  meter.checkpoint(name.length + 1, 32);
  const shortName = name.slice(name.lastIndexOf(".") + 1);
  if (!doc.startsWith(shortName + "(")) return {doc};
  for (let index = shortName.length; index < doc.length; index++) {
    meter.checkpoint();
    if (doc.startsWith(")\n--\n\n", index)) {
      meter.checkpoint(0, doc.length * 2);
      return {doc: doc.slice(index + 6), signature: doc.slice(shortName.length, index + 1)};
    }
    if (doc.startsWith("\n\n", index)) break;
  }
  return {doc};
}

/** Type documentation belongs to the exact type. Native documentation may
 * coexist with an instance __doc__ descriptor; heap documentation binds only
 * the own-namespace value, never inherited documentation. */
export function installRuntimeTypeDocumentation(owner: TypeValue, values: RuntimeValues, meter: ExecutionMeter): void {
  meter.checkpoint(1, 192);
  const key = values.internString("__doc__");
  owner.value.namespace.items.set(key, values.getsetDescriptor({owner, name: "__doc__", accepts: receiver => receiver.kind === "type",
    get(receiver, meter, context) {
      if (receiver.kind !== "type") throw Error("type documentation requires a type");
      const native = receiver.immutable ? receiver.value.nativeDocumentation : undefined;
      if (native !== undefined) return values.string(native.doc);
      const value = receiver.value.namespace.items.lookup(key)?.value;
      if (value === undefined) return values.none;
      if (context?.lookupSpecial === undefined) throw Error("type documentation requires descriptor lookup");
      const get = context.lookupSpecial(value, "__get__");
      meter.checkpoint();
      return get === undefined ? value : context.call(get, [values.none, receiver]);
    },
    set(receiver, value, meter) {
      if (receiver.kind !== "type") throw Error("type documentation requires a type");
      if (receiver.immutable) {
        meter.checkpoint(0, 128 + 2 * receiver.value.diagnosticName.length);
        throw new PythonRuntimeError("TypeError", `cannot set '__doc__' attribute of immutable type '${receiver.value.diagnosticName}'`);
      }
      receiver.value.namespace.items.set(key, value);
    },
    delete(receiver, meter) {
      if (receiver.kind !== "type") throw Error("type documentation requires a type");
      meter.checkpoint(0, 128 + 2 * receiver.value.diagnosticName.length);
      throw new PythonRuntimeError("TypeError", `cannot ${receiver.immutable ? "set" : "delete"} '__doc__' attribute of immutable type '${receiver.value.diagnosticName}'`);
    }
  }));
  owner.value.namespace.items.set(values.string("__text_signature__"), values.getsetDescriptor({owner, name: "__text_signature__", accepts: receiver => receiver.kind === "type",
    get(receiver, meter) {
      if (receiver.kind !== "type") throw Error("type signature requires a type");
      const internal = receiver.value.internalDocumentation;
      const signature = internal === undefined ? receiver.value.nativeDocumentation?.textSignature
        : parseRuntimeTypeDocumentation(receiver.value.diagnosticName, internal, meter).signature;
      return signature === undefined ? values.none : values.string(signature);
    }
  }));
}
