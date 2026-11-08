import { Shell, MemoryFileSystem, CommandRegistry, agentCommands, standardCommands,
  type CommandContext, type CommandDefinition, type VirtualShellPlugin } from "virtual-bash";

const command: CommandDefinition = { name: "independent", async execute(context: CommandContext) {
  await context.stdout.write(new Uint8Array([111, 107, 10]));
  return { exitCode: 0 };
} };
const plugin: VirtualShellPlugin = { name: "independent", setup(host) {
  host.commands.register(command);
  host.use(async (_context, next) => await next());
} };
const registry = new CommandRegistry();
const shell = new Shell({ fs: new MemoryFileSystem(), commands: registry, limits: { maxOutputBytes: 32 } });
shell.use(agentCommands()).use(plugin);
standardCommands({ execute: async () => ({ exitCode: 0 }) });
await shell.dispose();
