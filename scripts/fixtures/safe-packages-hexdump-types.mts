import { Shell, createMemoryFileSystem, createHexdumpCommand as rootFactory, type CommandDefinition, type AgentCommandsOptions } from "@poe-platform/safe-bash";
import { createHexdumpCommand, createHdCommand, createHexdumpCommands, hexdumpCommands, type HexdumpCommandsOptions, type HexdumpLimits } from "@poe-platform/safe-bash/commands/hexdump";
const limits: HexdumpLimits = { maxArguments: 10, maxArgumentBytes: 1000, maxInputBytes: 1000, maxBufferedBytes: 1000, maxOutputBytes: 1000, maxDiagnosticBytes: 1000, maxFormats: 10, maxWork: 10000, maxEmptyChunks: 10 };
const options: HexdumpCommandsOptions = { limits, replace: true, dialect: "bsd" };
const factory: typeof rootFactory = createHexdumpCommand;
const commands: readonly CommandDefinition[] = [factory(options), createHdCommand(options), ...createHexdumpCommands(options)];
const agent: AgentCommandsOptions = { hexdump: options };
const shell = new Shell({ fs: createMemoryFileSystem() }).use(hexdumpCommands(options));
void commands; void agent; void shell;
