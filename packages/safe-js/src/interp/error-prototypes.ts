import type { Budget } from "./budget.js";
import type { SandboxObject } from "./values.js";
import type { SandboxErrorName } from "../error/shape.js";

export const errorPrototypes = new WeakMap<Budget, Map<SandboxErrorName, SandboxObject>>();
