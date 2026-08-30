import { createXanCommand, createXanCommands, xanCommands, type XanLimits, type XanCommandsOptions } from './build/dist/commands/xan/index.js';
import { CommandRegistry, type CommandDefinition, type VirtualShellPlugin } from './build/dist/contracts/index.js';
const limits: Partial<XanLimits> = { maxInputBytes: 64, maxWork: 1024 };
const options: XanCommandsOptions = { replace: true, limits };
const command: CommandDefinition = createXanCommand(options);
const commands: readonly CommandDefinition[] = createXanCommands();
const plugin: VirtualShellPlugin = xanCommands(options);
new CommandRegistry([command, ...commands]);
void plugin;
