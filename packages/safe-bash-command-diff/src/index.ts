import { evalSyncDiff } from "./sync.js";
import type { CommandDefinition,VirtualShellPlugin } from "safe-bash-contracts";
import type { DiffPatchOptions } from "safe-bash-diff-engine/shared";
import { diffCommand as createDiffCommand } from "./diff.js";
export type { DiffPatchOptions as DiffCommandsOptions,DiffPatchOptions } from "safe-bash-diff-engine/shared";
export { diffCommand as createDiffCommand,diffCommand } from "./diff.js";
export * from "./sync.js";
export type DiffLimits = Omit<DiffPatchOptions, "replace">;

export function createDiffCommands(options: DiffPatchOptions = {}): readonly CommandDefinition[] { return [createDiffCommand(options)]; }
export function diffCommands(options: DiffPatchOptions = {}): VirtualShellPlugin {
  const commands = createDiffCommands(options);
  return { name: "diff-commands", setup(host) {
    if (!options.replace) for (const command of commands) {
      if (host.commands.has(command.name)) throw new Error(`Command already registered: ${command.name}`);
    }
    for (const command of commands) host.commands.register(command, { replace: options.replace ?? false });
  } };
}

import { syncCommandEvaluators } from "safe-bash-contracts/runtime-control";
syncCommandEvaluators.evalSyncDiff = evalSyncDiff;
