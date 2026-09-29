import { builtInDirectContextExecutors } from "../internal.js";
import type { CommandDefinition, VirtualShellPlugin } from "../../contracts/index.js";
import {
  createPandocCommand as createRawPandocCommand,
  createPandocCommands as createRawPandocCommands,
  inspectFormats,
  type PandocCommandsOptions,
} from "safe-bash-command-pandoc";

export * from "safe-bash-command-pandoc";

export function createPandocCommand(options: PandocCommandsOptions = {}, hasCommand?: (name: string) => boolean): CommandDefinition {
  const def = createRawPandocCommand(options, hasCommand);
  builtInDirectContextExecutors.add(def.execute);
  return def;
}

export function createPandocCommands(options: PandocCommandsOptions = {}): readonly CommandDefinition[] {
  const defs = createRawPandocCommands(options);
  for (let i = 0; i < defs.length; i++) builtInDirectContextExecutors.add(defs[i]!.execute);
  return defs;
}

export function pandocCommands(options: PandocCommandsOptions = {}): VirtualShellPlugin {
  const commands = createPandocCommands(options);
  const replace = options.replace ?? false;
  return {
    name: "pandoc",
    setup(host) {
      for (const command of commands) host.commands.register(command, { replace });
    },
  };
}

export function evalSyncPandoc(opArgs: readonly string[]): string | undefined {
  if (opArgs.length === 0) return undefined;
  try {
    if (opArgs.every((a) => a === "--list-input-formats" || a === "--list-output-formats")) {
      return inspectFormats(opArgs);
    }
    return undefined;
  } catch {
    return undefined;
  }
}
