import { PythonRuntimeError } from "./error.js";
import type { ExecutionMeter } from "./execution-budget.js";
import type { BuiltinInvocationContext, FunctionValue, RuntimeValue, RuntimeValues } from "./runtime-values.js";
import { hasRuntimeInstanceAttributes } from "./runtime-values.js";
import { RuntimeAttributeStorage } from "./runtime-attribute-storage.js";
import {replaceRuntimeFunctionCode} from "./runtime-function-code.js";
import type {KeyOperations} from "./ordered-key-map.js";
import type {RuntimeCodePrograms} from "./runtime-code-programs.js";

/** Apply implemented native function writes. False preserves the extension
 * boundary for unfinished intrinsic fields instead of creating a misleading
 * ordinary attribute that would shadow their eventual data descriptors. */
export function runtimeMutateFunctionAttribute(fn: FunctionValue, name: string, change: { readonly kind: "set"; readonly value: RuntimeValue } | { readonly kind: "delete" }, values: RuntimeValues, meter: ExecutionMeter,keys?:KeyOperations<RuntimeValue>,warn?:BuiltinInvocationContext["warn"],resolveCode?:RuntimeCodePrograms["functionCode"]): boolean {
  meter.checkpoint();
  switch (name) {
    case "__code__": {
      if(change.kind==="delete"||change.value.kind!=="instance"||change.value.native?.kind!=="code")throw new PythonRuntimeError("TypeError","__code__ must be set to a code object");
      const original=change.value.native.code;
      let code;
      try {code="body" in original?original:resolveCode?.(original);}finally{meter.checkpoint();}
      if(code===undefined)return false;
      replaceRuntimeFunctionCode(fn,code,values,meter,keys,warn);return true;
    }
    case "__class__":
    case "__annotate__": case "__type_params__":
      return false;
    case "__globals__": case "__builtins__": case "__closure__":
      throw new PythonRuntimeError("AttributeError","readonly attribute");
    case "__defaults__": case "__kwdefaults__": {
      const value = change.kind === "delete" ? values.none : change.value;
      if (value.kind !== "none" && value.kind !== (name === "__defaults__" ? "tuple" : "dict")) throw new PythonRuntimeError("TypeError", `${name} must be set to a ${name === "__defaults__" ? "tuple" : "dict"} object`);
      if (name === "__defaults__") fn.value.positionalDefaults = value;
      else fn.value.keywordDefaults = value;
      return true;
    }
    case "__dict__": {
      if (change.kind === "delete") throw new PythonRuntimeError("TypeError", "cannot delete __dict__");
      const value = change.value;
      if (value.kind !== "dict") {
        const typeName = hasRuntimeInstanceAttributes(value) ? value.type.value.name : value.kind === "type" ? value.metaclass.value.name : value.kind === "none" ? "NoneType" : value.kind === "not-implemented" ? "NotImplementedType" : value.kind;
        meter.checkpoint(0, 128 + 2 * typeName.length);
        throw new PythonRuntimeError("TypeError", `__dict__ must be set to a dictionary, not a '${typeName}'`);
      }
      const storage = fn.value.attributes instanceof RuntimeAttributeStorage ? fn.value.attributes : new RuntimeAttributeStorage(values, meter);
      storage.replace(value); fn.value.attributes = storage;
      return true;
    }
    case "__name__": case "__qualname__":
      if (change.kind === "delete" || change.value.kind !== "str") throw new PythonRuntimeError("TypeError", `${name} must be set to a string object`);
      if (name === "__name__") fn.value.name = change.value;
      else fn.value.qualifiedName = change.value;
      return true;
    case "__module__": case "__doc__":
      if (name === "__module__") fn.value.module = change.kind === "delete" ? values.none : change.value;
      else fn.value.doc = change.kind === "delete" ? values.none : change.value;
      return true;
    case "__annotations__":
      if (change.kind === "delete" || change.value.kind === "none") delete fn.value.annotations;
      else {
        if (change.value.kind !== "dict") throw new PythonRuntimeError("TypeError", "__annotations__ must be set to a dict object");
        fn.value.annotations = change.value;
      }
      return true;
  }
  if (change.kind === "set") {
    if (!(fn.value.attributes instanceof RuntimeAttributeStorage)) meter.checkpoint(1, fn.value.attributes.has(name) ? 0 : 48 + 2 * name.length);
    fn.value.attributes.set(name, change.value);
  } else if (!fn.value.attributes.delete(name)) {
    meter.checkpoint(0, 128 + 2 * name.length);
    throw new PythonRuntimeError("AttributeError", `'function' object has no attribute '${name}'`);
  }
  return true;
}
