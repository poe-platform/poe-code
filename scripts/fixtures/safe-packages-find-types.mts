import { createFindCommand, createFindCommands, findCommands, type FindLimits, type FindCommandsOptions } from "@poe-platform/safe-bash";
import { createFindCommand as subpath } from "@poe-platform/safe-bash/commands/find";
import type { CommandDefinition } from "@poe-platform/safe-bash/contracts/command";
const limits: Partial<FindLimits> = { maxDirectoryEntries: 128 };
const options: FindCommandsOptions = { limits, replace: true };
const commands: readonly CommandDefinition[] = [createFindCommand(options), subpath(options), ...createFindCommands(options)];
void [commands, findCommands(options)];
