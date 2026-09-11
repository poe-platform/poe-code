import type { Budget } from "./budget.js";
import type { SandboxObject } from "./values.js";
import type { NumericTypedArrayConstructor } from "./typed-array.js";

export const typedArrayPrototypes = new WeakMap<Budget, Map<NumericTypedArrayConstructor, SandboxObject>>();
