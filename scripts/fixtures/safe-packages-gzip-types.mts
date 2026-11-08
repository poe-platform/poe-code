import { CommandRegistry, Shell, createByteCommands, createMemoryFileSystem, type CommandDefinition } from '@poe-platform/safe-bash';
import { createGzipCommand, createGzipCommands, gzipCommands, type GzipCommandsOptions, type GzipLimits } from '@poe-platform/safe-bash/commands/gzip';

const limits: GzipLimits = { maxDecodedBytes: 4096 };
const options: GzipCommandsOptions = { ...limits, replace: true };
const command: CommandDefinition = createGzipCommand(options);
const commands: readonly CommandDefinition[] = createGzipCommands(options);
const existing: readonly CommandDefinition[] = createByteCommands({ compression: limits });
const shell = new Shell({ fs: createMemoryFileSystem(), commands: new CommandRegistry([command]) }).use(gzipCommands(options));
void [commands, existing, shell];
