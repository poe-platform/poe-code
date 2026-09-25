import { Shell, columnCommands, createColumnCommand, type ColumnLimits, type ColumnCommandsOptions } from '@poe-platform/safe-bash';
import { createColumnCommands, columnCommands as subpath } from '@poe-platform/safe-bash/commands/column';
import type { CommandDefinition, VirtualShellPlugin } from '@poe-platform/safe-bash/contracts';
const limits: Partial<ColumnLimits> = { maxCells: 50, maxRetainedBytes: 1024 };
const options: ColumnCommandsOptions = { limits, replace: true };
const command: CommandDefinition = createColumnCommand(options);
const commands: readonly CommandDefinition[] = createColumnCommands(options);
const plugin: VirtualShellPlugin = subpath(options);
function register(shell: Shell): Shell { return shell.use(columnCommands(options)).use(plugin); }
void command; void commands; void register;
