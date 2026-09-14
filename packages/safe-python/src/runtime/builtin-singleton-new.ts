import { diagnosticTypeName } from "./diagnostic-type-name.js";
import { PythonRuntimeError } from "./error.js";
import { ExecutionLimitError,type ExecutionMeter } from "./execution-budget.js";
import type { BuiltinFunctionValue, RuntimeValue,RuntimeValues, TypeValue } from "./runtime-values.js";

/** Singleton type allocation preserves the execution-owned sentinel identity. */
export function createSingletonNewBuiltin(owner: TypeValue, singleton:Extract<RuntimeValue,{kind:"none"|"not-implemented"|"ellipsis"}>,values: RuntimeValues, meter: ExecutionMeter): BuiltinFunctionValue {
  meter.checkpoint(0, 96);
  return values.builtinFunction({ name: "__new__", owner, keywordValidation: "callee", doc: "Create and return a new object.  See help(type) for accurate signature.", textSignature: "($type, *args, **kwargs)",
    invoke(positional, keywords, meter, invocation) {
      let fatal=false;
      try {
      meter.checkpoint();
      const ownerName=owner.value.name;
      if (positional.length === 0) throw new PythonRuntimeError("TypeError", `${ownerName}.__new__(): not enough arguments`);
      const type = positional[0];
      if (type.kind !== "type") {
        const name = invocation?.typeName?.(type) ?? (type.kind === "none" ? "NoneType" : type.kind === "not-implemented" ? "NotImplementedType" : type.kind);
        throw new PythonRuntimeError("TypeError", `${ownerName}.__new__(X): X is not a type object (${diagnosticTypeName(name, meter)})`);
      }
      if (type !== owner) {
        const name = diagnosticTypeName(type.value.name, meter);
        throw new PythonRuntimeError("TypeError", `${ownerName}.__new__(${name}): ${name} is not a subtype of ${ownerName}`);
      }
      if (positional.length !== 1 || keywords.items.size !== 0) throw new PythonRuntimeError("TypeError", `${singleton.kind==="ellipsis"?"EllipsisType":ownerName} takes no arguments`);
      return singleton;
      } catch(error){fatal=error instanceof ExecutionLimitError;throw error;}
      finally{if(!fatal)meter.checkpoint();}
    }
  });
}
