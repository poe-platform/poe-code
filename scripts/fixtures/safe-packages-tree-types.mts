import { createTreeCommand, createTreeCommands, treeCommands, type TreeLimits, type TreeCommandsOptions } from "@poe-platform/safe-bash";
import { createTreeCommand as subpath } from "@poe-platform/safe-bash/commands/tree";
import type { CommandDefinition } from "@poe-platform/safe-bash/contracts/command";
const limits: Partial<TreeLimits> = { maxDirectoryEntries: 128 };
const options: TreeCommandsOptions = { limits, replace: true };
const commands: readonly CommandDefinition[] = [createTreeCommand(options), subpath(options), ...createTreeCommands(options)];
void [commands, treeCommands(options)];
