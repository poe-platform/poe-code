import { Shell, createMemoryFileSystem, commandRuntimeIdentity } from "@poe-platform/safe-bash";
import { createYqCommand, createYqCommands, yqCommands, type YqCommandsOptions } from "@poe-platform/safe-bash/commands/yq";
import { createYqCommand as nativeYq, yqCommands as nativePlugin } from "@poe-platform/safe-bash/yq";
import type { CommandDefinition } from "@poe-platform/safe-bash/contracts/command";

const options: YqCommandsOptions = { replace: true };
const command: CommandDefinition = createYqCommand(options);
const commands: readonly CommandDefinition[] = createYqCommands(options);
const native: CommandDefinition = nativeYq();
const shell = new Shell({ fs: createMemoryFileSystem() }).use(yqCommands(options)).use(nativePlugin({ replace: true }));
void [command, commands, native, shell, commandRuntimeIdentity];
