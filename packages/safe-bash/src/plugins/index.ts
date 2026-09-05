import { CommandRegistry, type CommandDefinition, type CommandHandler, type VirtualShellPlugin } from "../contracts/index.js";
import { createStandardCommands } from "../commands/index.js";
import { diagnostic } from "../commands/internal.js";
import { createTextProgramCommands, type TextProgramOptions } from "../commands/text-programs/index.js";
import { createStructuredCommands, type StructuredCommandsOptions } from "../commands/structured/index.js";
import { createSearchCommands, type SearchOptions } from "../commands/search/index.js";
import { createByteCommands, type ByteCommandsOptions } from "../commands/bytes/index.js";
import { createDiffPatchCommands, type DiffPatchOptions } from "../commands/diff-patch/index.js";
import { createMetadataCommands, type MetadataCommandsOptions } from "../commands/metadata/index.js";
import { createArchiveCommands, type ArchiveCommandsOptions } from "../commands/archive/index.js";
import { createTableTextCommands, type TableTextCommandsOptions } from "../commands/table-text/index.js";
import { createStreamInspectionCommands, type StreamInspectionCommandsOptions } from "../commands/stream-inspection/index.js";
import { createStreamFormatCommands, type StreamFormatCommandsOptions } from "../commands/stream-format/index.js";
import { createSplitCommands, type SplitCommandsOptions } from "../commands/split/index.js";
import { createTimeEnvCommands, type TimeEnvCommandsOptions } from "../commands/time-env/index.js";
import { createTreeCommands, type TreeCommandsOptions } from "../commands/tree/index.js";
import { createFileCommands, type FileCommandsOptions } from "../commands/file/index.js";
import { createGrepAliasCommands } from "../commands/grep-aliases/index.js";
import { createColumnCommands, type ColumnCommandsOptions } from "../commands/column/index.js";
import { createHtmlToMarkdownCommands, type HtmlToMarkdownCommandsOptions } from "../commands/html-to-markdown/index.js";
import { createDuCommands, type DuCommandsOptions } from "../commands/du/index.js";
import { createExprCommands, type ExprCommandsOptions } from "../commands/expr/index.js";
import { createWhichCommands, type WhichCommandsOptions } from "../commands/which/index.js";
import { createTimeoutCommands, type TimeoutCommandsOptions } from "../commands/timeout/index.js";
import { createApplyPatchCommands, type ApplyPatchCommandsOptions } from "../commands/apply-patch/index.js";
import type { RegexExecutionOptions } from "../commands/regex-execution/protocol.js";

export interface AgentCommandsOptions {
  readonly bytes?: Omit<ByteCommandsOptions, "replace">;
  readonly applyPatch?: Omit<ApplyPatchCommandsOptions, "replace">;
  readonly timeout?: Omit<TimeoutCommandsOptions, "replace">;
  readonly which?: Omit<WhichCommandsOptions, "replace">;
  readonly expr?: Omit<ExprCommandsOptions, "replace" | "regex">;
  readonly du?: Omit<DuCommandsOptions, "replace">;
  readonly htmlToMarkdown?: Omit<HtmlToMarkdownCommandsOptions, "replace">;
  readonly replace?: boolean;
  readonly execute?: CommandHandler;
  readonly regex?: RegexExecutionOptions;
  readonly maxDirectoryEntries?: number;
  readonly maxTeeTargets?: number;
  readonly text?: Omit<TextProgramOptions, "replace">;
  readonly structured?: Omit<StructuredCommandsOptions, "replace">;
  readonly search?: Omit<SearchOptions, "replace">;
  readonly diffPatch?: Omit<DiffPatchOptions, "replace">;
  readonly metadata?: Omit<MetadataCommandsOptions, "replace">;
  readonly archive?: Omit<ArchiveCommandsOptions, "replace">;
  readonly tableText?: Omit<TableTextCommandsOptions, "replace">;
  readonly streamInspection?: Omit<StreamInspectionCommandsOptions, "replace">;
  readonly streamFormat?: Omit<StreamFormatCommandsOptions, "replace">;
  readonly split?: Omit<SplitCommandsOptions, "replace">;
  readonly timeEnv?: Omit<TimeEnvCommandsOptions, "replace">;
  readonly tree?: Omit<TreeCommandsOptions, "replace">;
  readonly file?: Omit<FileCommandsOptions, "replace">;
  readonly column?: Omit<ColumnCommandsOptions, "replace">;
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
  const exprLimits = options.expr?.limits;
  const whichLimits = options.which?.limits;
  const timeoutOptions = options.timeout;
  const applyPatchLimits = options.applyPatch?.limits;
  commands.push(
    ...createStandardCommands({ execute: options.execute ?? executor(name => commands.find(command => command.name === name)), ...(options.regex === undefined ? {} : { regex: options.regex }), ...(options.maxDirectoryEntries === undefined ? {} : { maxDirectoryEntries: options.maxDirectoryEntries }), ...(options.maxTeeTargets === undefined ? {} : { maxTeeTargets: options.maxTeeTargets }) }),
    ...createTextProgramCommands({ ...options.text }),
    ...createStructuredCommands({ ...options.structured }),
    ...createSearchCommands({ ...options.search }),
    ...createByteCommands(options.bytes),
    ...createDiffPatchCommands({ ...options.diffPatch }),
    ...createMetadataCommands({ ...options.metadata }),
    ...createArchiveCommands({ ...options.archive }),
    ...createTableTextCommands({ ...options.tableText }),
    ...createStreamInspectionCommands({ ...options.streamInspection }),
    ...createStreamFormatCommands({ ...options.streamFormat }),
    ...createSplitCommands({ ...options.split }),
    ...createTimeEnvCommands({ ...options.timeEnv }),
    ...createTreeCommands({ ...options.tree }),
    ...createFileCommands({ ...options.file }),
    ...createGrepAliasCommands(options.regex === undefined ? {} : { regex: options.regex }),
    ...createColumnCommands({ ...options.column }),
    ...createHtmlToMarkdownCommands({ ...options.htmlToMarkdown }),
    ...createDuCommands({ ...options.du }),
    ...createExprCommands({ ...(exprLimits === undefined ? {} : { limits: exprLimits }), ...(options.regex === undefined ? {} : { regex: options.regex }) }),
    ...createWhichCommands(whichLimits === undefined ? {} : { limits: whichLimits }),
    ...createTimeoutCommands(timeoutOptions === undefined ? undefined : {
      invoke: timeoutOptions.invoke,
      scheduler: timeoutOptions.scheduler,
      maxTimerMilliseconds: timeoutOptions.maxTimerMilliseconds,
    }),
    ...createApplyPatchCommands(applyPatchLimits === undefined ? {} : { limits: applyPatchLimits }),
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
