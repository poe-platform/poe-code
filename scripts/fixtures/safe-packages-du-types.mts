import { createDuCommand, createDuCommands, duCommands, type DuLimits, type DuCommandsOptions } from "@poe-platform/safe-bash";
import { createDuCommand as subpath, type DuLimits as SubpathLimits } from "@poe-platform/safe-bash/commands/du";
import type { CommandDefinition } from "@poe-platform/safe-bash/contracts/command";
const limits: Partial<DuLimits & SubpathLimits> = { maxEntries: 128, maxOutputBytes: 1024 };
const options: DuCommandsOptions = { limits, replace: true };
const commands: readonly CommandDefinition[] = [createDuCommand(options), subpath(options), ...createDuCommands(options)];
void [commands, duCommands(options)];
