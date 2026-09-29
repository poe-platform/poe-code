import { builtInDirectContextExecutors, syncCommandEvaluators } from "../internal.js";
import type { CommandDefinition, VirtualShellPlugin } from "../../contracts/index.js";
import {
  createPdfimagesCommand as createRawPdfimagesCommand,
  createPdfimagesCommands as createRawPdfimagesCommands,
  runPdfimagesCliSync,
  type PdfimagesCommandOptions,
  type PdfimagesCommandsOptions,
} from "safe-bash-command-pdfimages";

export * from "safe-bash-command-pdfimages";

export function createPdfimagesCommand(options: PdfimagesCommandOptions = {}): CommandDefinition {
  const def = createRawPdfimagesCommand(options);
  builtInDirectContextExecutors.add(def.execute);
  return def;
}

export function createPdfimagesCommands(options: PdfimagesCommandsOptions = {}): readonly CommandDefinition[] {
  const defs = createRawPdfimagesCommands(options);
  for (let i = 0; i < defs.length; i++) builtInDirectContextExecutors.add(defs[i]!.execute);
  return defs;
}

export function pdfimagesPlugin(options: PdfimagesCommandOptions = {}): VirtualShellPlugin {
  const command = createPdfimagesCommand(options);
  const replace = options.replace ?? false;
  return {
    name: "pdfimages",
    setup(host) {
      host.commands.register(command, { replace });
    },
  };
}

export const pdfimagesCommands = pdfimagesPlugin;

export function evalSyncPdfimages(
  inBytes: Uint8Array | undefined,
  opArgs: readonly string[],
  readFileSync?: (filePath: string) => Uint8Array | undefined,
): string | undefined {
  try {
    const files = new Map<string, Uint8Array>();
    if (inBytes !== undefined) files.set("-", inBytes);
    for (let i = 0; i < opArgs.length; i++) {
      const a = opArgs[i]!;
      if (a === "-f" || a === "-l" || a === "-upw" || a === "-opw") {
        i++;
      } else if (!a.startsWith("-") && a !== "-") {
        const b = readFileSync?.(a);
        if (b) {
          if (b.byteLength > 262144) return undefined;
          files.set(a, b);
        }
      }
    }
    const snap = new Map(files);
    const res = runPdfimagesCliSync(opArgs, files);
    if (res.exitCode !== 0 || res.stderr) return undefined;
    for (const [k, v] of files.entries()) {
      if (snap.get(k) !== v) return undefined;
    }
    return res.stdout;
  } catch {
    return undefined;
  }
}

syncCommandEvaluators.evalSyncPdfimages = evalSyncPdfimages;
