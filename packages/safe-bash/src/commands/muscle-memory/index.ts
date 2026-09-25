import type { CommandDefinition, VirtualShellPlugin } from "../../contracts/index.js";
import { createBcCommand, bcCommands, type BcCommandOptions } from "./bc.js";
import { createSpongeCommand, spongeCommands, type SpongeCommandOptions } from "./sponge.js";
import { createFdCommand, fdCommands, type FdCommandOptions } from "./fd.js";
import { createLessCommand, createMoreCommand, createPagerCommands, pagerCommands, type PagerCommandsOptions } from "./pager.js";

export {
  createBcCommand,
  bcCommands,
  type BcCommandOptions,
  createSpongeCommand,
  spongeCommands,
  type SpongeCommandOptions,
  createFdCommand,
  fdCommands,
  type FdCommandOptions,
  createLessCommand,
  createMoreCommand,
  createPagerCommands,
  pagerCommands,
  type PagerCommandsOptions,
};

export interface MuscleMemoryCommandsOptions {
  readonly bc?: Omit<BcCommandOptions, "replace">;
  readonly sponge?: Omit<SpongeCommandOptions, "replace">;
  readonly fd?: Omit<FdCommandOptions, "replace">;
  readonly replace?: boolean;
}

let defaultMuscleMemoryCommands: readonly CommandDefinition[] | undefined;

export function createMuscleMemoryCommands(options: MuscleMemoryCommandsOptions = {}): readonly CommandDefinition[] {
  if (!options.bc && !options.sponge && !options.fd) {
    return defaultMuscleMemoryCommands ??= Object.freeze([
      createBcCommand(),
      createSpongeCommand(),
      createFdCommand(),
      ...createPagerCommands(),
    ]);
  }
  return [
    createBcCommand(options.bc),
    createSpongeCommand(options.sponge),
    createFdCommand(options.fd),
    ...createPagerCommands(),
  ];
}

export function muscleMemoryCommands(options: MuscleMemoryCommandsOptions = {}): VirtualShellPlugin {
  const commands = createMuscleMemoryCommands(options);
  return {
    name: "muscle-memory-commands",
    setup(host) {
      if (!options.replace) {
        for (const command of commands) {
          if (host.commands.has(command.name)) throw new Error(`Command already registered: ${command.name}`);
        }
      }
      for (const command of commands) host.commands.register(command, { replace: options.replace ?? false });
    },
  };
}
