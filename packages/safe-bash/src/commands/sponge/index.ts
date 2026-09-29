import {
  createSpongeCommand as createRawSpongeCommand,
  createSpongeCommands as createRawSpongeCommands,
  spongeCommands as rawSpongeCommands,
  settings,
  type SpongeCommandsOptions,
  type SpongeLimits,
  type SpongeOptions,
} from "safe-bash-command-sponge";
import type { CommandDefinition, VirtualShellPlugin } from "../../contracts/index.js";
import { builtInDirectContextExecutors, isDefaultCommandOptions, decoder, syncCommandEvaluators } from "../internal.js";

export { settings, type SpongeCommandsOptions, type SpongeLimits, type SpongeOptions };

export function evalSyncSponge(
  inBytes: Uint8Array | undefined,
  opArgs: readonly string[],
  readFileSync?: (filePath: string) => Uint8Array | undefined,
  writeFileSync?: (filePath: string, bytes: Uint8Array) => boolean,
): string | undefined {
  let append = false;
  const files: string[] = [];
  let endOfOptions = false;
  for (const arg of opArgs) {
    if (!endOfOptions && arg === "--") {
      endOfOptions = true;
      continue;
    }
    if (!endOfOptions && arg === "--append") { append = true; continue; }
    if (!endOfOptions && (arg === "--help" || arg === "-h")) {
      return "Usage: sponge [-a] [FILE]\nSoak up standard input and write to FILE (or stdout).\n";
    }
    if (!endOfOptions && arg === "--version") {
      return "sponge (virtual-bash)\n";
    }
    if (!endOfOptions && arg.startsWith("-") && arg.length > 1) {
      for (let i = 1; i < arg.length; i++) {
        if (arg[i] === "a") append = true;
        else return undefined;
      }
      continue;
    }
    files.push(arg);
  }
  if (files.length > 1) return undefined;
  const payload = inBytes ?? new Uint8Array(0);
  if (files.length === 0 || files[0] === "-") return decoder.decode(payload);
  if (!writeFileSync) return undefined;
  const target = files[0]!;
  if (append) {
    const existing = readFileSync?.(target) ?? new Uint8Array(0);
    const combined = new Uint8Array(existing.length + payload.length);
    combined.set(existing, 0);
    combined.set(payload, existing.length);
    if (!writeFileSync(target, combined)) return undefined;
  } else {
    if (!writeFileSync(target, payload)) return undefined;
  }
  return "";
}

syncCommandEvaluators.evalSyncSponge = evalSyncSponge;

export function createSpongeCommand(options: SpongeCommandsOptions = {}): CommandDefinition {
  const def = createRawSpongeCommand(options);
  if (isDefaultCommandOptions(options)) builtInDirectContextExecutors.add(def.execute);
  return def;
}

export function createSpongeCommands(options: SpongeCommandsOptions = {}): readonly CommandDefinition[] {
  return createRawSpongeCommands(options).map(def => {
    if (isDefaultCommandOptions(options)) builtInDirectContextExecutors.add(def.execute);
    return def;
  });
}

export function spongeCommands(options: SpongeCommandsOptions = {}): VirtualShellPlugin {
  const plugin = rawSpongeCommands(options);
  return {
    ...plugin,
    setup(host) {
      for (const def of createSpongeCommands(options)) {
        if (!options.replace && host.commands.has(def.name)) throw new Error(`Command already registered: ${def.name}`);
        host.commands.register(def, { replace: options.replace ?? false });
      }
    },
  };
}
