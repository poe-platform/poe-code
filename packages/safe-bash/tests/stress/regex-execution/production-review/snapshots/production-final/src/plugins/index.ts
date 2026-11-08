import { CommandRegistry, type CommandDefinition, type CommandHandler, type VirtualShellPlugin } from "../contracts/index.js";
import { createStandardCommands } from "../commands/index.js";
import { diagnostic } from "../commands/internal.js";
import { createTextProgramCommands, type TextProgramOptions } from "../commands/text-programs/index.js";
import { createStructuredCommands, type StructuredCommandsOptions } from "../commands/structured/index.js";
import { createSearchCommands, type SearchOptions } from "../commands/search/index.js";
import { createByteCommands } from "../commands/bytes/index.js";
import { createDiffPatchCommands, type DiffPatchOptions } from "../commands/diff-patch/index.js";
import { createMetadataCommands, type MetadataCommandsOptions } from "../commands/metadata/index.js";
import { createArchiveCommands, type ArchiveCommandsOptions } from "../commands/archive/index.js";
import { createTableTextCommands, type TableTextCommandsOptions } from "../commands/table-text/index.js";
import { createStreamInspectionCommands, type StreamInspectionCommandsOptions } from "../commands/stream-inspection/index.js";

export interface AgentCommandsOptions {
  readonly replace?: boolean;
  readonly execute?: CommandHandler;
  readonly text?: Omit<TextProgramOptions, "replace">;
  readonly structured?: Omit<StructuredCommandsOptions, "replace">;
  readonly search?: Omit<SearchOptions, "replace">;
  readonly diffPatch?: Omit<DiffPatchOptions, "replace">;
  readonly metadata?: Omit<MetadataCommandsOptions, "replace">;
  readonly archive?: Omit<ArchiveCommandsOptions, "replace">;
  readonly tableText?: Omit<TableTextCommandsOptions, "replace">;
  readonly streamInspection?: Omit<StreamInspectionCommandsOptions, "replace">;
}

function executor(lookup: (name: string) => CommandDefinition | undefined): CommandHandler {
  return async context => {
    const command = lookup(context.command);
    if (command) return command.execute(context);
    await diagnostic(context, new Error("command not found"));
    return { exitCode: 127 };
  };
}

export function createAgentCommands(options: AgentCommandsOptions = {}): readonly CommandDefinition[] {
  const commands: CommandDefinition[] = [];
  commands.push(
    ...createStandardCommands({ execute: options.execute ?? executor(name => commands.find(command => command.name === name)) }),
    ...createTextProgramCommands({ ...options.text }),
    ...createStructuredCommands({ ...options.structured }),
    ...createSearchCommands({ ...options.search }),
    ...createByteCommands(),
    ...createDiffPatchCommands({ ...options.diffPatch }),
    ...createMetadataCommands({ ...options.metadata }),
    ...createArchiveCommands({ ...options.archive }),
    ...createTableTextCommands({ ...options.tableText }),
    ...createStreamInspectionCommands({ ...options.streamInspection }),
  );
  return new CommandRegistry(commands).list();
}

export function agentCommands(options: AgentCommandsOptions = {}): VirtualShellPlugin {
  return {
    name: "agent-commands",
    setup(host) {
      const definitions = createAgentCommands({ ...options, execute: options.execute ?? executor(name => host.commands.get(name)) });
      if (!options.replace) for (const definition of definitions) {
        if (host.commands.has(definition.name)) throw new Error(`Command already registered: ${definition.name}`);
      }
      for (const definition of definitions) host.commands.register(definition, { replace: options.replace ?? false });
    },
  };
}
