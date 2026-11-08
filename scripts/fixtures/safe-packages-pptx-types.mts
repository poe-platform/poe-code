import { Shell, type CommandDefinition, type VirtualShellPlugin } from "@poe-platform/safe-bash";
import { createPptxCommand, createPptxCommands, pptxCommands, type PptxCommandEngine, type PptxCommandsOptions, type PptxLimits } from "@poe-platform/safe-bash/commands/pptx";
const limits: PptxLimits = { maxArgumentBytes: 1024 };
const engine: PptxCommandEngine = { async execute(request) {
  request.signal.throwIfAborted();
  return { exitCode: 0, stdout: await request.readInput("-", 1024), stderr: new Uint8Array() };
} };
const options: PptxCommandsOptions = { engine, limits };
const command: CommandDefinition = createPptxCommand(options);
const commands: readonly CommandDefinition[] = createPptxCommands(options);
const plugin: VirtualShellPlugin = pptxCommands(options);
export function register(shell: Shell): Shell { return shell.use(plugin); }
void [command, commands];
