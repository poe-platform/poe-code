import { Shell, CommandRegistry, createMemoryFileSystem, createByteCommands } from '@poe-platform/safe-bash';
import { createXzCommands, type CompressionCommandOptions } from '@poe-platform/safe-bash/commands/xz';
import type { CommandDefinition } from '@poe-platform/safe-bash/contracts';

const options: CompressionCommandOptions = { maxDecodedBytes: 1024 };
const commands: readonly CommandDefinition[] = createXzCommands(options);
const shell = new Shell({ fs: createMemoryFileSystem(), commands: new CommandRegistry(commands) });
const existing: readonly CommandDefinition[] = createByteCommands({ compression: options });
void existing;
await shell.exec('xz -c | xzcat', { stdin: new Uint8Array([0, 255]) });
await shell.dispose();
