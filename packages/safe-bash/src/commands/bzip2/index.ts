import {
  createBzip2Command as createBaseBzip2Command,
  createBunzip2Command as createBaseBunzip2Command,
  createBzcatCommand as createBaseBzcatCommand,
  createBzip2Commands as createBaseBzip2Commands,
  type Bzip2CommandsOptions,
  type Bzip2Limits,
  type Bzip2Options,
  type CompressionCommandOptions,
  settings,
} from "safe-bash-command-bzip2";
import { builtInDirectContextExecutors } from "../internal.js";
import type { CommandDefinition, VirtualShellPlugin } from "../../contracts/index.js";

export { settings };
export type { Bzip2CommandsOptions, Bzip2Limits, Bzip2Options, CompressionCommandOptions };

function isDefaultBzip2Options(options?: Bzip2CommandsOptions): boolean {
  return options === undefined || (options.maxDecodedBytes === undefined && options.limits?.maxDecodedBytes === undefined);
}

export function createBzip2Command(options: Bzip2CommandsOptions = {}): CommandDefinition {
  const def = createBaseBzip2Command(options);
  if (isDefaultBzip2Options(options)) builtInDirectContextExecutors.add(def.execute);
  return def;
}

export function createBunzip2Command(options: Bzip2CommandsOptions = {}): CommandDefinition {
  const def = createBaseBunzip2Command(options);
  if (isDefaultBzip2Options(options)) builtInDirectContextExecutors.add(def.execute);
  return def;
}

export function createBzcatCommand(options: Bzip2CommandsOptions = {}): CommandDefinition {
  const def = createBaseBzcatCommand(options);
  if (isDefaultBzip2Options(options)) builtInDirectContextExecutors.add(def.execute);
  return def;
}

export function createBzip2Commands(options: Bzip2CommandsOptions = {}): readonly CommandDefinition[] {
  const defs = createBaseBzip2Commands(options);
  if (isDefaultBzip2Options(options)) {
    for (const def of defs) builtInDirectContextExecutors.add(def.execute);
  }
  return defs;
}

export function bzip2Commands(options: Bzip2CommandsOptions = {}): VirtualShellPlugin {
  const commands = createBzip2Commands(options);
  return {
    name: "bzip2-commands",
    setup(host) {
      if (!options.replace) {
        for (const command of commands) {
          if (host.commands.has(command.name)) throw new Error(`Command already registered: ${command.name}`);
        }
      }
      for (const command of commands) {
        host.commands.register(command, { replace: options.replace ?? false });
      }
    },
  };
}
