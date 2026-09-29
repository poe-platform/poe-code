import { builtInDirectContextExecutors } from "../internal.js";
import type { CommandDefinition, VirtualShellPlugin } from "../../contracts/index.js";
import {
  createSsconvertCommand as createRawSsconvertCommand,
  createSsconvertCommands as createRawSsconvertCommands,
  parseCommand,
  type SsconvertCommandsOptions,
} from "safe-bash-command-ssconvert";

export * from "safe-bash-command-ssconvert";

export function createSsconvertCommand(options: SsconvertCommandsOptions = {}): CommandDefinition {
  const def = createRawSsconvertCommand(options);
  builtInDirectContextExecutors.add(def.execute);
  return def;
}

export function createSsconvertCommands(options: SsconvertCommandsOptions = {}): readonly CommandDefinition[] {
  const defs = createRawSsconvertCommands(options);
  for (let i = 0; i < defs.length; i++) builtInDirectContextExecutors.add(defs[i]!.execute);
  return defs;
}

export function ssconvertCommands(options: SsconvertCommandsOptions = {}): VirtualShellPlugin {
  const commands = createSsconvertCommands(options);
  const replace = options.replace ?? false;
  return {
    name: "ssconvert-commands",
    setup(host) {
      for (const command of commands) host.commands.register(command, { replace });
    },
  };
}

export function evalSyncSsconvert(opArgs: readonly string[]): string | undefined {
  if (opArgs.length === 0) return undefined;
  try {
    const parsed = parseCommand(opArgs);
    if (parsed.kind === "terminal" && parsed.exitCode === 0 && !parsed.stderr && parsed.stdout) {
      return parsed.stdout;
    }
    return undefined;
  } catch {
    return undefined;
  }
}
