import { builtInDirectContextExecutors, syncCommandEvaluators } from "../internal.js";
import type { CommandDefinition, VirtualShellPlugin } from "../../contracts/index.js";
import {
  createPdftotextCommand as createRawPdftotextCommand,
  createPdftotextCommands as createRawPdftotextCommands,
  extractPdfToTextBytes,
  runPdftohtmlCliSync,
  type PdftotextCommandOptions,
  type PdftotextCommandsOptions,
} from "safe-bash-command-pdftotext";

export * from "safe-bash-command-pdftotext";

function isDefaultPdftotextOptions(options?: PdftotextCommandOptions): boolean {
  if (!options) return true;
  const o = options as { readonly limits?: unknown; readonly maxInputBytes?: unknown; readonly maxOutputBytes?: unknown };
  return o.limits === undefined && o.maxInputBytes === undefined && o.maxOutputBytes === undefined;
}

export function createPdftotextCommand(options: PdftotextCommandOptions = {}): CommandDefinition {
  const def = createRawPdftotextCommand(options);
  if (isDefaultPdftotextOptions(options)) builtInDirectContextExecutors.add(def.execute);
  return def;
}

export function createPdftotextCommands(options: PdftotextCommandsOptions = {}): readonly CommandDefinition[] {
  const defs = createRawPdftotextCommands(options);
  if (isDefaultPdftotextOptions(options)) {
    for (let i = 0; i < defs.length; i++) builtInDirectContextExecutors.add(defs[i]!.execute);
  }
  return defs;
}

export function pdftotextCommands(options: PdftotextCommandsOptions = {}): VirtualShellPlugin {
  const commands = createPdftotextCommands(options);
  const replace = options.replace ?? false;
  return {
    name: "pdftotext",
    setup(host) {
      for (const command of commands) host.commands.register(command, { replace });
    },
  };
}

export function evalSyncPdftotext(
  inBytes: Uint8Array | undefined,
  opArgs: readonly string[],
  readFileSync?: (filePath: string) => Uint8Array | undefined,
): string | undefined {
  try {
    const positionals: string[] = [];
    let isHelpOrVer = false;
    for (let i = 0; i < opArgs.length; i++) {
      const a = opArgs[i]!;
      if (a === "-listenc" || a === "-v" || a === "--version" || a === "-h" || a === "--help" || a === "-?") {
        isHelpOrVer = true;
      } else if (
        a === "-f" || a === "-l" || a === "-r" || a === "-x" || a === "-y" ||
        a === "-W" || a === "-H" || a === "-fixed" || a === "-enc" ||
        a === "-eol" || a === "-opw" || a === "-upw"
      ) {
        i++;
      } else if (a === "--") {
        positionals.push(...opArgs.slice(i + 1));
        break;
      } else if (!a.startsWith("-") || a === "-") {
        positionals.push(a);
      }
    }
    if (isHelpOrVer) {
      const res = extractPdfToTextBytes(new Uint8Array(0), opArgs);
      if (res.exitCode !== 0 || res.stderr) return undefined;
      return res.output;
    }
    const target = positionals[0] ?? "-";
    const outTarget = positionals[1] ?? (target === "-" ? "-" : undefined);
    if (outTarget !== "-") return undefined;
    const pdfBytes = target === "-" ? inBytes : readFileSync?.(target);
    if (!pdfBytes || pdfBytes.byteLength > 262144) return undefined;
    const res = extractPdfToTextBytes(pdfBytes, opArgs);
    if (res.exitCode !== 0 || res.stderr || res.outputPath !== "-") return undefined;
    return res.output;
  } catch {
    return undefined;
  }
}

export function evalSyncPdftohtml(
  inBytes: Uint8Array | undefined,
  opArgs: readonly string[],
  readFileSync?: (filePath: string) => Uint8Array | undefined,
): string | undefined {
  try {
    const files = new Map<string, Uint8Array>();
    if (inBytes !== undefined) files.set("-", inBytes);
    for (let i = 0; i < opArgs.length; i++) {
      const a = opArgs[i]!;
      if (["-f", "-l", "-zoom", "-fmt", "-enc", "-upw", "-opw"].includes(a)) {
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
    const res = runPdftohtmlCliSync(opArgs, files);
    if (res.exitCode !== 0 || res.stderr) return undefined;
    for (const [k, v] of files.entries()) {
      if (snap.get(k) !== v) return undefined;
    }
    return res.stdout;
  } catch {
    return undefined;
  }
}

syncCommandEvaluators.evalSyncPdftotext = evalSyncPdftotext;
syncCommandEvaluators.evalSyncPdftohtml = evalSyncPdftohtml;
