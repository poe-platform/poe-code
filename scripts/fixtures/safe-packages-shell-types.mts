import { baseAgentCommands, type BaseAgentCommandsOptions } from "@poe-platform/safe-bash/registry";
import { Shell, CommandRegistry, createCommandArguments, type CommandDefinition, type VirtualShellPlugin } from "@poe-platform/safe-bash/shell";
import { Shell as FullShell } from "@poe-platform/safe-bash/full";
import { createMemoryFileSystem } from "@poe-platform/safe-fs/core";
const command: CommandDefinition = { name: "typed", async execute(context) {
  for await (const chunk of context.stdin) await context.stdout.write(chunk);
  return { exitCode: 0 };
} };
const plugin: VirtualShellPlugin = { name: "typed", setup(host) { host.commands.register(command); } };
const registry = new CommandRegistry();
registry.register(command);
const shell: FullShell = new Shell({ fs: createMemoryFileSystem() });
shell.use(plugin);
void createCommandArguments(["typed"]);
const baseOptions: BaseAgentCommandsOptions = { regex: { maxWorkers: 1 } };
shell.use(baseAgentCommands(baseOptions));
