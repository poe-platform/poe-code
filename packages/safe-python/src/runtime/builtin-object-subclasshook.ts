import { PythonRuntimeError } from "./error.js";
import type { ExecutionMeter } from "./execution-budget.js";
import type { ClassMethodDescriptorValue, RuntimeValues, TypeValue } from "./runtime-values.js";

/** CPython's terminal object hook uses METH_CLASS | METH_O. Its argument is
 * deliberately opaque; ABCMeta owns interpretation and override dispatch. */
export function createObjectSubclasshookDescriptor(values: RuntimeValues, meter: ExecutionMeter, objectType: TypeValue): ClassMethodDescriptorValue {
  meter.checkpoint(1, 96);
  return values.classMethodDescriptor({
    owner: objectType, name: "__subclasshook__", textSignature: "($type, object, /)",
    doc: "Abstract classes can override this to customize issubclass().\n\n" +
      "This is invoked early on by abc.ABCMeta.__subclasscheck__().\n" +
      "It should return True, False or NotImplemented.  If it returns\n" +
      "NotImplemented, the normal algorithm is used.  Otherwise, it\n" +
      "overrides the normal algorithm (and the outcome is cached).\n",
    accepts(receiver, meter) {
      if (receiver.kind !== "type") return false;
      for (const ancestor of receiver.value.mro) { meter.checkpoint(); if (ancestor === objectType.value) return true; }
      return false;
    },
    invoke(receiver, positional, keywords, meter) {
      meter.checkpoint();
      if (receiver.kind !== "type") throw Error("subclass hook requires a class receiver");
      if (keywords.items.size !== 0 || positional.length !== 1) {
        let name = "";
        for (const point of receiver.value.names.get("__qualname__", values, meter).value) { meter.checkpoint(1, point > 0xffff ? 4 : 2); name += String.fromCodePoint(point); }
        meter.checkpoint(0, 128 + 2 * name.length);
        throw new PythonRuntimeError("TypeError", `${name}.__subclasshook__() takes ${keywords.items.size !== 0 ? "no keyword arguments" : `exactly one argument (${positional.length} given)`}`);
      }
      return values.notImplemented;
    }
  });
}
