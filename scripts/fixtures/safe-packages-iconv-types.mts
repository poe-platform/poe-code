import { createAgentCommands, createIconvCommand, createIconvCommands, iconvCommands, type AgentCommandsOptions, type CommandDefinition, type IconvCommandsOptions, type IconvLimits } from "@poe-platform/safe-bash";
import { createIconvCommand as subpathCommand, createIconvCommands as subpathCommands, iconvCommands as subpathPlugin, type IconvCommandsOptions as SubpathOptions, type IconvLimits as SubpathLimits } from "@poe-platform/safe-bash/commands/iconv";

const limits: IconvLimits & SubpathLimits = {
  maxArguments: 4096, maxArgumentBytes: 65_536, maxInputBytes: 8_388_608,
  maxBufferedBytes: 33_554_432, maxOutputBytes: 67_108_864, maxDiagnosticBytes: 65_536,
  maxWork: 134_217_728, maxChunks: 65_536, maxEmptyChunks: 4096,
};
const options: IconvCommandsOptions & SubpathOptions = { replace: true, limits };
const command: CommandDefinition = createIconvCommand(options);
const commands: readonly CommandDefinition[] = createIconvCommands(options);
const plugin: ReturnType<typeof iconvCommands> = iconvCommands(options);
const commandFactory: typeof createIconvCommand = subpathCommand;
const commandFactories: typeof createIconvCommands = subpathCommands;
const pluginFactory: typeof iconvCommands = subpathPlugin;
const aggregate: AgentCommandsOptions = { iconv: { limits } };
void [command, commands, plugin, commandFactory, commandFactories, pluginFactory, createAgentCommands(aggregate)];
