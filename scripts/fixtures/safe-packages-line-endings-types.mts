import { createAgentCommands, createDos2unixCommand, createUnix2dosCommand, createLineEndingCommands, lineEndingCommands, type AgentCommandsOptions, type CommandDefinition, type LineEndingCommandsOptions, type LineEndingLimits } from "@poe-platform/safe-bash";
import { createDos2unixCommand as subpathDos2unix, createUnix2dosCommand as subpathUnix2dos, createLineEndingCommands as subpathCommands, lineEndingCommands as subpathPlugin, type LineEndingCommandsOptions as SubpathOptions, type LineEndingLimits as SubpathLimits } from "@poe-platform/safe-bash/commands/line-endings";

const limits: LineEndingLimits & SubpathLimits = {
  maxArguments: 1024, maxArgumentBytes: 262_144, maxInputBytes: 16_777_216,
  maxOutputBytes: 33_554_432, maxBufferedBytes: 2_097_152, maxDiagnosticBytes: 65_536,
  maxFiles: 128, maxWork: 134_217_728, maxEmptyChunks: 1024,
  maxPathBytes: 4096, maxDepth: 64, maxTempAttempts: 128, chunkSize: 16_384,
};
const options: LineEndingCommandsOptions & SubpathOptions = { replace: true, limits };
const dos2unix: CommandDefinition = createDos2unixCommand(options);
const unix2dos: CommandDefinition = createUnix2dosCommand(options);
const commands: readonly CommandDefinition[] = createLineEndingCommands(options);
const plugin: ReturnType<typeof lineEndingCommands> = lineEndingCommands(options);
const dos2unixFactory: typeof createDos2unixCommand = subpathDos2unix;
const unix2dosFactory: typeof createUnix2dosCommand = subpathUnix2dos;
const commandFactories: typeof createLineEndingCommands = subpathCommands;
const pluginFactory: typeof lineEndingCommands = subpathPlugin;
const aggregate: AgentCommandsOptions = { lineEndings: { limits } };
const partial: LineEndingCommandsOptions = { limits: { maxFiles: 2 } };
void [dos2unix, unix2dos, commands, plugin, dos2unixFactory, unix2dosFactory, commandFactories, pluginFactory, createAgentCommands(aggregate), createLineEndingCommands(partial)];
