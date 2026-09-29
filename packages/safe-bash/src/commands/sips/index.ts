import { builtInDirectContextExecutors, syncCommandEvaluators } from "../internal.js";
import type { CommandDefinition, VirtualShellPlugin } from "../../contracts/index.js";
import {
  createSipsCommand as createRawSipsCommand,
  createSipsCommands as createRawSipsCommands,
  runSipsCliSync,
  type SipsCommandOptions,
  type SipsCommandsOptions,
} from "safe-bash-command-sips";

export * from "safe-bash-command-sips";

export function createSipsCommand(options: SipsCommandOptions = {}): CommandDefinition {
  syncCommandEvaluators.evalSyncSips = evalSyncSips;
  const def = createRawSipsCommand(options);
  builtInDirectContextExecutors.add(def.execute);
  return def;
}

export function createSipsCommands(options: SipsCommandsOptions = {}): readonly CommandDefinition[] {
  syncCommandEvaluators.evalSyncSips = evalSyncSips;
  const defs = createRawSipsCommands(options);
  for (let i = 0; i < defs.length; i++) builtInDirectContextExecutors.add(defs[i]!.execute);
  return defs;
}

export function sipsPlugin(options: SipsCommandOptions = {}): VirtualShellPlugin {
  const command = createSipsCommand(options);
  const replace = options.replace ?? false;
  return {
    name: "sips",
    setup(host) {
      host.commands.register(command, { replace });
    },
  };
}

export const sipsCommands = sipsPlugin;

export function evalSyncSips(
  inBytes: Uint8Array | undefined,
  opArgs: readonly string[],
  readFileSync?: (filePath: string) => Uint8Array | undefined,
  writeFileSync?: (filePath: string, bytes: Uint8Array) => boolean,
): string | undefined {
  try {
    const files = new Map<string, Uint8Array>();
    if (inBytes !== undefined) files.set("-", inBytes);
    for (let i = 0; i < opArgs.length; i++) {
      const a = opArgs[i]!;
      if (["-g", "--getProperty", "-s", "--setProperty", "-d", "--deleteProperty", "-r", "--rotate", "-f", "--flip", "-c", "--cropToHeightWidth", "-Z", "--resampleHeightWidthMax", "-z", "--resampleHeightWidth", "--resampleWidth", "--resampleHeight", "-p", "--padToHeightWidth", "--padColor", "-o", "--out"].includes(a)) {
        if (a === "-s" || a === "--setProperty" || a === "-c" || a === "--cropToHeightWidth" || a === "-z" || a === "--resampleHeightWidth" || a === "-p" || a === "--padToHeightWidth") {
          i += 2;
        } else {
          i += 1;
        }
      } else if (!a.startsWith("-") && a !== "-") {
        const b = readFileSync?.(a);
        if (b) {
          if (b.byteLength > 262144) return undefined;
          files.set(a, b);
        }
      }
    }
    const snap = new Map(files);
    const res = runSipsCliSync(opArgs, files);
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
