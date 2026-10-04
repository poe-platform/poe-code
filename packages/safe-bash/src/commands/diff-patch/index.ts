import { syncCommandEvaluators } from "../internal.js";
import type { CommandDefinition, VirtualShellPlugin } from "safe-bash-contracts";
import { registerDefaultExecutors } from "../internal.js";
import { diffCommand, type DiffPatchOptions } from "safe-bash-command-diff";
import { patchCommand } from "safe-bash-command-patch";


export function createDiffPatchCommands(options: DiffPatchOptions = {}): readonly CommandDefinition[] {
  return registerDefaultExecutors([diffCommand(options), patchCommand(options)], options);
}

export function diffPatchCommands(options: DiffPatchOptions = {}): VirtualShellPlugin {
  return {
    name: "diff-patch-commands",
    setup(host) {
      const definitions = createDiffPatchCommands(options);
      if (!options.replace) for (const command of definitions) {
        if (host.commands.has(command.name)) throw new Error(`Command already registered: ${command.name}`);
      }
      for (const command of definitions) host.commands.register(command, { replace: options.replace ?? false });
    },
  };
}
export * from "safe-bash-command-diff";
export * from "safe-bash-command-patch";
import { evalSyncDiff } from "safe-bash-command-diff";
syncCommandEvaluators.evalSyncDiff = evalSyncDiff;
