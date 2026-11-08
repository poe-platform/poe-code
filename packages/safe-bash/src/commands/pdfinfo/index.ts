import { createPdftocairoCommand as createRawPdftocairoCommand } from "safe-bash-command-pdftoppm";
import { builtInDirectContextExecutors, syncCommandEvaluators } from "../internal.js";
import type { CommandDefinition, VirtualShellPlugin } from "../../contracts/index.js";
import {
  createPdfinfoCommand as createRawPdfinfoCommand,
  createPdfinfoCommands as createRawPdfinfoCommands,
  createPdffontsCommand as createRawPdffontsCommand,
  createPdfdetachCommand as createRawPdfdetachCommand,
  inspectPdfBytes,
  runPdffontsCliSync,
  runPdfdetachCliSync,
  type PdfinfoCommandOptions,
  type PdfinfoCommandsOptions,
} from "safe-bash-command-pdfinfo";

export * from "safe-bash-command-pdfinfo";

export function createPdfinfoCommand(options: PdfinfoCommandOptions = {}): CommandDefinition {
  syncCommandEvaluators.evalSyncPdfinfo = evalSyncPdfinfo;
  syncCommandEvaluators.evalSyncPdffonts = evalSyncPdffonts;
  syncCommandEvaluators.evalSyncPdfdetach = evalSyncPdfdetach;
  const def = createRawPdfinfoCommand(options);
  builtInDirectContextExecutors.add(def.execute);
  return def;
}

export function createPdffontsCommand(options: PdfinfoCommandOptions = {}): CommandDefinition {
  syncCommandEvaluators.evalSyncPdfinfo = evalSyncPdfinfo;
  syncCommandEvaluators.evalSyncPdffonts = evalSyncPdffonts;
  syncCommandEvaluators.evalSyncPdfdetach = evalSyncPdfdetach;
  const def = createRawPdffontsCommand(options);
  builtInDirectContextExecutors.add(def.execute);
  return def;
}

export function createPdfdetachCommand(options: PdfinfoCommandOptions = {}): CommandDefinition {
  syncCommandEvaluators.evalSyncPdfinfo = evalSyncPdfinfo;
  syncCommandEvaluators.evalSyncPdffonts = evalSyncPdffonts;
  syncCommandEvaluators.evalSyncPdfdetach = evalSyncPdfdetach;
  const def = createRawPdfdetachCommand(options);
  builtInDirectContextExecutors.add(def.execute);
  return def;
}

export function createPdftocairoCommand(options: PdfinfoCommandOptions = {}): CommandDefinition {
  syncCommandEvaluators.evalSyncPdfinfo = evalSyncPdfinfo;
  syncCommandEvaluators.evalSyncPdffonts = evalSyncPdffonts;
  syncCommandEvaluators.evalSyncPdfdetach = evalSyncPdfdetach;
  const def = createRawPdftocairoCommand(options);
  builtInDirectContextExecutors.add(def.execute);
  return def;
}

export function createPdfinfoCommands(options: PdfinfoCommandsOptions = {}): readonly CommandDefinition[] {
  syncCommandEvaluators.evalSyncPdfinfo = evalSyncPdfinfo;
  syncCommandEvaluators.evalSyncPdffonts = evalSyncPdffonts;
  syncCommandEvaluators.evalSyncPdfdetach = evalSyncPdfdetach;
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
      if (a === "-listenc" || a === "-v" || a === "--version" || a === "-h" || a === "-help" || a === "--help" || a === "-?") {
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
      if (res.exitCode !== 0 || res.stderr || res.stdout.includes("\0")) return undefined;
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
    if (res.exitCode !== 0 || res.stderr || res.stdout.includes("\0")) return undefined;
    return res.stdout;
  } catch {
    return undefined;
  }
}

export function evalSyncPdffonts(
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
        if (!b || b.byteLength > 262144) return undefined;
        files.set(a, b);
      }
    }
    const res = runPdffontsCliSync(opArgs, files);
    if (res.exitCode !== 0 || res.stderr || res.stdout.includes("\0")) return undefined;
    return res.stdout;
  } catch {
    return undefined;
  }
}

export function evalSyncPdfdetach(
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
      if (a === "-upw" || a === "-opw" || a === "-enc" || a === "-save" || a === "-savefile" || a === "-o") {
        i++;
      } else if (!a.startsWith("-") && a !== "-") {
        const b = readFileSync?.(a);
        if (!b || b.byteLength > 262144) return undefined;
        files.set(a, b);
      }
    }
    const snap = new Map(files);
    const res = runPdfdetachCliSync(opArgs, files);
    if (res.exitCode !== 0 || res.stderr || res.stdout.includes("\0")) return undefined;
    for (const [k, v] of files.entries()) {
      if (snap.get(k) !== v) {
        if (k === "-" || k.endsWith("/") || /(?:^|\/)\.\.(?:\/|$)/.test(k) || !writeFileSync) return undefined;
      }
    }
    for (const [k, v] of files.entries()) {
      if (snap.get(k) !== v) {
        if (!writeFileSync!(k, v)) return undefined;
      }
    }
    return res.stdout;
  } catch {
    return undefined;
  }
}
