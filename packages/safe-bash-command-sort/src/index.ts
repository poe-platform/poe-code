import type { VirtualShellPlugin } from "safe-bash-contracts";
import { createSortCommand } from "./sort.js";
export { createSortCommand } from "./sort.js";
import type { SortCommandsOptions } from "./options.js";
export type { SortCommandsOptions } from "./options.js";
export { defaultSortLimits, type SortLimits } from "./records.js";
export function createSortCommands(options: SortCommandsOptions = {}) { return [createSortCommand(options)]; }
export function sortCommands(options: SortCommandsOptions = {}): VirtualShellPlugin {
  const commands = createSortCommands(options);
  return { name: "sort-commands", setup(host) {
    if (!options.replace && host.commands.has("sort")) throw new Error("Command already registered: sort");
    for (const command of commands) host.commands.register(command, { replace: options.replace ?? false });
  } };
}
