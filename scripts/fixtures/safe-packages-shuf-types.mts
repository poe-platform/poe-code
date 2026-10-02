import { createShufCommand, type CommandDefinition } from "@poe-platform/safe-bash";
import { createShufCommand as command, createShufCommands, shufCommands, type ShufLimits, type ShufCommandsOptions } from "@poe-platform/safe-bash/commands/shuf";
import { createShufCommand as legacy } from "@poe-platform/safe-bash/shuf";

const limits: ShufLimits = { maxInputBytes: 1024, maxSampleSize: 10 };
const options: ShufCommandsOptions = { limits, replace: true };
const factory: typeof createShufCommand = command;
const legacyFactory: typeof command = legacy;
const definition: CommandDefinition = factory(options);
void [definition, legacyFactory(options), createShufCommands(options), shufCommands(options)];
