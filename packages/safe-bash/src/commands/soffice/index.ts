import { builtInDirectContextExecutors } from "../internal.js";
import type { CommandDefinition, VirtualShellPlugin } from "../../contracts/index.js";
import {
  createSofficeCommand as createRawSofficeCommand,
  createLibreofficeCommand as createRawLibreofficeCommand,
  createSofficeCommands as createRawSofficeCommands,
  runSofficeCliSync,
  type SofficeCommandOptions,
  type SofficeCommandsOptions,
} from "safe-bash-command-soffice";

export * from "safe-bash-command-soffice";

export function createSofficeCommand(options: SofficeCommandOptions = {}): CommandDefinition {
  const def = createRawSofficeCommand(options);
  builtInDirectContextExecutors.add(def.execute);
  return def;
}

export function createLibreofficeCommand(options: SofficeCommandOptions = {}): CommandDefinition {
  const def = createRawLibreofficeCommand(options);
  builtInDirectContextExecutors.add(def.execute);
  return def;
}

export function createSofficeCommands(options: SofficeCommandsOptions = {}): readonly CommandDefinition[] {
  const defs = createRawSofficeCommands(options);
  for (let i = 0; i < defs.length; i++) builtInDirectContextExecutors.add(defs[i]!.execute);
  return defs;
}

export function sofficeCommands(options: SofficeCommandsOptions = {}): VirtualShellPlugin {
  const commands = createSofficeCommands(options);
  const replace = options.replace ?? false;
  return {
    name: "soffice",
    setup(host) {
      for (const command of commands) host.commands.register(command, { replace });
    },
  };
}

export function evalSyncSoffice(
  opArgs: readonly string[],
  readFileSync?: (filePath: string) => Uint8Array | undefined,
): string | undefined {
  try {
    let hasHelpOrVer = false;
    let hasCat = false;
    for (let i = 0; i < opArgs.length; i++) {
      const a = opArgs[i]!;
      if (a === "--version" || a === "--help" || a === "-h") hasHelpOrVer = true;
      else if (a === "--cat" || a === "-cat") hasCat = true;
      else if (a === "--convert-to" || a.startsWith("--convert-to=")) return undefined;
    }
    if (!hasHelpOrVer && !hasCat) return undefined;
    const files = new Map<string, Uint8Array>();
    if (!hasHelpOrVer) {
      for (let i = 0; i < opArgs.length; i++) {
        const a = opArgs[i]!;
        if (a.startsWith("-")) continue;
        const b = readFileSync?.(a);
        if (!b || b.byteLength > 262144) return undefined;
        files.set(a, b);
      }
    }
    const res = runSofficeCliSync(opArgs, files);
    if (res.exitCode !== 0 || res.stderr) return undefined;
    return res.stdout;
  } catch {
    return undefined;
  }
}
