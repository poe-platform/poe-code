import { builtInDirectContextExecutors, syncCommandEvaluators } from "../internal.js";
import type { CommandDefinition, VirtualShellPlugin } from "../../contracts/index.js";
import {
  createPandocCommand as createRawPandocCommand,
  createPandocCommands as createRawPandocCommands,
  inspectFormats,
  parseConversionArgs,
  convertSync,
  type PandocCommandsOptions,
} from "safe-bash-command-pandoc";

export * from "safe-bash-command-pandoc";

export function createPandocCommand(options: PandocCommandsOptions = {}, hasCommand?: (name: string) => boolean): CommandDefinition {
  const def = createRawPandocCommand(options, hasCommand);
  if (options.limits === undefined && options.filters === undefined && options.jsonFilterCommand === undefined && options.citeproc === undefined) {
    builtInDirectContextExecutors.add(def.execute);
  }
  return def;
}

export function createPandocCommands(options: PandocCommandsOptions = {}): readonly CommandDefinition[] {
  const defs = createRawPandocCommands(options);
  if (options.limits === undefined && options.filters === undefined && options.jsonFilterCommand === undefined && options.citeproc === undefined) {
    for (let i = 0; i < defs.length; i++) builtInDirectContextExecutors.add(defs[i]!.execute);
  }
  return defs;
}

export function pandocCommands(options: PandocCommandsOptions = {}): VirtualShellPlugin {
  let hasCommand: ((name: string) => boolean) | undefined;
  const command = createPandocCommand(options, name => hasCommand?.(name) ?? false);
  return {
    name: "pandoc",
    setup(host) {
      hasCommand = name => host.commands.has(name);
      host.commands.register(command, { replace: options.replace ?? false });
    },
  };
}

export function evalSyncPandoc(
  inBytes: Uint8Array | undefined,
  opArgs: readonly string[],
  readFileSync?: (filePath: string) => Uint8Array | undefined,
  writeFileSync?: (filePath: string, bytes: Uint8Array) => boolean,
): string | undefined {
  try {
    if (opArgs.length > 0 && opArgs.every((a) => a === "--list-input-formats" || a === "--list-output-formats")) {
      return inspectFormats(opArgs);
    }
    for (let i = 0; i < opArgs.length; i++) {
      const a = opArgs[i]!;
      if (a === "-d" || a === "--defaults" || a.startsWith("-d") || a.startsWith("--defaults=")) {
        return undefined;
      }
    }
    const signal = new AbortController().signal;
    const parsed = parseConversionArgs(
      opArgs,
      {
        cwd: "/",
        ...(inBytes === undefined ? {} : { stdin: [inBytes] }),
        readFile: async () => new Uint8Array(0),
        writeFile: async () => {},
      },
      signal,
    );
    const inputs: { bytes: Uint8Array; source?: string; base?: string }[] = [];
    if (!parsed.operands) {
      if (inBytes === undefined || inBytes.byteLength > 262144) return undefined;
      inputs.push({ bytes: inBytes });
    } else {
      for (const op of parsed.operands) {
        if (op.source === undefined) {
          if (inBytes === undefined || inBytes.byteLength > 262144) return undefined;
          inputs.push({ bytes: inBytes });
        } else {
          if (parsed.destination && op.source === parsed.destination) return undefined;
          const b = readFileSync?.(op.source);
          if (!b || b.byteLength > 262144) return undefined;
          inputs.push({ bytes: b, source: op.source, ...(op.base === undefined ? {} : { base: op.base }) });
        }
      }
    }
    const serialized = convertSync(inputs, parsed.options);
    if (!serialized) return undefined;
    if (parsed.destination !== undefined) {
      if (!writeFileSync) return undefined;
      const outBytes = serialized.kind === "binary" ? serialized.bytes : new TextEncoder().encode(serialized.text);
      if (!writeFileSync(parsed.destination, outBytes)) return undefined;
      return "";
    }
    if (serialized.kind === "text") {
      return serialized.text;
    }
    return new TextDecoder("utf-8", { fatal: true }).decode(serialized.bytes);
  } catch {
    return undefined;
  }
}

syncCommandEvaluators.evalSyncPandoc = evalSyncPandoc;
