import type { CommandDefinition, VirtualShellPlugin } from "../../contracts/index.js";
import { diffCommand } from "./diff.js";
import { patchCommand } from "./patch.js";
import type { DiffPatchOptions } from "./shared.js";

export type { DiffPatchOptions } from "./shared.js";

export function createDiffPatchCommands(options: DiffPatchOptions = {}): readonly CommandDefinition[] {
  return [diffCommand(options), patchCommand(options)];
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
