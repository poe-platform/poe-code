import { diagnosticTypeName } from "./diagnostic-type-name.js";
import { PythonRuntimeError } from "./error.js";
import type { ExecutionMeter } from "./execution-budget.js";

/** Shared native presentation diagnostic, including nonprintable code points. */
export function unknownFormatCode(type: number, typeName: string, meter: ExecutionMeter): never {
  const code = type > 32 && type < 128 ? String.fromCharCode(type) : `\\x${type.toString(16)}`;
  throw new PythonRuntimeError("ValueError", `Unknown format code '${code}' for object of type '${diagnosticTypeName(typeName, meter)}'`);
}
