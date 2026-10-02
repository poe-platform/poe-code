import { createTruncateCommand as rootFactory } from "@poe-platform/safe-bash";
import { createTruncateCommand, truncateCommands, type TruncateCommandsOptions, type TruncateLimits } from "@poe-platform/safe-bash/commands/truncate";
import { createTruncateCommand as legacyFactory } from "@poe-platform/safe-bash/truncate";
import type { CommandDefinition, VirtualShellPlugin } from "@poe-platform/safe-bash/contracts";
const limits: TruncateLimits = { maxArgumentBytes: 1024, maxArguments: 10, maxOutputBytes: 1024, maxEntries: 5 };
const options: TruncateCommandsOptions = { replace: true, limits, ioBlockSize: async (_path, stat, context) => { context.signal.throwIfAborted(); return stat.ioBlockSize ?? 512; }, seekEnd: (_path, stat) => stat.size };
export const commands: readonly CommandDefinition[] = [rootFactory(options), createTruncateCommand(options), legacyFactory(options)];
export const plugin: VirtualShellPlugin = truncateCommands(options);
