import type { CommandContext, CommandDefinition, VirtualShellPlugin } from "../../contracts/index.js";
import { execute } from "./apply.js";
import { settings, type ApplyPatchCommandsOptions } from "./options.js";

export type { ApplyPatchCommandsOptions, ApplyPatchLimits } from "./options.js";

export function createApplyPatchCommand(options: ApplyPatchCommandsOptions = {}): CommandDefinition {
  const limits = settings(options);
  return Object.freeze({ name: "apply_patch", description: "Apply a bounded literal Codex-format patch to the virtual filesystem", execute: (context: CommandContext) => execute(context, limits) });
}

export function createApplyPatchCommands(options: ApplyPatchCommandsOptions = {}): readonly CommandDefinition[] {
  return Object.freeze([createApplyPatchCommand(options)]);
}

export function applyPatchCommands(options: ApplyPatchCommandsOptions = {}): VirtualShellPlugin {
  const definitions = createApplyPatchCommands(options);
  const replace = options.replace ?? false;
  return {
    name: "apply-patch-commands",
    setup(host) {
      if (!replace && host.commands.has("apply_patch")) throw new Error("Command already registered: apply_patch");
      for (const definition of definitions) host.commands.register(definition, { replace });
    },
  };
}
