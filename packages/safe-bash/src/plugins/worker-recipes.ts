import type { CommandDefinition } from "../contracts/index.js";
import type { AgentCommandsOptions } from "./composition.js";
import type { VirtualShellPlugin } from "../contracts/index.js";

/** Recipes are enrolled by their author, never inferred from a command name. */
export const agentWorkerRecipes = new WeakMap<CommandDefinition["execute"], AgentCommandsOptions>();
export const agentWorkerPlugins = new WeakSet<VirtualShellPlugin>();
/** Interpreter-owned entry trampolines are never child-visible commands. */
export const hostDispatchCommands = new WeakSet<CommandDefinition["execute"]>();

export function captureAgentWorkerRecipe(options: AgentCommandsOptions): AgentCommandsOptions | undefined {
  // Portable hosts can compose commands without Node's worker prerequisites.
  if (typeof structuredClone !== "function") return undefined;
  const seen = new Set<object>();
  const portable = (value: unknown): boolean => {
    if (value === null || typeof value !== "object") return typeof value !== "function" && typeof value !== "symbol";
    if (seen.has(value)) return true;
    seen.add(value);
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== null && prototype !== Object.prototype && prototype !== Array.prototype) return false;
    if (Object.getOwnPropertySymbols(value).length) return false;
    return Object.entries(Object.getOwnPropertyDescriptors(value)).every(([key, descriptor]) =>
      "value" in descriptor && (descriptor.enumerable || Array.isArray(value) && key === "length") && portable(descriptor.value));
  };
  return portable(options) ? structuredClone(options) : undefined;
}
