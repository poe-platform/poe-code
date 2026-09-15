import { lookupMroAttribute } from "./class-attributes.js";
import { diagnosticTypeName } from "./diagnostic-type-name.js";
import { PythonRuntimeError } from "./error.js";
import type { ExecutionMeter } from "./execution-budget.js";
import { runtimeListPayload } from "./runtime-list-payload.js";
import { runtimeTuplePayload } from "./runtime-tuple-payload.js";
import type { BuiltinFunctionValue, RuntimeValues, TypeValue } from "./runtime-values.js";

/** Retain a mapping without copying or probing its contents. Applicability
 * inspects raw item-access slots; a present but non-callable slot still qualifies. */
export function createMappingProxyNewBuiltin(owner: TypeValue, values: RuntimeValues, meter: ExecutionMeter): BuiltinFunctionValue {
  meter.checkpoint(0, 96);
  return values.builtinFunction({ name: "__new__", owner, keywordValidation: "callee", doc: "Create and return a new object.  See help(type) for accurate signature.",
    invoke(positional, keywords, meter, invocation) {
      meter.checkpoint();
      if (positional.length === 0) throw new PythonRuntimeError("TypeError", "mappingproxy.__new__(): not enough arguments");
      const type = positional[0];
      if (type.kind !== "type") {
        const name = invocation?.typeName?.(type) ?? (type.kind === "none" ? "NoneType" : type.kind === "not-implemented" ? "NotImplementedType" : type.kind);
        throw new PythonRuntimeError("TypeError", `mappingproxy.__new__(X): X is not a type object (${diagnosticTypeName(name, meter)})`);
      }
      if (type !== owner) {
        const name = diagnosticTypeName(type.value.name, meter);
        throw new PythonRuntimeError("TypeError", `mappingproxy.__new__(${name}): ${name} is not a subtype of mappingproxy`);
      }
      const count = positional.length - 1, total = count + keywords.items.size;
      if (total > 1) throw new PythonRuntimeError("TypeError", `mappingproxy() takes at most 1 ${count === 0 ? "keyword argument" : "argument"} (${total} given)`);
      const mapping = positional[1] ?? keywords.items.lookup(values.string("mapping"))?.value;
      if (mapping === undefined) throw new PythonRuntimeError("TypeError", "mappingproxy() missing required argument 'mapping' (pos 1)");
      let accepted = mapping.kind === "dict" || mapping.kind === "mappingproxy" || mapping.kind === "str" || mapping.kind === "bytes" || mapping.kind === "range";
      if (!accepted && runtimeListPayload(mapping) === undefined && runtimeTuplePayload(mapping) === undefined && invocation?.actualType !== undefined) {
        const actual = invocation.actualType(mapping); meter.checkpoint();
        accepted = lookupMroAttribute(actual.value.mro, values.string("__getitem__"), (base, name) => base.namespace.items.lookup(name), meter) !== undefined;
      }
      if (!accepted) {
        const name = invocation?.typeName?.(mapping) ?? (mapping.kind === "none" ? "NoneType" : mapping.kind === "not-implemented" ? "NotImplementedType" : mapping.kind);
        throw new PythonRuntimeError("TypeError", `mappingproxy() argument must be a mapping, not ${diagnosticTypeName(name, meter)}`);
      }
      return values.mappingProxy(mapping);
    }
  });
}
