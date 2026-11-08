import { Shell, CommandRegistry, createMemoryFileSystem, createByteCommands, createZstdCommand, zstdCommands, type ZstdLimits } from '@poe-platform/safe-bash';
import { createZstdCommands, type CompressionCommandOptions, type ZstdCommandsOptions } from '@poe-platform/safe-bash/commands/zstd';
import type { CommandDefinition } from '@poe-platform/safe-bash/contracts';

const options: CompressionCommandOptions = { maxDecodedBytes: 1024 };
const limits: ZstdLimits = { maxDecodedBytes: 1024 };
const bounded: ZstdCommandsOptions = { limits, replace: true };
const single: CommandDefinition = createZstdCommand(bounded);
void single;
void zstdCommands(bounded);
const commands: readonly CommandDefinition[] = createZstdCommands(options);
const shell = new Shell({ fs: createMemoryFileSystem(), commands: new CommandRegistry(commands) });
const existing: readonly CommandDefinition[] = createByteCommands({ compression: options });
void existing;
await shell.exec('zstd -c | zstdcat', { stdin: new Uint8Array([0, 255]) });
await shell.dispose();
