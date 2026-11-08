import type { SandboxClosure } from "./values.js";

export type ModuleFunctionOrigin = { module: string; path: readonly string[] };

export const moduleFunctionOrigins = new WeakMap<SandboxClosure, ModuleFunctionOrigin>();
