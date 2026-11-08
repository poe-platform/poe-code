import type { SandboxMap, SandboxSet } from "./values.js";
import { internalSymbols } from "./internal-symbols.js";
import { hasPropertyBrand } from "./object-model.js";

export const sandboxMapBrand = Symbol("SandboxMap");
export const sandboxSetBrand = Symbol("SandboxSet");
internalSymbols.add(sandboxMapBrand);
internalSymbols.add(sandboxSetBrand);

export function isSandboxMap(value: unknown): value is SandboxMap {
  return typeof value === "object" && value !== null && hasPropertyBrand(value, sandboxMapBrand);
}

export function isSandboxSet(value: unknown): value is SandboxSet {
  return typeof value === "object" && value !== null && hasPropertyBrand(value, sandboxSetBrand);
}
