import { builtInDirectContextExecutors, syncCommandEvaluators } from "../internal.js";
import type { CommandDefinition, VirtualShellPlugin } from "../../contracts/index.js";
import {
  createQpdfCommand as createRawQpdfCommand,
  createQpdfCommands as createRawQpdfCommands,
  runQpdfCliSync,
  type QpdfCommandOptions,
  type QpdfCommandsOptions,
} from "safe-bash-command-qpdf";

export * from "safe-bash-command-qpdf";

export function createQpdfCommand(options: QpdfCommandOptions = {}): CommandDefinition {
  syncCommandEvaluators.evalSyncQpdf = evalSyncQpdf;
  const def = createRawQpdfCommand(options);
  builtInDirectContextExecutors.add(def.execute);
  return def;
}

export function createQpdfCommands(options: QpdfCommandsOptions = {}): readonly CommandDefinition[] {
  syncCommandEvaluators.evalSyncQpdf = evalSyncQpdf;
  const defs = createRawQpdfCommands(options);
  for (let i = 0; i < defs.length; i++) builtInDirectContextExecutors.add(defs[i]!.execute);
  return defs;
}

export function qpdfCommands(options: QpdfCommandsOptions = {}): VirtualShellPlugin {
  const commands = createQpdfCommands(options);
  const replace = options.replace ?? false;
  return {
    name: "qpdf",
    setup(host) {
      for (const command of commands) host.commands.register(command, { replace });
    },
  };
}

export function evalSyncQpdf(
  inBytes: Uint8Array | undefined,
  opArgs: readonly string[],
  readFileSync?: (filePath: string) => Uint8Array | undefined,
  writeFileSync?: (filePath: string, bytes: Uint8Array) => boolean,
): string | undefined {
  try {
    const files = new Map<string, Uint8Array>();
    if (inBytes !== undefined) files.set("-", inBytes);
    for (const token of opArgs) {
      if (token.startsWith("-") && token !== "-") continue;
      if (token === "--") continue;
      const b = readFileSync?.(token);
      if (b) {
        if (b.byteLength > 262144) return undefined;
        files.set(token, b);
      }
    }
    const snap = new Map(files);
    const res = runQpdfCliSync(opArgs, files);
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
