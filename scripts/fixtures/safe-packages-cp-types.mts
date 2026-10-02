import { Shell, createMemoryFileSystem, createCpCommand, createCpCommands, type CpLimits, type CpCommandsOptions } from "@poe-platform/safe-bash";
import { cpCommands, createCpCommand as subpathFactory } from "@poe-platform/safe-bash/commands/cp";
const limits: CpLimits = { maxDirectoryEntries: 100, maxRecursiveDirectoryDepth: 8 };
const options: CpCommandsOptions = { limits, replace: true };
const shell = new Shell({ fs: createMemoryFileSystem() }).use(cpCommands(options));
shell.commands.register(createCpCommand(options), { replace: true });
const definitions = createCpCommands(options);
const command = subpathFactory(options);
void [definitions, command];
