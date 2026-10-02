import {
  createLessCommand as createRawLessCommand,
  createMoreCommand as createRawMoreCommand,
  createLessCommands as createRawLessCommands,
  createPagerCommands as createRawPagerCommands,
  type LessCommandsOptions,
  type PagerCommandsOptions,
} from "safe-bash-command-less";
import type { CommandDefinition, VirtualShellPlugin } from "../../contracts/index.js";
import { registerDefaultExecutor, registerDefaultExecutors } from "../internal.js";

export * from "safe-bash-command-less";

export function createLessCommand(options: LessCommandsOptions = {}): CommandDefinition {
  return registerDefaultExecutor(createRawLessCommand(options), options);
}

export function createMoreCommand(options: LessCommandsOptions = {}): CommandDefinition {
  return registerDefaultExecutor(createRawMoreCommand(options), options);
}

export function createLessCommands(options: LessCommandsOptions = {}): readonly CommandDefinition[] {
  return registerDefaultExecutors(createRawLessCommands(options), options);
}

export function createPagerCommands(options: PagerCommandsOptions = {}): readonly CommandDefinition[] {
  return registerDefaultExecutors(createRawPagerCommands(options), options);
}

export function lessCommands(options: LessCommandsOptions = {}): VirtualShellPlugin {
  const commands = createLessCommands(options);
  const replace = options.replace ?? false;
  return {
    name: "less-commands",
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

export function pagerCommands(options: PagerCommandsOptions = {}): VirtualShellPlugin {
  return lessCommands(options);
}

import { syncCommandEvaluators } from "../internal.js";
import { evalSyncLess } from "safe-bash-command-less";
syncCommandEvaluators.evalSyncLess = evalSyncLess;
