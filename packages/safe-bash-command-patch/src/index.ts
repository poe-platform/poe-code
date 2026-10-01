import type { CommandDefinition,VirtualShellPlugin } from "safe-bash-contracts";
import type { DiffPatchOptions } from "safe-bash-diff-engine/shared";
import { patchCommand as createPatchCommand } from "./patch.js";
export type { DiffPatchOptions,DiffPatchOptions as PatchCommandsOptions } from "safe-bash-diff-engine/shared";
export { patchCommand as createPatchCommand,patchCommand } from "./patch.js";
export * from "./sync.js";
export type PatchLimits = Omit<DiffPatchOptions, "replace">;

export function createPatchCommands(options: DiffPatchOptions = {}): readonly CommandDefinition[] { return [createPatchCommand(options)]; }
export function patchCommands(options: DiffPatchOptions = {}): VirtualShellPlugin {
  const commands = createPatchCommands(options);
  return { name: "patch-commands", setup(host) {
    if (!options.replace) for (const command of commands) {
      if (host.commands.has(command.name)) throw new Error(`Command already registered: ${command.name}`);
    }
    for (const command of commands) host.commands.register(command, { replace: options.replace ?? false });
  } };
}
