import { diagnosticTypeName } from "./diagnostic-type-name.js";
import { PythonRuntimeError } from "./error.js";
import type { ExecutionMeter } from "./execution-budget.js";
import { runtimeComplexPayload } from "./runtime-complex-payload.js";
import type { BuiltinInvocationContext,RuntimeValue,RuntimeValues } from "./runtime-values.js";

/** Resolve only __complex__, validating and normalizing its result. Callers
 * choose whether native storage takes precedence over this protocol. */
export function convertRuntimeComplexSpecial(source:RuntimeValue,values:RuntimeValues,meter:ExecutionMeter,invocation?:BuiltinInvocationContext):Extract<RuntimeValue,{kind:"complex"}>|undefined {
  const method=invocation?.lookupSpecial?.(source,"__complex__");meter.checkpoint();
  if(method===undefined)return undefined;
  const result=invocation!.call(method,[]);meter.checkpoint();
  const payload=runtimeComplexPayload(result);
  if(result.kind!=="complex") {
    const name=diagnosticTypeName(invocation?.typeName?.(result)??(result.kind==="none"?"NoneType":result.kind==="not-implemented"?"NotImplementedType":result.kind),meter);
    if(payload===undefined)throw new PythonRuntimeError("TypeError",`__complex__ returned non-complex (type ${name})`);
    invocation?.warn?.("DeprecationWarning",`__complex__ returned non-complex (type ${name}).  The ability to return an instance of a strict subclass of complex is deprecated, and may be removed in a future version of Python.`);
  }
  return values.complex(payload!.real,payload!.imaginary);
}
