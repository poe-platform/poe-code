import { createDiffCommand as rootFactory, type CommandDefinition, type VirtualShellPlugin } from "@poe-platform/safe-bash";
import { createDiffCommand, createDiffCommands, diffCommands, type DiffCommandsOptions, type DiffLimits } from "@poe-platform/safe-bash/commands/diff";
import { createDiffPatchCommands, type DiffPatchOptions } from "@poe-platform/safe-bash";
const limits: DiffLimits = { maxInputBytes: 1024, maxOutputBytes: 4096, maxWork: 10000 };
const options: DiffCommandsOptions = { ...limits, replace: true };
const compatibility: DiffPatchOptions = options;
const definitions: readonly CommandDefinition[] = [...createDiffCommands(options), ...createDiffPatchCommands(compatibility), rootFactory(options), createDiffCommand(options)];
const plugin: VirtualShellPlugin = diffCommands(options);
void definitions; void plugin;
