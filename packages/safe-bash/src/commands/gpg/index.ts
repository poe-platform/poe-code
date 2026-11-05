import { builtInDirectContextExecutors, syncCommandEvaluators } from "../internal.js";
import type { CommandDefinition, VirtualShellPlugin } from "../../contracts/index.js";
import {
  createGpgCommand as createRawGpgCommand,
  createGpgCommands as createRawGpgCommands,
  type GpgCommandsOptions,
} from "safe-bash-command-gpg";

export * from "safe-bash-command-gpg";

function isDefaultGpgOptions(options?: GpgCommandsOptions): boolean {
  if (!options) return true;
  return options.limits === undefined && options.maxBufferedBytes === undefined;
}

export function createGpgCommand(options: GpgCommandsOptions = {}): CommandDefinition {
  const def = createRawGpgCommand(options);
  if (isDefaultGpgOptions(options)) {
    builtInDirectContextExecutors.add(def.execute);
  }
  return def;
}

export function createGpgCommands(options: GpgCommandsOptions = {}): readonly CommandDefinition[] {
  const defs = createRawGpgCommands(options);
  if (isDefaultGpgOptions(options)) {
    for (let i = 0; i < defs.length; i++) builtInDirectContextExecutors.add(defs[i]!.execute);
  }
  return defs;
}

export function gpgCommands(options: GpgCommandsOptions = {}): VirtualShellPlugin {
  const commands = createGpgCommands(options);
  const replace = options.replace ?? false;
  return {
    name: "gpg-commands",
    setup(host) {
      if (!replace) {
        for (const command of commands) {
          if (host.commands.has(command.name)) throw new Error(`Command already registered: ${command.name}`);
        }
      }
      for (const command of commands) host.commands.register(command, { replace });
    },
  };
}

export function evalSyncGpg(
  ignoredInput: Uint8Array | undefined,
  opArgs: readonly string[],
  ignoredReadFile?: (filePath: string) => Uint8Array | undefined,
  ignoredWriteFile?: (filePath: string, bytes: Uint8Array) => boolean,
): string | undefined {
  if (opArgs.length === 1 && opArgs[0] === "--version") return "gpg (GnuPG) 2.4.5 (safe-bash)\nlibgcrypt 1.11.0\n";
  return undefined;
}

syncCommandEvaluators.evalSyncGpg = evalSyncGpg;
