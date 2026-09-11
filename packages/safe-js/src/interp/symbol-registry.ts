import type { Budget } from "./budget.js";
import type { SandboxClosure, SandboxMap } from "./values.js";

export const symbolRegistries = new WeakMap<Budget, SandboxMap>();

// Original intrinsic aliases keep their registry even after property replacement.
export const symbolRegistryOrigins = new WeakMap<SandboxClosure, Map<string, symbol>>();
