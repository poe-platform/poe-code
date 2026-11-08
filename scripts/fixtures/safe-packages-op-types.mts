import { Shell, type CommandDefinition, type VirtualShellPlugin } from "@poe-platform/safe-bash";
import { createObjectBackend, createOpCommand, createOpCommands, opCommands, type OpCommandsOptions, type OpLimits } from "@poe-platform/safe-bash/commands/op";
const limits: OpLimits = { maxInputBytes: 1024 };
const options: OpCommandsOptions = { backend: createObjectBackend(), limits, authorize: () => "allow" };
const command: CommandDefinition = createOpCommand(options);
const commands: readonly CommandDefinition[] = createOpCommands(options);
const plugin: VirtualShellPlugin = opCommands(options);
export function register(shell: Shell): Shell { return shell.use(plugin); }
void [command, commands];
