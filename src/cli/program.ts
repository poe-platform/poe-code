import { basename, join } from "node:path";
import { Command, Help, InvalidArgumentError, Option } from "commander";
import { interceptCommanderInputErrors } from "./commander-input-errors.js";
import type { CommandNode, Group } from "toolcraft";
import { S, type Static } from "toolcraft-schema";
import { runCLI } from "toolcraft/cli";
import { createHumanInLoop, defaultProviderForPlatform } from "toolcraft/human-in-loop";
import { evalGroup } from "@poe-code/agent-eval";
import { ghGroup } from "@poe-code/github-workflows";
import { codeReviewGroup } from "agent-code-review";
import { superintendentGroup } from "@poe-code/superintendent";
import {
  runMaestro,
  runMaestroTick,
  type Logger as MaestroLogger,
  type MaestroEvent
} from "@poe-code/maestro";
import { runMaestroTui } from "@poe-code/maestro-tui";
import { createCliContainer, type CliContainer, type CliDependencies } from "./container.js";
import { text } from "toolcraft-design";
import { helpGuidance, optionHelpGroup } from "./commands/help-guidance.js";
import { registerConfigureCommand } from "./commands/configure.js";
import { registerAgentCommand } from "./commands/agent.js";
import { registerSpawnCommand } from "./commands/spawn.js";
import {
  createPoeAgentSpawnHandler,
  POE_AGENT_SPAWN_SERVICE
} from "./commands/spawn-poe-agent.js";
import { registerLoginCommand } from "./commands/login.js";
import { registerLogoutCommand } from "./commands/logout.js";
import { registerAuthCommand } from "./commands/auth.js";
import { registerUtilsCommand } from "./commands/utils.js";
import { registerInstallCommand } from "./commands/install.js";
import { registerUpdateCommand } from "./commands/update.js";
import { registerUnconfigureCommand } from "./commands/unconfigure.js";
import { registerTestCommand } from "./commands/test.js";
import { registerSkillCommand } from "./commands/skill.js";
import { registerVersionCommand } from "./commands/version.js";
import { registerUsageCommand } from "./commands/usage.js";
import { registerModelsCommand } from "./commands/models.js";
import { registerPipelineCommand } from "./commands/pipeline.js";
import { registerPlanCommand } from "./commands/plan.js";
import { registerTracesCommand } from "./commands/traces.js";
import { registerRalphCommand } from "./commands/ralph.js";
import { registerExperimentCommand } from "./commands/experiment.js";
import { registerLaunchCommand } from "./commands/launch.js";
import { registerMemoryCommand } from "./commands/memory.js";
import { registerMemoryMcpCommand } from "./commands/memory-mcp.js";
import { registerProviderCommand } from "./commands/provider.js";
import { registerRuntimeCommand } from "./commands/runtime/index.js";
import { registerHarnessCommand } from "./commands/harness.js";
import { registerBraintrustCommand } from "./commands/braintrust.js";
import { registerDoctorCommand } from "./commands/doctor.js";
import { registerCompletionCommand } from "./commands/completion.js";
import { registerTasksCommand } from "./commands/tasks.js";
import { registerGaslightCommand } from "./commands/gaslight.js";
import { registerWorktreeCommand } from "./commands/worktree.js";
import { packageVersion } from "../package-metadata.js";
import { throwCommandNotFound } from "./command-not-found.js";
import { ValidationError } from "./errors.js";
import {
  detectExecutionContext,
  formatCliHelpCommand,
  formatCliUsageCommand
} from "../utils/execution-context.js";

/** Shared by the commander and toolcraft help renderers so their titles cannot drift apart. */
const POE_HELP_TITLE_PREFIX = "Poe";

/** The one product tagline: the root command description and the help body render it. */
const POE_TAGLINE = "Configure coding agents to use the Poe API.";

function formatCommandHeader(cmd: Command): string {
  const parts: string[] = [];
  let current: Command | null = cmd;
  while (current) {
    const name = current.name();
    if (name === "poe-code") {
      break;
    }
    if (name.length > 0) {
      parts.push(name);
    }
    current = current.parent ?? null;
  }
  return `${POE_HELP_TITLE_PREFIX} - ${parts.reverse().join(" ")}`;
}

const ROOT_HELP_PRIMARY_COMMANDS: readonly string[] = [
  "install",
  "update",
  "configure",
  "unconfigure",
  "login",
  "logout",
  "auth",
  "agent",
  "spawn",
  "gaslight",
  "test",
  "models",
  "pipeline",
  "plan",
  "traces",
  "harness",
  "experiment",
  "ralph",
  "usage",
  "dashboard",
  "version",
  "help"
];

function splitUsageParts(usage: string): string[] {
  return usage
    .split(" ")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

function formatUsage(usage: string, excludedParts: readonly string[]): string {
  return splitUsageParts(usage)
    .filter((part) => !excludedParts.includes(part))
    .join(" ");
}

function formatRootHelpCommandArgs(command: Command): string {
  return formatUsage(command.usage(), ["[options]", "[command]", "[args...]"]);
}

interface RootHelpRow {
  name: string;
  args: string;
  description: string;
}

function buildRootHelpSections(root: Command): Array<{ heading: string; rows: RootHelpRow[] }> {
  const visible = root.commands.filter((command) => Reflect.get(command, "_hidden") !== true);
  const toRow = (command: Command): RootHelpRow => ({
    name: [command.name(), ...command.aliases()].join(", "),
    args: formatRootHelpCommandArgs(command),
    description: command.description()
  });
  const primary = ROOT_HELP_PRIMARY_COMMANDS.flatMap((name) => {
    const command = visible.find((candidate) => candidate.name() === name);
    return command === undefined ? [] : [toRow(command)];
  });
  const advanced = visible
    .filter((command) => !ROOT_HELP_PRIMARY_COMMANDS.includes(command.name()))
    .map(toRow);

  return [
    { heading: "Commands:", rows: primary },
    ...(advanced.length > 0 ? [{ heading: "Advanced:", rows: advanced }] : [])
  ];
}

function formatCanonicalCommandPath(cmd: Command): string {
  const parts: string[] = [];
  let current: Command | null = cmd;

  while (current) {
    const name = current.name();
    if (name.length > 0) {
      parts.push(name);
    }
    if (name === "poe-code") {
      break;
    }
    current = current.parent ?? null;
  }

  return parts.reverse().join(" ");
}

function formatCanonicalCommandUsage(cmd: Command): string {
  const hasExplicitUsage = typeof Reflect.get(cmd, "_usage") === "string";
  const usageParts = splitUsageParts(cmd.usage()).flatMap((part) => {
    if (part === "[command]") {
      if (hasExplicitUsage) {
        return [part];
      }
      // A group with no positionals of its own is reachable only through a subcommand: say so
      // with the placeholder the root help uses. One that takes positionals also runs
      // standalone, so its own arguments describe it better than a raw placeholder.
      return cmd.registeredArguments.length === 0 ? ["<command>"] : [];
    }
    // Commander emits [options] for the implicit --help alone; only advertise real flags.
    if (part === "[options]" && cmd.options.length === 0) {
      return [];
    }
    return [part];
  });
  return [formatCanonicalCommandPath(cmd), ...usageParts].join(" ");
}

function formatHelpItem(input: {
  term: string;
  termWidth: number;
  description: string;
  helper: Help;
}): string {
  const itemIndent = 2;
  const spacerWidth = 2;
  const indent = " ".repeat(itemIndent);

  if (!input.description) {
    return `${indent}${input.term}`;
  }

  const paddedTerm = input.term.padEnd(
    input.termWidth + input.term.length - input.helper.displayWidth(input.term)
  );
  const remainingWidth =
    (input.helper.helpWidth ?? 80) - input.termWidth - spacerWidth - itemIndent;
  const descriptionIndent = `${indent}${" ".repeat(spacerWidth)}`;

  if (remainingWidth < input.helper.minWidthToWrap) {
    const descriptionWidth = Math.max(1, (input.helper.helpWidth ?? 80) - itemIndent - spacerWidth);
    const formattedDescription = input.helper.preformatted(input.description)
      ? input.description
      : input.helper.boxWrap(input.description, descriptionWidth);
    return `${indent}${input.term}\n${descriptionIndent}${formattedDescription.replace(/\n/g, `\n${descriptionIndent}`)}`;
  }

  let formattedDescription = input.description;
  if (!input.helper.preformatted(input.description)) {
    formattedDescription = input.helper
      .boxWrap(input.description, remainingWidth)
      .replace(/\n/g, `\n${" ".repeat(input.termWidth + spacerWidth)}`);
  }

  return `${indent}${paddedTerm}${" ".repeat(spacerWidth)}${formattedDescription.replace(/\n/g, `\n${indent}`)}`;
}

function formatHelpText(input: {
  command: Command;
  heading: string;
  usageCommand: string;
  helpCommand: string;
  helper: Help;
}): string {
  const commandSections = buildRootHelpSections(input.command);
  const commandRows = commandSections.flatMap((section) => section.rows);
  const optionRows = input.helper.visibleOptions(input.command);
  const optionWidth = Math.max(
    0,
    ...optionRows.map((option) => input.helper.displayWidth(input.helper.optionTerm(option)))
  );
  const nameWidth = Math.max(0, ...commandRows.map((row) => row.name.length));
  const argsWidth = Math.max(0, ...commandRows.map((row) => row.args.length));
  const termWidth = nameWidth + 1 + argsWidth;
  const cmd = (row: (typeof commandRows)[number]) => {
    const name = text.command(row.name.padEnd(nameWidth));
    const args =
      row.args.length > 0 ? text.argument(row.args.padEnd(argsWidth)) : " ".repeat(argsWidth);
    return formatHelpItem({
      term: `${name} ${args}`,
      termWidth,
      description: row.description,
      helper: input.helper
    });
  };
  const option = (value: (typeof optionRows)[number]) =>
    formatHelpItem({
      term: text.option(input.helper.optionTerm(value)),
      termWidth: optionWidth,
      description: input.helper.optionDescription(value),
      helper: input.helper
    });

  return [
    text.heading(input.heading),
    "",
    POE_TAGLINE,
    "",
    `${text.section("Usage:")} ${text.usageCommand(input.usageCommand)} ${text.argument("<command> [...args]")}`,
    "",
    text.section("Options:"),
    ...optionRows.map(option),
    "",
    ...commandSections.flatMap((section) => [
      text.section(section.heading),
      ...section.rows.map(cmd),
      ""
    ]),
    `${text.muted("Run")} ${text.usageCommand(input.helpCommand)} ${text.muted("for command options.")}`,
    "",
    `${text.muted("Learn more about Poe:")}            ${text.link("https://poe.com/api")}`,
    `${text.muted("GitHub:")}                          ${text.link("https://github.com/poe-platform/poe-code")}`,
    ""
  ].join("\n");
}

function formatSubcommandHelp(cmd: Command, helper: Help): string {
  const termWidth = helper.padWidth(cmd, helper);
  const formatItem = (
    term: string,
    description: string,
    style: (value: string) => string
  ): string =>
    formatHelpItem({
      term: style(term),
      termWidth,
      description,
      helper
    });

  const formatList = (items: string[]): string => items.join("\n");

  const output: string[] = [];
  output.push(text.heading(formatCommandHeader(cmd)), "");
  output.push(
    `${text.section("Usage:")} ${text.usageCommand(formatCanonicalCommandUsage(cmd))}`,
    ""
  );

  const commandDescription = helper.commandDescription(cmd);
  if (commandDescription.length > 0) {
    output.push(commandDescription, "");
  }

  const argumentList = helper
    .visibleArguments(cmd)
    .map((argument) =>
      formatItem(helper.argumentTerm(argument), helper.argumentDescription(argument), text.argument)
    );
  if (argumentList.length > 0) {
    output.push(text.section("Arguments:"), formatList(argumentList), "");
  }

  const optionSections = new Map<string, string[]>([["Options", []]]);
  for (const option of helper.visibleOptions(cmd)) {
    const heading = optionHelpGroup(option) ?? "Options";
    const item = formatItem(
      helper.optionTerm(option),
      helper.optionDescription(option),
      text.option
    );
    const section = optionSections.get(heading);
    if (section === undefined) {
      optionSections.set(heading, [item]);
      continue;
    }
    section.push(item);
  }
  for (const [heading, items] of optionSections) {
    if (items.length > 0) {
      output.push(text.section(`${heading}:`), formatList(items), "");
    }
  }

  if (helper.showGlobalOptions) {
    const globalOptionList = helper
      .visibleGlobalOptions(cmd)
      .map((option) =>
        formatItem(helper.optionTerm(option), helper.optionDescription(option), text.option)
      );
    if (globalOptionList.length > 0) {
      output.push(text.section("Global Options:"), formatList(globalOptionList), "");
    }
  }

  const commandList = helper
    .visibleCommands(cmd)
    .map((subcommand) =>
      formatItem(
        helper.subcommandTerm(subcommand),
        helper.subcommandDescription(subcommand),
        text.command
      )
    );
  if (commandList.length > 0) {
    output.push(text.section("Commands:"), formatList(commandList), "");
  }

  const guidance = helpGuidance(cmd);
  if (guidance !== undefined) {
    output.push(
      text.section("Examples:"),
      formatList(
        guidance.examples.map(
          (example) => `  ${text.muted("$")} ${text.usageCommand(example)}`
        )
      ),
      ""
    );
    if (guidance.notes !== undefined) {
      const noteWidth = Math.max(1, (helper.helpWidth ?? 80) - 2);
      output.push(
        text.section("Notes:"),
        formatList(
          guidance.notes.map((note) => `  ${helper.boxWrap(note, noteWidth).replace(/\n/g, "\n  ")}`)
        ),
        ""
      );
    }
  }

  return output.join("\n");
}

function resolveRootHelpHeading(argv: string[]): string {
  const invoked = basename(argv[1] ?? "");
  if (invoked === "poe" || invoked === "poe.cmd" || invoked === "poe.exe") {
    return "Poe";
  }
  return "Poe - poe-code";
}

const FORWARDABLE_TOOLCRAFT_FLAGS = new Set(["-y", "--yes", "--dry-run", "--verbose"]);

const maestroCommandSchema = S.Object({
  path: S.String({
    description: "Path to WORKFLOW.md",
    default: "./WORKFLOW.md"
  }),
  maxConcurrent: S.Optional(
    S.Number({
      description: "Override agent.max_concurrent_agents",
      short: "c"
    })
  ),
  pollIntervalMs: S.Optional(
    S.Number({
      description: "Override polling.interval_ms"
    })
  ),
  list: S.Optional(
    S.String({
      description: "Override agent.list"
    })
  ),
  dryRun: S.Optional(
    S.Boolean({
      description: "Validate config, inspect candidates, and exit"
    })
  ),
  yes: S.Optional(
    S.Boolean({
      description: "Accept defaults non-interactively"
    })
  ),
  logLevel: S.Enum(["trace", "debug", "info", "warn", "error"] as const, {
    description: "Log level",
    default: "info"
  })
});

type MaestroCommandArgs = Static<typeof maestroCommandSchema> & { config?: string };

interface MaestroTickCommandArgs {
  task: string;
  transition: string;
  list?: string;
  config?: string;
  name?: string;
  dryRun?: boolean;
}

interface MaestroRunCommandArgs {
  config?: string;
  name?: string;
  maxConcurrent?: number;
  pollIntervalMs?: number;
  list?: string;
  dryRun?: boolean;
  yes?: boolean;
  logLevel: "trace" | "debug" | "info" | "warn" | "error";
}

function parseOptionalPositiveInteger(value: string, optionName: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 1 || String(parsed) !== value.trim()) {
    throw new InvalidArgumentError(
      `Invalid ${optionName} "${value}". Expected a positive integer.`
    );
  }
  return parsed;
}

function formatMaestroLog(message: string, meta?: Record<string, unknown>): string {
  if (meta === undefined || Object.keys(meta).length === 0) {
    return message;
  }
  return `${message} ${JSON.stringify(meta)}`;
}

function createMaestroLogger(
  container: CliContainer,
  options: Pick<MaestroCommandArgs, "dryRun" | "logLevel">
): MaestroLogger {
  const logger = container.loggerFactory.create({
    dryRun: options.dryRun === true,
    verbose: options.logLevel === "trace" || options.logLevel === "debug",
    scope: "maestro"
  });

  return {
    info: (message, meta) => logger.info(formatMaestroLog(message, meta)),
    warn: (message, meta) => logger.warn(formatMaestroLog(message, meta)),
    error: (message, meta) => logger.error(formatMaestroLog(message, meta))
  };
}

function hasCliOptionSource(command: Command, optionName: string): boolean {
  let current: Command | null = command;
  while (current) {
    if (current.getOptionValueSource(optionName) === "cli") {
      return true;
    }
    current = current.parent ?? null;
  }
  return false;
}

function readCommandTreeOption<T>(command: Command, optionName: string): T | undefined {
  let current: Command | null = command;
  while (current) {
    const value = current.getOptionValue(optionName);
    if (value !== undefined) {
      return value as T;
    }
    current = current.parent ?? null;
  }
  return undefined;
}

function assertPathIsNotOptionName(path: string, command: Command): void {
  const named = command.options.find((option) => option.long === `--${path}`);
  if (named !== undefined) {
    throw new ValidationError(
      `\`${path}\` is not a workflow path. Did you mean \`${named.long}\`?`
    );
  }
}

function assertNoUnsupportedOptionsForMaestroTui(command: Command, commandPath: string): void {
  const unsupportedOptionNames = [
    "maxConcurrent",
    "pollIntervalMs",
    "list",
    "dryRun",
    "yes",
    "verbose",
    "logLevel"
  ];
  if (unsupportedOptionNames.some((name) => hasCliOptionSource(command, name))) {
    throw new ValidationError(`\`${commandPath}\` only accepts --config, --workflow, or --name.`);
  }
}

/** Shared by `maestro tui` and its conventional root alias `dashboard`. */
function registerMaestroTuiCommand(
  parent: Command,
  options: { name: string; description: string }
): void {
  parent
    .command(options.name)
    .description(options.description)
    .option("--config <path>", "Path to WORKFLOW.md")
    .option("--workflow <path>", "Alias for --config")
    .option("--name <id>", "Named workflow id")
    .action(
      async (
        tuiOptions: { config?: string; workflow?: string; name?: string },
        command: Command
      ) => {
        assertNoUnsupportedOptionsForMaestroTui(command, formatCanonicalCommandPath(command));
        const workflowPath = readCommandTreeOption<string>(command, "config") ?? tuiOptions.workflow;
        await runMaestroTui({
          ...(workflowPath === undefined ? {} : { workflowPath }),
          ...(tuiOptions.name === undefined ? {} : { name: tuiOptions.name })
        });
      }
    );
}

function writeMaestroEventNdjson(event: MaestroEvent): void {
  process.stdout.write(`${JSON.stringify(event)}\n`);
}

function registerMaestroCommand(program: Command, container: CliContainer): void {
  const maestro = program
    .command("maestro")
    .description("Run the Maestro task-driven agent daemon.")
    .argument(
      "[path]",
      maestroCommandSchema.shape.path.description ?? "Path to WORKFLOW.md",
      maestroCommandSchema.shape.path.default
    )
    .option("--config <path>", "Alias for the [path] argument")
    .option(
      "-c, --max-concurrent <n>",
      maestroCommandSchema.shape.maxConcurrent.inner.description ??
        "Override agent.max_concurrent_agents",
      (value: string) => parseOptionalPositiveInteger(value, "--max-concurrent")
    )
    .option(
      "--poll-interval-ms <ms>",
      maestroCommandSchema.shape.pollIntervalMs.inner.description ?? "Override polling.interval_ms",
      (value: string) => parseOptionalPositiveInteger(value, "--poll-interval-ms")
    )
    .option(
      "--list <name>",
      maestroCommandSchema.shape.list.inner.description ?? "Override agent.list"
    )
    .option(
      "--dry-run",
      maestroCommandSchema.shape.dryRun.inner.description ??
        "Validate config, inspect candidates, and exit"
    )
    .option(
      "--yes",
      maestroCommandSchema.shape.yes.inner.description ?? "Accept defaults non-interactively"
    )
    .addOption(
      new Option(
        "--log-level <level>",
        maestroCommandSchema.shape.logLevel.description ?? "Log level"
      )
        .choices(maestroCommandSchema.shape.logLevel.values.map(String))
        .default(maestroCommandSchema.shape.logLevel.default)
    )
    .action(async (path: string, options: Omit<MaestroCommandArgs, "path">, command: Command) => {
      assertPathIsNotOptionName(path, command);
      const mergedOptions = {
        ...options,
        ...command.optsWithGlobals()
      } as Omit<MaestroCommandArgs, "path">;
      await runMaestro({
        workflowPath: mergedOptions.config ?? path,
        maxConcurrent: mergedOptions.maxConcurrent,
        pollIntervalMs: mergedOptions.pollIntervalMs,
        list: mergedOptions.list,
        dryRun: mergedOptions.dryRun,
        yes: mergedOptions.yes,
        logLevel: mergedOptions.logLevel,
        logger: createMaestroLogger(container, mergedOptions)
      });
    });

  maestro.hook("preSubcommand", (command, subCommand) => {
    if (subCommand.name() === "tui") {
      assertNoUnsupportedOptionsForMaestroTui(command, "poe-code maestro tui");
    }
  });

  maestro
    .command("run")
    .description("Run the Maestro task-driven agent daemon.")
    .option("--config <path>", "Path to WORKFLOW.md")
    .option("--name <id>", "Named workflow id")
    .option(
      "-c, --max-concurrent <n>",
      maestroCommandSchema.shape.maxConcurrent.inner.description ??
        "Override agent.max_concurrent_agents",
      (value: string) => parseOptionalPositiveInteger(value, "--max-concurrent")
    )
    .option(
      "--poll-interval-ms <ms>",
      maestroCommandSchema.shape.pollIntervalMs.inner.description ?? "Override polling.interval_ms",
      (value: string) => parseOptionalPositiveInteger(value, "--poll-interval-ms")
    )
    .option(
      "--list <name>",
      maestroCommandSchema.shape.list.inner.description ?? "Override agent.list"
    )
    .option(
      "--dry-run",
      maestroCommandSchema.shape.dryRun.inner.description ??
        "Validate config, inspect candidates, and exit"
    )
    .option(
      "--yes",
      maestroCommandSchema.shape.yes.inner.description ?? "Accept defaults non-interactively"
    )
    .addOption(
      new Option(
        "--log-level <level>",
        maestroCommandSchema.shape.logLevel.description ?? "Log level"
      )
        .choices(maestroCommandSchema.shape.logLevel.values.map(String))
        .default(maestroCommandSchema.shape.logLevel.default)
    )
    .action(async (options: MaestroRunCommandArgs, command: Command) => {
      await runMaestro({
        workflowPath: readCommandTreeOption<string>(command, "config"),
        name: options.name,
        maxConcurrent: options.maxConcurrent,
        pollIntervalMs: options.pollIntervalMs,
        list: options.list,
        dryRun: options.dryRun,
        yes: options.yes,
        logLevel: options.logLevel,
        logger: createMaestroLogger(container, options)
      });
    });

  maestro
    .command("tick")
    .description("Emit one Maestro tick event for an external trigger.")
    .requiredOption("--task <qualifiedId>", "Qualified task id")
    .requiredOption("--transition <fromState:toState>", "Transition edge")
    .option(
      "--list <name>",
      maestroCommandSchema.shape.list.inner.description ?? "Override agent.list"
    )
    .option("--config <path>", "Path to WORKFLOW.md")
    .option("--name <id>", "Named workflow id")
    .action(async (options: MaestroTickCommandArgs, command: Command) => {
      await runMaestroTick({
        task: options.task,
        transition: options.transition,
        list: options.list ?? readCommandTreeOption<string>(command, "list"),
        configPath: readCommandTreeOption<string>(command, "config"),
        name: options.name,
        dryRun: options.dryRun ?? readCommandTreeOption<boolean>(command, "dryRun"),
        onEvent: writeMaestroEventNdjson
      });
    });

  registerMaestroTuiCommand(maestro, {
    name: "tui",
    description: "Open the Maestro interactive task explorer."
  });
}

function buildToolcraftArgv(argv: string[], commandNames: readonly string[]): string[] {
  const entry = argv[0] ?? "node";
  const script = argv[1] ?? "cli";
  const commandNameSet = new Set(commandNames);
  const commandIndex = argv.findIndex((value, index) => index >= 2 && commandNameSet.has(value));

  if (commandIndex < 0) {
    return [entry, script];
  }

  const forwardedFlags: string[] = [];
  const rootArgs = argv.slice(2, commandIndex);
  for (let index = 0; index < rootArgs.length; index += 1) {
    const value = rootArgs[index]!;
    if (FORWARDABLE_TOOLCRAFT_FLAGS.has(value)) {
      forwardedFlags.push(value);
      continue;
    }
    if (value === "--output" && rootArgs[index + 1] !== undefined) {
      forwardedFlags.push(value, rootArgs[index + 1]!);
      index += 1;
    }
  }
  const commandArgs = argv.slice(commandIndex);

  if (commandArgs.length === 1) {
    return [entry, script, commandArgs[0]!, "--help", ...forwardedFlags];
  }

  return [entry, script, ...commandArgs, ...forwardedFlags];
}

function createToolcraftHumanInLoop(container: CliContainer) {
  return createHumanInLoop({
    provider: defaultProviderForPlatform(),
    taskList: {
      dir: join(container.env.cwd, ".poe-code", "approvals.yaml"),
      format: "yaml-file" as const
    }
  });
}

function registerForwardedToolcraftCommand(
  program: Command,
  container: CliContainer,
  options: {
    name: string;
    description: string;
    aliases?: readonly string[];
  },
  forwardedRoots: Group<object>[]
): void {
  const action = async () => {
    const originalArgv = [...process.argv];
    process.argv = buildToolcraftArgv(originalArgv, [options.name, ...(options.aliases ?? [])]);
    try {
      await runCLI(forwardedRoots, {
        approvals: true,
        controls: {
          debug: true,
          output: true,
          verbose: true,
          yes: true
        },
        // formatCommandHeader titles commander help as "Poe - <command path>" and
        // formatCanonicalCommandPath roots its usage line at the program name; toolcraft joins
        // both values with the command breadcrumb, so forwarded help renders identically.
        rootDisplayName: `${POE_HELP_TITLE_PREFIX} -`,
        rootUsageName: program.name(),
        humanInLoop: createToolcraftHumanInLoop(container)
      });
    } finally {
      process.argv = originalArgv;
    }
  };
  const command = program
    .command(options.name)
    .description(options.description)
    .aliases([...(options.aliases ?? [])])
    .argument("[args...]")
    .option("--output <format>", "Output format.")
    .allowUnknownOption()
    .allowExcessArguments()
    .helpOption(false)
    .action(action);

  const root = forwardedRoots.find((candidate) => candidate.name === options.name);
  if (root !== undefined) {
    registerForwardedToolcraftChildren(command, root.children, action);
  }
}

function registerForwardedToolcraftChildren(
  parent: Command,
  children: readonly CommandNode<object>[],
  action: () => Promise<void>
): void {
  for (const child of children) {
    const command = parent
      .command(child.name)
      .description(child.description ?? "")
      .aliases([...child.aliases])
      .argument("[args...]")
      .allowUnknownOption()
      .allowExcessArguments()
      .helpOption(false)
      .action(action);

    if (child.kind === "group") {
      registerForwardedToolcraftChildren(command, child.children, action);
    }
  }
}

export function createProgram(dependencies: CliDependencies): Command {
  const container = createCliContainer(dependencies);
  const program = bootstrapProgram(container);

  suppressImplicitHelpCommands(program);
  interceptUnknownHelpPaths(program, container);

  // Help and version exits are not errors: callers that asked for exitOverride
  // see Commander's own error, the real CLI keeps Commander's process exit.
  interceptCommanderInputErrors(
    program,
    (dependencies.exitOverride ?? true)
      ? (error) => {
          throw error;
        }
      : (error) => process.exit(error.exitCode)
  );

  if (dependencies.suppressCommanderOutput) {
    suppressCommanderOutput(program);
  }

  return program;
}

// Commander renders help before it rejects an unknown command, so `<group> <typo> --help`
// would answer with the group's own help and exit 0. Reject the typo first, at any depth.
function assertKnownHelpPath(program: Command, container: CliContainer, argv: string[]): void {
  let target = program;
  const path: string[] = [];

  for (const token of argv.filter((arg) => !arg.startsWith("-"))) {
    if (target.commands.length === 0) {
      return;
    }
    const child = findCommand(target, token);
    if (child !== undefined) {
      target = child;
      path.push(token);
      continue;
    }
    // A group that also takes positionals (or forwards them) consumes the token itself.
    if (target !== program && target.registeredArguments.length > 0) {
      return;
    }
    throwCommandNotFound({
      container,
      scope: target === program ? "cli" : target.name(),
      unknownCommand: token,
      helpArgs: [...path, "--help"],
      candidates: commandCandidates(target),
      moduleUrl: import.meta.url
    });
  }
}

function interceptUnknownHelpPaths(program: Command, container: CliContainer): void {
  const parseAsync = program.parseAsync.bind(program);
  program.parseAsync = async (argv, options) => {
    const commandArgs = (argv ?? process.argv).slice(2);
    if (commandArgs.includes("--help") || commandArgs.includes("-h")) {
      assertKnownHelpPath(program, container, commandArgs);
    }
    return parseAsync(argv, options);
  };
}

// Commander's implicit `help [command]` row duplicates --help with lowercase copy;
// every group suppresses it, so the root `help` command is the one way to ask by path.
function suppressImplicitHelpCommands(command: Command): void {
  command.helpCommand(false);
  for (const child of command.commands) {
    suppressImplicitHelpCommands(child);
  }
}

function findCommand(parent: Command, name: string): Command | undefined {
  return parent.commands.find(
    (command) => command.name() === name || command.aliases().includes(name)
  );
}

function commandCandidates(parent: Command): string[] {
  return parent.commands.flatMap((command) => [command.name(), ...command.aliases()]);
}

// The root action handler suppresses commander's implicit help command, so `poe-code help`
// needs an explicit registration to answer the conventional invocation.
function registerHelpCommand(program: Command, container: CliContainer): void {
  program
    .command("help")
    .description("Display help for a command.")
    .argument("[command...]", "Command path to describe, for example `maestro tui`.")
    .action((path: string[]) => {
      let target = program;
      for (const name of path) {
        const child = findCommand(target, name);
        if (child === undefined) {
          throwCommandNotFound({
            container,
            scope: "cli",
            unknownCommand: name,
            helpArgs: [...path.slice(0, path.indexOf(name)), "--help"],
            candidates: commandCandidates(target),
            moduleUrl: import.meta.url
          });
        }
        target = child;
      }
      target.outputHelp();
    });
}

function bootstrapProgram(container: CliContainer): Command {
  const program = new Command();
  const executionContext = detectExecutionContext({
    argv: process.argv,
    env: container.env.variables,
    moduleUrl: import.meta.url
  });
  const heading = resolveRootHelpHeading(process.argv);
  const usageCommand = formatCliUsageCommand(executionContext);
  const helpCommand = formatCliHelpCommand(executionContext, ["<command>", "--help"]);
  const toolcraftRoots = [
    evalGroup as Group<object>,
    ghGroup as Group<object>,
    superintendentGroup as Group<object>,
    codeReviewGroup as Group<object>
  ];

  program
    .name("poe-code")
    .description(POE_TAGLINE)
    .option("-y, --yes", "Accept defaults without prompting.")
    .option("--dry-run", "Simulate commands without writing changes.")
    .option("--verbose", "Show verbose logs.")
    .helpOption("-h, --help", "Display help for command")
    .showHelpAfterError(false)
    .showSuggestionAfterError(true)
    .configureHelp({
      showGlobalOptions: true,
      formatHelp: (cmd, helper) => {
        if (cmd.name() === "poe-code") {
          return formatHelpText({ command: cmd, heading, usageCommand, helpCommand, helper });
        }
        return formatSubcommandHelp(cmd, helper);
      }
    });

  registerVersionCommand(program, container, packageVersion);
  registerHelpCommand(program, container);
  registerInstallCommand(program, container);
  registerUpdateCommand(program, container, packageVersion);
  registerConfigureCommand(program, container);
  registerAgentCommand(program, container);
  const inProcessSpawnHandlers = {
    [POE_AGENT_SPAWN_SERVICE]: createPoeAgentSpawnHandler()
  };
  registerSpawnCommand(program, container, {
    handlers: inProcessSpawnHandlers,
    extraServices: Object.keys(inProcessSpawnHandlers)
  });
  registerGaslightCommand(program, container);
  registerTestCommand(program, container);
  registerUnconfigureCommand(program, container);
  registerLoginCommand(program, container);
  registerLogoutCommand(program, container);
  registerUtilsCommand(program, container);
  registerAuthCommand(program, container);
  registerSkillCommand(program, container);
  registerPipelineCommand(program, container);
  registerMaestroCommand(program, container);
  registerMaestroTuiCommand(program, {
    name: "dashboard",
    description: "Open the Maestro interactive task explorer."
  });
  registerPlanCommand(program, container);
  registerTracesCommand(program, container);
  registerRalphCommand(program, container);
  registerExperimentCommand(program, container);
  registerLaunchCommand(program, container);
  registerMemoryCommand(program, container);
  registerMemoryMcpCommand(program, container);
  registerProviderCommand(program, container);
  registerRuntimeCommand(program, container);
  registerHarnessCommand(program, container);
  registerWorktreeCommand(program, container);
  registerBraintrustCommand(program, container);
  registerDoctorCommand(program, container);
  registerTasksCommand(program, container);
  registerForwardedToolcraftCommand(
    program,
    container,
    {
      name: evalGroup.name,
      description: evalGroup.description ?? "",
      aliases: evalGroup.aliases
    },
    toolcraftRoots
  );
  registerForwardedToolcraftCommand(
    program,
    container,
    {
      name: ghGroup.name,
      description: ghGroup.description ?? "",
      aliases: ghGroup.aliases
    },
    toolcraftRoots
  );
  registerForwardedToolcraftCommand(
    program,
    container,
    {
      name: codeReviewGroup.name,
      description: codeReviewGroup.description ?? "",
      aliases: codeReviewGroup.aliases
    },
    toolcraftRoots
  );
  registerForwardedToolcraftCommand(
    program,
    container,
    {
      name: superintendentGroup.name,
      description: superintendentGroup.description ?? "",
      aliases: superintendentGroup.aliases
    },
    toolcraftRoots
  );
  registerForwardedToolcraftCommand(
    program,
    container,
    {
      name: "approvals",
      description: "Inspect and execute queued approvals."
    },
    toolcraftRoots
  );
  registerUsageCommand(program, container);
  registerModelsCommand(program, container);
  // Last: the emitted script is derived from the command tree, so every command must be registered.
  registerCompletionCommand(program);

  program.allowExcessArguments().action(function (this: Command) {
    const args = this.args;
    if (args.length > 0) {
      throwCommandNotFound({
        container,
        scope: "cli",
        unknownCommand: args.at(0) ?? "",
        helpArgs: ["--help"],
        candidates: commandCandidates(program),
        moduleUrl: import.meta.url
      });
    }
    this.outputHelp();
  });

  return program;
}

export type { CliDependencies };

function suppressCommanderOutput(command: Command): void {
  command.configureOutput({
    writeOut: () => {},
    writeErr: () => {}
  });
  for (const child of command.commands) {
    suppressCommanderOutput(child);
  }
}
