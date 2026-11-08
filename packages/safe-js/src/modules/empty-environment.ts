import type { ModuleEnvironment } from "./registry.js";

// Only the registry factory certifies these permanently empty native tables.
// Pinned operations prevent later host hooks from forging ownership or seeing it.
const environments = new WeakSet<ModuleEnvironment>();
const has = WeakSet.prototype.has.bind(environments);
const add = WeakSet.prototype.add.bind(environments);
export const revokeImmutableEmptyModuleEnvironment = WeakSet.prototype.delete.bind(environments);

export const hasImmutableEmptyModuleEnvironment = has;

export function registerImmutableEmptyModuleEnvironment(environment: ModuleEnvironment): void {
  add(environment);
}
