import type { CommandDefinition, VirtualShellPlugin } from "@poe-platform/safe-bash/contracts";
import { createDocxCommand, createDocxCommands, docxCommands, type DocxCommandEngine, type DocxCommandsOptions, type DocxLimits } from "@poe-platform/safe-bash/commands/docx";
const limits: DocxLimits = { maxArgumentBytes: 1024 };
const engine: DocxCommandEngine = { async execute(request) { await request.stdout.write(request.args[0]!); return { exitCode: 0 }; } };
const options: DocxCommandsOptions = { engine, limits, replace: true };
const command: CommandDefinition = createDocxCommand(options);
const commands: readonly CommandDefinition[] = createDocxCommands(options);
const plugin: VirtualShellPlugin = docxCommands(options);
void [command, commands, plugin];
