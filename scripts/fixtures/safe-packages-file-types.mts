import { createFileCommand, createFileCommands, fileCommands, type FileLimits, type FileCommandsOptions } from "@poe-platform/safe-bash";
import { createFileCommand as subpath, type FileLimits as SubpathLimits } from "@poe-platform/safe-bash/commands/file";
import type { CommandDefinition } from "@poe-platform/safe-bash/contracts/command";
const limits: Partial<FileLimits & SubpathLimits> = { maxEntries: 128, maxOutputBytes: 1024 };
const options: FileCommandsOptions = { limits, replace: true };
const commands: readonly CommandDefinition[] = [createFileCommand(options), subpath(options), ...createFileCommands(options)];
void [commands, fileCommands(options)];
