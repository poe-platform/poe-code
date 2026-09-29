import type { CommandDefinition } from "./command.js";

import { builtInDirectContextExecutors } from "./runtime-control.js";
export { builtInDirectContextExecutors } from "./runtime-control.js";

export function isDefaultCommandOptions(options?: unknown): boolean {
  if (!options || typeof options !== "object") return true;
  for (const [k, v] of Object.entries(options as Record<string, unknown>)) {
    if (k !== "replace" && v !== undefined) return false;
  }
  return true;
}

export function registerDefaultExecutor<T extends CommandDefinition>(def: T, options?: unknown): T {
  if (isDefaultCommandOptions(options)) builtInDirectContextExecutors.add(def.execute);
  return def;
}

export function registerDefaultExecutors<T extends readonly CommandDefinition[]>(defs: T, options?: unknown): T {
  if (isDefaultCommandOptions(options)) {
    for (let i = 0; i < defs.length; i++) builtInDirectContextExecutors.add(defs[i]!.execute);
  }
  return defs;
}

