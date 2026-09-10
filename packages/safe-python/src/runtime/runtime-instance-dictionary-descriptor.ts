import { PythonRuntimeError } from "./error.js";
import type { ExecutionMeter } from "./execution-budget.js";
import { runtimeDictionaryPayload } from "./runtime-dictionary-payload.js";
import { diagnosticTypeName } from "./diagnostic-type-name.js";
import { hasRuntimeInstanceAttributes, type GetsetDescriptorValue, type RuntimeValues, type TypeValue } from "./runtime-values.js";

/** A heap class's dictionary getset, inherited through normal descriptor lookup.
 * The allocator decides whether storage is newly introduced and unshadowed. */
export function createInstanceDictionaryDescriptor(owner: TypeValue, values: RuntimeValues, meter: ExecutionMeter, options: {doc?:string;deleteError?:string}={doc:"dictionary for instance variables"}): GetsetDescriptorValue {
  meter.checkpoint(1, 96);
  return values.getsetDescriptor({
    owner, name: "__dict__", doc: options.doc,
    accepts(instance, meter) {
      if (instance.kind !== "instance") return false;
      for (const ancestor of instance.type.value.mro) { meter.checkpoint(); if (ancestor === owner.value) return true; }
      return false;
    },
    get(instance) {
      if (instance.kind !== "instance" || instance.dictionary === undefined) throw Error("dictionary descriptor requires owned instance storage");
      return instance.state.dictionaryObject!;
    },
    set(instance, value, meter) {
      if (instance.kind !== "instance") throw Error("invalid instance dictionary receiver");
      if ((value.kind !== "dict"&&value.kind!=="instance")||runtimeDictionaryPayload(value)===undefined) {
        const name = diagnosticTypeName(hasRuntimeInstanceAttributes(value) ? value.type.value.name : value.kind === "type" ? value.metaclass.value.name : value.kind === "none" ? "NoneType" : value.kind === "not-implemented" ? "NotImplementedType" : value.kind,meter);
        meter.checkpoint(0, 128 + 2 * name.length);
        throw new PythonRuntimeError("TypeError", `__dict__ must be set to a dictionary, not a '${name}'`);
      }
      instance.state.mutateDictionary(value, values, meter);
    },
    delete(instance, meter) {
      if (instance.kind !== "instance") throw Error("invalid instance dictionary receiver");
      if(options.deleteError!==undefined)throw new PythonRuntimeError("TypeError",options.deleteError);
      instance.state.mutateDictionary(undefined, values, meter);
    }
  });
}
