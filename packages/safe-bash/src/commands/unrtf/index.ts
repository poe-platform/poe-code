import {
  renderRtfSync,
  type UnrtfOptions,
  createUnrtfCommand as createRawUnrtfCommand,
  createUnrtfCommands as createRawUnrtfCommands,
  type UnrtfCommandsOptions,
} from "safe-bash-command-unrtf";
import type { CommandDefinition, VirtualShellPlugin } from "../../contracts/index.js";
import { registerDefaultExecutor, registerDefaultExecutors } from "../internal.js";
export * from "safe-bash-command-unrtf";

export function createUnrtfCommand(options: UnrtfCommandsOptions = {}): CommandDefinition {
  return registerDefaultExecutor(createRawUnrtfCommand(options), options);
}

export function createUnrtfCommands(options: UnrtfCommandsOptions = {}): readonly CommandDefinition[] {
  return registerDefaultExecutors(createRawUnrtfCommands(options), options);
}

export function unrtfCommands(options: UnrtfCommandsOptions = {}): VirtualShellPlugin {
  const commands = createUnrtfCommands(options);
  const replace = options.replace ?? false;
  return {
    name: "unrtf",
    setup(host) {
      if (!replace) {
        for (const command of commands) {
          if (host.commands.has(command.name)) throw new Error(`Command already registered: ${command.name}`);
        }
      }
      for (const command of commands) host.commands.register(command, { replace });
    },
  };
}
let _syncUnrtfSignal: AbortSignal | undefined;
const syncUnrtfSignal = (): AbortSignal => (_syncUnrtfSignal ??= new AbortController().signal);
const syncUnrtfDecoder = new TextDecoder("latin1");
const unrtfCache = new Map<string, string>();

export function evalSyncUnrtf(
  inBytes: Uint8Array | undefined,
  opArgs: readonly string[],
  readFileSync?: (path: string) => Uint8Array | undefined,
): string | undefined {
  let format: "text" | "html" | "latex" = "html";
  let profile: UnrtfOptions["profile"];
  let quiet: boolean | undefined;
  let noremap: boolean | undefined;
  let file: string | undefined;
  let literal = false;
  for (let i = 0; i < opArgs.length; i++) {
    const arg = opArgs[i]!;
    if (literal) {
      if (file !== undefined) return undefined;
      file = arg;
    } else if (arg === "--") literal = true;
    else if (arg === "--text") format = "text";
    else if (arg === "--html") format = "html";
    else if (arg === "--latex") format = "latex";
    else if (arg.startsWith("--profile=")) profile = arg.slice("--profile=".length) as UnrtfOptions["profile"];
    else if (arg === "--quiet") quiet = true;
    else if (arg === "--noremap") noremap = true;
    else if (arg === "--nopict" || arg === "-n") continue;
    else if (arg.startsWith("-")) return undefined;
    else {
      if (file !== undefined) return undefined;
      file = arg;
    }
  }
  let srcBytes = inBytes;
  if (file !== undefined) {
    if (!readFileSync || file.includes("\0")) return undefined;
    srcBytes = readFileSync(file) ?? readFileSync(file + ".rtf");
  }
  if (!srcBytes || srcBytes.byteLength === 0 || srcBytes.byteLength > 16384) return undefined;
  let rawKey = "";
  for (let i = 0; i < srcBytes.byteLength; i++) rawKey += String.fromCharCode(srcBytes[i]!);
  const cacheKey = `${format}|\x00${profile ?? ""}|\x00${quiet ? 1 : 0}|\x00${noremap ? 1 : 0}|\x00${rawKey}`;
  const cached = unrtfCache.get(cacheKey);
  if (cached !== undefined) return cached;
  try {
    const out = renderRtfSync(srcBytes, {
      format,
      signal: syncUnrtfSignal(),
      ...(quiet === undefined ? {} : { quiet }),
      ...(noremap === undefined ? {} : { noremap }),
      ...(profile === undefined ? {} : { profile }),
    });
    if (out.includes("\0")) return undefined;
    if (unrtfCache.size >= 8) unrtfCache.clear();
    unrtfCache.set(cacheKey, out);
    return out;
  } catch {
    return undefined;
  }
}

import { syncCommandEvaluators } from "../internal.js";
syncCommandEvaluators.evalSyncUnrtf = evalSyncUnrtf;
