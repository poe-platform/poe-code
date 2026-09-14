import {diagnosticTypeName} from "./diagnostic-type-name.js";
import {PythonRuntimeError} from "./error.js";
import type {ExecutionMeter} from "./execution-budget.js";
import type {RuntimeBufferContext} from "./runtime-buffer-context.js";
import type {RuntimeValue} from "./runtime-values.js";

/** PyObject_GetBuffer's missing-protocol error uses the guest tp_name, with
 * its 100-byte precision, without invoking guest string conversions. */
export function unsupportedBuffer(value:RuntimeValue,meter:ExecutionMeter,buffers?:RuntimeBufferContext):never {
  const name=buffers?.typeName?.(value)??(value.kind==="instance"?value.type.value.diagnosticName:value.kind==="none"?"NoneType":value.kind==="not-implemented"?"NotImplementedType":value.kind);
  throw new PythonRuntimeError("TypeError",`a bytes-like object is required, not '${diagnosticTypeName(name,meter,100)}'`);
}
