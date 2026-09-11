import type { SandboxMap, SandboxSet } from "./values.js";
import { internalSymbols } from "./internal-symbols.js";

export const sandboxMapBrand = Symbol("SandboxMap");
export const sandboxSetBrand = Symbol("SandboxSet");
internalSymbols.add(sandboxMapBrand);
internalSymbols.add(sandboxSetBrand);

export function isSandboxMap(value: unknown): value is SandboxMap {
  return typeof value === "object" && value !== null && sandboxMapBrand in value;
}

export function isSandboxSet(value: unknown): value is SandboxSet {
  return typeof value === "object" && value !== null && sandboxSetBrand in value;
}
