import { builtInDirectContextExecutors } from "../internal.js";
import type { CommandDefinition, VirtualShellPlugin } from "../../contracts/index.js";
import {
  createPdfinfoCommand as createRawPdfinfoCommand,
  createPdfinfoCommands as createRawPdfinfoCommands,
  inspectPdfBytes,
  type PdfinfoCommandOptions,
  type PdfinfoCommandsOptions,
} from "safe-bash-command-pdfinfo";

export * from "safe-bash-command-pdfinfo";

export function createPdfinfoCommand(options: PdfinfoCommandOptions = {}): CommandDefinition {
  const def = createRawPdfinfoCommand(options);
  builtInDirectContextExecutors.add(def.execute);
  return def;
}

export function createPdfinfoCommands(options: PdfinfoCommandsOptions = {}): readonly CommandDefinition[] {
  const defs = createRawPdfinfoCommands(options);
  for (let i = 0; i < defs.length; i++) builtInDirectContextExecutors.add(defs[i]!.execute);
  return defs;
}

export function pdfinfoCommands(options: PdfinfoCommandOptions = {}): VirtualShellPlugin {
  const commands = createPdfinfoCommands(options);
  const replace = options.replace ?? false;
  return {
    name: "pdfinfo",
    setup(host) {
      for (const command of commands) host.commands.register(command, { replace });
    },
  };
}

export function evalSyncPdfinfo(
  inBytes: Uint8Array | undefined,
  opArgs: readonly string[],
  readFileSync?: (filePath: string) => Uint8Array | undefined,
): string | undefined {
  try {
    let inputFile: string | undefined;
    let isHelpOrVer = false;
    for (let i = 0; i < opArgs.length; i++) {
      const a = opArgs[i]!;
      if (a === "-listenc" || a === "-v" || a === "--version" || a === "-h" || a === "--help" || a === "-?") {
        isHelpOrVer = true;
      } else if (a === "-f" || a === "-l" || a === "-enc" || a === "-upw" || a === "-opw") {
        i++;
      } else if (a === "--") {
        if (i + 1 < opArgs.length) inputFile = opArgs[i + 1];
        break;
      } else if (!a.startsWith("-") || a === "-") {
        if (inputFile === undefined) inputFile = a;
      }
    }
    if (isHelpOrVer) {
      const res = inspectPdfBytes(new Uint8Array(0), opArgs);
      if (res.exitCode !== 0 || res.stderr) return undefined;
      return res.stdout;
    }
    const target = inputFile ?? "-";
    const pdfBytes = target === "-" ? inBytes : readFileSync?.(target);
    if (!pdfBytes || pdfBytes.byteLength > 262144) return undefined;
    const res = inspectPdfBytes(
      pdfBytes,
      opArgs,
      target === "-" ? { isStdin: true, fileSize: 0 } : { fileSize: pdfBytes.byteLength },
    );
    if (res.exitCode !== 0 || res.stderr) return undefined;
    return res.stdout;
  } catch {
    return undefined;
  }
}
