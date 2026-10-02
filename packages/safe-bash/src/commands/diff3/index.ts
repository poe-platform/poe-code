import {
  compareDiff3,
  diff3DefaultLimits,
  parseDiff3Arguments,
  createDiff3Command as createRawDiff3Command,
  createDiff3Commands as createRawDiff3Commands,
  type Diff3CommandsOptions,
} from "safe-bash-command-diff3";
import type { CommandDefinition, VirtualShellPlugin } from "../../contracts/index.js";
import { registerDefaultExecutor, registerDefaultExecutors } from "../internal.js";
export * from "safe-bash-command-diff3";

export function createDiff3Command(options: Diff3CommandsOptions = {}): CommandDefinition {
  return registerDefaultExecutor(createRawDiff3Command(options), options);
}

export function createDiff3Commands(options: Diff3CommandsOptions = {}): readonly CommandDefinition[] {
  return registerDefaultExecutors(createRawDiff3Commands(options), options);
}

export function diff3Commands(options: Diff3CommandsOptions = {}): VirtualShellPlugin {
  const commands = createDiff3Commands(options);
  const replace = options.replace ?? false;
  return {
    name: "diff3-commands",
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
let _syncDiff3Signal: AbortSignal | undefined;
const syncDiff3Signal = (): AbortSignal => (_syncDiff3Signal ??= new AbortController().signal);
const syncDiff3Decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });

export function evalSyncDiff3(
  inBytes: Uint8Array | undefined,
  opArgs: readonly string[],
  readFileSync?: (path: string) => Uint8Array | undefined,
): string | undefined {
  try {
    const options = parseDiff3Arguments([...opArgs], diff3DefaultLimits);
    if (options.information !== undefined || options.files.length !== 3) return undefined;
    const inputs: Uint8Array[] = [];
    let stdinUsed = false;
    for (const file of options.files) {
      let srcBytes: Uint8Array | undefined;
      if (file === "-") {
        if (stdinUsed || !inBytes) return undefined;
        stdinUsed = true;
        srcBytes = inBytes;
      } else {
        if (!readFileSync) return undefined;
        srcBytes = readFileSync(file);
      }
      if (!srcBytes || srcBytes.byteLength > 16384) return undefined;
      inputs.push(srcBytes);
    }
    const rendered = compareDiff3(inputs, options, diff3DefaultLimits, syncDiff3Signal());
    if (rendered.exitCode !== 0 || rendered.stderr.byteLength !== 0 || rendered.stdout.includes(0)) return undefined;
    return syncDiff3Decoder.decode(rendered.stdout);
  } catch {
    return undefined;
  }
}

import { syncCommandEvaluators } from "../internal.js";
syncCommandEvaluators.evalSyncDiff3 = evalSyncDiff3;
