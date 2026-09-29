import { builtInDirectContextExecutors, syncCommandEvaluators } from "../internal.js";
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
  syncCommandEvaluators.evalSyncSoffice = evalSyncSoffice;
  const def = createRawSofficeCommand(options);
  builtInDirectContextExecutors.add(def.execute);
  return def;
}

export function createLibreofficeCommand(options: SofficeCommandOptions = {}): CommandDefinition {
  syncCommandEvaluators.evalSyncSoffice = evalSyncSoffice;
  const def = createRawLibreofficeCommand(options);
  builtInDirectContextExecutors.add(def.execute);
  return def;
}

export function createSofficeCommands(options: SofficeCommandsOptions = {}): readonly CommandDefinition[] {
  syncCommandEvaluators.evalSyncSoffice = evalSyncSoffice;
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
  writeFileSync?: (filePath: string, bytes: Uint8Array) => boolean,
): string | undefined {
  try {
    let hasHelpOrVer = false;
    let hasCat = false;
    let hasConvertTo = false;
    for (let i = 0; i < opArgs.length; i++) {
      const a = opArgs[i]!;
      if (a === "--version" || a === "--help" || a === "-h") hasHelpOrVer = true;
      else if (a === "--cat" || a === "-cat") hasCat = true;
      else if (a === "--convert-to" || a.startsWith("--convert-to=")) hasConvertTo = true;
    }
    if (!hasHelpOrVer && !hasCat && !hasConvertTo) return undefined;
    const files = new Map<string, Uint8Array>();
    if (!hasHelpOrVer) {
      for (let i = 0; i < opArgs.length; i++) {
        const a = opArgs[i]!;
        if (a === "--convert-to" || a === "-convert-to" || a === "--outdir" || a === "-outdir" || a === "-o") {
          i++;
          continue;
        }
        if (a.startsWith("-")) continue;
        const b = readFileSync?.(a);
        if (!b || b.byteLength > 262144) return undefined;
        files.set(a, b);
        if (a.startsWith("/")) files.set(a, b);
      }
    }
    const snap = new Map(files);
    const res = runSofficeCliSync(opArgs, files);
    if (res.exitCode !== 0 || res.stderr) return undefined;
    for (const [k, v] of files.entries()) {
      if (snap.get(k) !== v) {
        if (!writeFileSync || !writeFileSync(k, v)) return undefined;
      }
    }
    return res.stdout;
  } catch {
    return undefined;
  }
}
