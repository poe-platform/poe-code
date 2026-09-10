import { CommandRegistry, type CommandDefinition, type CommandHandler } from "../contracts/index.js";
import { PublicDiagnostic } from "../diagnostics.js";
import { createStandardCommandsWithGrep, type ExecutionCommandsOptions } from "../commands/standard.js";
import { diagnostic } from "../commands/internal.js";
import { createTextProgramCommands, type TextProgramOptions } from "../commands/text-programs/index.js";
import { createStructuredCommands, type StructuredCommandsOptions } from "../commands/structured/index.js";
import { createRgCommand } from "../commands/search/rg-command.js";
import type { SearchOptions } from "../commands/search/options.js";
import { createGrepCommands } from "../commands/search/grep.js";
import type { RegexExecutor } from "../commands/regex-execution/portable.js";
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
import { createGrepAliases } from "../commands/grep-aliases/aliases.js";
import { createColumnCommands, type ColumnCommandsOptions } from "../commands/column/index.js";
import { createHtmlToMarkdownCommands, type HtmlToMarkdownCommandsOptions } from "../commands/html-to-markdown/index.js";
import { createDuCommands, type DuCommandsOptions } from "../commands/du/index.js";
import { createExprCommandWithExecutor } from "../commands/expr/command.js";
import type { ExprCommandsOptions } from "../commands/expr/internal.js";
import { createWhichCommands, type WhichCommandsOptions } from "../commands/which/index.js";
import { createTimeoutCommands, type TimeoutCommandsOptions } from "../commands/timeout/index.js";
import { createApplyPatchCommands, type ApplyPatchCommandsOptions } from "../commands/apply-patch/index.js";
import { createXmlCommands, type XmlCommandsOptions } from "../commands/xml/index.js";
import { createCsplitCommandWithExecutor } from "../commands/csplit/command.js";
import type { CsplitCommandsOptions } from "../commands/csplit/internal.js";
import { createPrCommands, type PrCommandsOptions } from "../commands/pr/index.js";
import { createTsortCommands, type TsortCommandsOptions } from "../commands/tsort/index.js";
import type { RegexExecutionOptions } from "../commands/regex-execution/protocol.js";
import type { BoundedRegexProvider } from "../commands/regex-execution/provider.js";

export interface AgentCommandsOptions {
  readonly execution?: ExecutionCommandsOptions;
  readonly bytes?: Omit<ByteCommandsOptions, "replace">;
  readonly applyPatch?: Omit<ApplyPatchCommandsOptions, "replace">;
  readonly xml?: Omit<XmlCommandsOptions, "replace">;
  readonly timeout?: Omit<TimeoutCommandsOptions, "replace">;
  readonly which?: Omit<WhichCommandsOptions, "replace">;
  readonly expr?: Omit<ExprCommandsOptions, "replace" | "regex" | "regexExecutor">;
  readonly csplit?: Omit<CsplitCommandsOptions, "replace" | "regex" | "regexExecutor">;
  readonly pr?: Omit<PrCommandsOptions, "replace">;
  readonly tsort?: Omit<TsortCommandsOptions, "replace">;
  readonly du?: Omit<DuCommandsOptions, "replace">;
  readonly htmlToMarkdown?: Omit<HtmlToMarkdownCommandsOptions, "replace">;
  readonly replace?: boolean;
  readonly execute?: CommandHandler;
  readonly regex?: RegexExecutionOptions;
  readonly regexExecutor?: BoundedRegexProvider;
  readonly maxDirectoryEntries?: number;
  readonly maxTeeTargets?: number;
  readonly maxTailFollowHandles?: number;
  readonly text?: Omit<TextProgramOptions, "replace">;
  readonly structured?: Omit<StructuredCommandsOptions, "replace">;
  readonly search?: Omit<SearchOptions, "replace" | "regexExecutor">;
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

export function commandExecutor(lookup: (name: string) => CommandDefinition | undefined): CommandHandler {
  return async context => {
    const command = lookup(context.command);
    if (command) return command.execute(context);
    await diagnostic(context, new PublicDiagnostic("command not found"));
    return { exitCode: 127 };
  };
}

export interface AgentRegexExecutors {
  readonly grep: RegexExecutor;
  readonly aliases: RegexExecutor;
  readonly expr: RegexExecutor;
  readonly csplit: RegexExecutor;
  readonly search: RegexExecutor;
}

export function composeAgentCommands(options: AgentCommandsOptions, executors: AgentRegexExecutors): readonly CommandDefinition[] {
  const commands: CommandDefinition[] = [];
  const grep = createGrepCommands(executors.grep);
  const exprLimits = options.expr?.limits;
  const csplitLimits = options.csplit?.limits;
  const prOptions = options.pr;
  const prLimits = prOptions?.limits;
  const prClock = prOptions?.clock;
  const tsortLimits = options.tsort?.limits;
  const whichLimits = options.which?.limits;
  const timeoutOptions = options.timeout;
  const applyPatchLimits = options.applyPatch?.limits;
  const xmlLimits = options.xml?.limits;
  commands.push(
    ...createStandardCommandsWithGrep({ execute: options.execute ?? commandExecutor(name => commands.find(command => command.name === name)), ...(options.execution === undefined ? {} : { execution: options.execution }), ...(options.regex === undefined ? {} : { regex: options.regex }), ...(options.maxDirectoryEntries === undefined ? {} : { maxDirectoryEntries: options.maxDirectoryEntries }), ...(options.maxTeeTargets === undefined ? {} : { maxTeeTargets: options.maxTeeTargets }), ...(options.maxTailFollowHandles === undefined ? {} : { maxTailFollowHandles: options.maxTailFollowHandles }) }, grep),
    ...createTextProgramCommands({ ...options.text }),
    ...createStructuredCommands({ ...options.structured }),
    createRgCommand(executors.search, options.search),
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
    ...createGrepAliases(createGrepCommands(executors.aliases)[0]!),
    ...createColumnCommands({ ...options.column }),
    ...createHtmlToMarkdownCommands({ ...options.htmlToMarkdown }),
    ...createDuCommands({ ...options.du }),
    createExprCommandWithExecutor(executors.expr, exprLimits === undefined ? {} : { limits: exprLimits }),
    ...createWhichCommands(whichLimits === undefined ? {} : { limits: whichLimits }),
    ...createTimeoutCommands(timeoutOptions === undefined ? undefined : {
      invoke: timeoutOptions.invoke,
      scheduler: timeoutOptions.scheduler,
      maxTimerMilliseconds: timeoutOptions.maxTimerMilliseconds,
    }),
    ...createApplyPatchCommands(applyPatchLimits === undefined ? {} : { limits: applyPatchLimits }),
    ...createXmlCommands(xmlLimits === undefined ? {} : { limits: xmlLimits }),
    createCsplitCommandWithExecutor(executors.csplit, csplitLimits === undefined ? {} : { limits: csplitLimits }),
    ...createPrCommands({ ...(prLimits === undefined ? {} : { limits: prLimits }), ...(prClock === undefined ? {} : { clock: prClock }) }),
    ...createTsortCommands(tsortLimits === undefined ? {} : { limits: tsortLimits }),
  );
  return new CommandRegistry(commands).list();
}
