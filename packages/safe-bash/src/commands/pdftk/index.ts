import { builtInDirectContextExecutors } from "../internal.js";
import type { CommandDefinition, VirtualShellPlugin } from "../../contracts/index.js";
import {
  createPdftkCommand as createRawPdftkCommand,
  createPdftkCommands as createRawPdftkCommands,
  runPdftkCliSync,
  type PdftkCommandOptions,
  type PdftkCommandsOptions,
} from "safe-bash-command-pdftk";

export * from "safe-bash-command-pdftk";

function isDefaultPdftkOptions(options?: PdftkCommandOptions): boolean {
  if (!options) return true;
  const o = options as { readonly limits?: unknown; readonly maxInputBytes?: unknown; readonly maxOutputBytes?: unknown };
  return o.limits === undefined && o.maxInputBytes === undefined && o.maxOutputBytes === undefined;
}

export function createPdftkCommand(options: PdftkCommandOptions = {}): CommandDefinition {
  const def = createRawPdftkCommand(options);
  if (isDefaultPdftkOptions(options)) builtInDirectContextExecutors.add(def.execute);
  return def;
}

export function createPdftkCommands(options: PdftkCommandsOptions = {}): readonly CommandDefinition[] {
  const defs = createRawPdftkCommands(options);
  if (isDefaultPdftkOptions(options)) {
    for (let i = 0; i < defs.length; i++) builtInDirectContextExecutors.add(defs[i]!.execute);
  }
  return defs;
}

export function pdftkPlugin(options: PdftkCommandOptions = {}): VirtualShellPlugin {
  const command = createPdftkCommand(options);
  const replace = options.replace ?? false;
  return {
    name: "pdftk",
    setup(host) {
      host.commands.register(command, { replace });
    },
  };
}

export const pdftkCommands = pdftkPlugin;

export function evalSyncPdftk(
  inBytes: Uint8Array | undefined,
  opArgs: readonly string[],
  readFileSync?: (filePath: string) => Uint8Array | undefined,
): string | undefined {
  try {
    const files = new Map<string, Uint8Array>();
    if (inBytes !== undefined) files.set("-", inBytes);
    for (const token of opArgs) {
      if (token.startsWith("-") && token !== "-") continue;
      const eq = token.indexOf("=");
      const filePath = eq > 0 ? token.slice(eq + 1) : token;
      if (filePath === "-") continue;
      const b = readFileSync?.(filePath);
      if (b) {
        if (b.byteLength > 262144) return undefined;
        files.set(filePath, b);
      }
    }
    const snap = new Map(files);
    const res = runPdftkCliSync(opArgs, files);
    if (res.exitCode !== 0 || res.stderr || res.stdoutBytes) return undefined;
    for (const [k, v] of files.entries()) {
      if (snap.get(k) !== v) return undefined;
    }
    return res.stdout;
  } catch {
    return undefined;
  }
}
