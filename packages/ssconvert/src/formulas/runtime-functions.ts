import type { CellValue } from "../workbook.js";
import { snapshotWorkbook } from "../workbook.js";
import type { FunctionImplementation } from "./functions/types.js";
import { functionDescriptors } from "./function-descriptors.js";

/** Trusted, cooperative JS ports, supplied by the invocation owner; never a module loader. */
export interface RuntimeFunction {
  readonly signature: string;
  /** Repeated argument type after the fixed signature; ? retains non-scalar values. */
  readonly rest?: "f" | "s" | "b" | "E" | "r" | "A" | "?";
  readonly implementation: (...args: Parameters<FunctionImplementation>) => CellValue;
}
export type RuntimeFunctions = Readonly<Record<string, RuntimeFunction>>;

export function snapshotRuntimeFunctions(functions: RuntimeFunctions): RuntimeFunctions {
  const owned: Record<string, RuntimeFunction> = Object.create(null) as Record<string, RuntimeFunction>;
  for (const name of Object.keys(functions)) {
    const entry = Object.getOwnPropertyDescriptor(functions, name);
    if (!entry || !Object.hasOwn(entry, "value") || entry.value === null || typeof entry.value !== "object")
      throw new TypeError(`Invalid ssconvert runtime function definition: ${name}`);
    const definition = entry.value as RuntimeFunction;
    const signatureField = Object.getOwnPropertyDescriptor(definition, "signature");
    const implementationField = Object.getOwnPropertyDescriptor(definition, "implementation");
    const restField = Object.getOwnPropertyDescriptor(definition, "rest");
    if (!signatureField || !implementationField || !Object.hasOwn(signatureField, "value") || !Object.hasOwn(implementationField, "value"))
      throw new TypeError(`Invalid ssconvert runtime function definition: ${name}`);
    const validName = name.length > 0 && name.length <= 255 && [...name].every((char, index) =>
      (char >= "A" && char <= "Z") || char === "_" || (index > 0 && char >= "0" && char <= "9"));
    const signature = signatureField.value as unknown;
    if (!validName || Object.hasOwn(functionDescriptors, name) || ["SUM", "PRODUCT", "GNUMERIC_VERSION", "RAND", "TABLE", "IF", "IFERROR", "IFNA"].includes(name))
      throw new TypeError(`Invalid or conflicting ssconvert runtime function: ${name}`);
    if (typeof signature !== "string" || signature.length > 255 ||
      [...signature].some(char => !"fsbErA?|".includes(char)) || signature.split("|").length > 2 ||
      typeof implementationField.value !== "function")
      throw new TypeError(`Invalid ssconvert runtime function definition: ${name}`);
    if (restField && (!Object.hasOwn(restField, "value") ||
        restField.value !== undefined && (typeof restField.value !== "string" || restField.value.length !== 1 || !"fsbErA?".includes(restField.value))))
      throw new TypeError(`Invalid ssconvert runtime function definition: ${name}`);
    const rest = restField?.value as RuntimeFunction["rest"];
    const implementation = implementationField.value as RuntimeFunction["implementation"];
    owned[name] = Object.freeze({ signature, ...(rest === undefined ? {} : { rest }), implementation(args: Parameters<FunctionImplementation>[0], host: Parameters<FunctionImplementation>[1]) {
      host.tick();
      const result = implementation(args, host);
      host.tick();
      return snapshotWorkbook({ sheets: [{ id: "runtime", name: "Runtime", cells: [
        { row: 0, column: 0, value: result }
      ] }] }, host.context.limits).sheets[0]!.cells[0]!.value;
    } });
  }
  return Object.freeze(owned);
}
