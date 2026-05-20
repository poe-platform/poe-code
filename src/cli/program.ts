import { basename, join } from "node:path";
import { Command, Help, InvalidArgumentError, Option } from "commander";
import type { CommandNode, Group } from "toolcraft";
import { S, type Static } from "toolcraft-schema";
import { runCLI } from "toolcraft/cli";
import { evalGroup } from "@poe-code/agent-eval";
import { ghGroup } from "@poe-code/github-workflows";
import { superintendentGroup } from "@poe-code/superintendent";
import { runMaestro, type Logger as MaestroLogger } from "@poe-code/agent-maestro";
import { createCliContainer, type CliContainer, type CliDependencies } from "./container.js";
import { text } from "@poe-code/design-system";
import { registerConfigureCommand } from "./commands/configure.js";
import { registerAgentCommand } from "./commands/agent.js";
import { registerSpawnCommand } from "./commands/spawn.js";
import { createPoeAgentSpawnHandler } from "./commands/spawn-poe-agent.js";
import { registerWrapCommand } from "./commands/wrap.js";
import { registerLoginCommand } from "./commands/login.js";
import { registerLogoutCommand } from "./commands/logout.js";
import { registerAuthCommand } from "./commands/auth.js";
import { registerUtilsCommand } from "./commands/utils.js";
import { registerInstallCommand } from "./commands/install.js";
import { registerUnconfigureCommand } from "./commands/unconfigure.js";
import { registerTestCommand } from "./commands/test.js";
import { registerGenerateCommand } from "./commands/generate.js";
import { registerMcpCommand } from "./commands/mcp.js";
import { registerSkillCommand } from "./commands/skill.js";
import { registerVersionOption } from "./commands/version.js";
import { registerUsageCommand } from "./commands/usage.js";
import { registerModelsCommand } from "./commands/models.js";
import { registerPipelineCommand } from "./commands/pipeline.js";
import { registerPlanCommand } from "./commands/plan.js";
import { registerRalphCommand } from "./commands/ralph.js";
import { registerExperimentCommand } from "./commands/experiment.js";
import { registerLaunchCommand } from "./commands/launch.js";
import { registerMemoryCommand } from "./commands/memory.js";
import { registerProviderCommand } from "./commands/provider.js";
import { registerRuntimeCommand } from "./commands/runtime/index.js";
import { registerHarnessCommand } from "./commands/harness.js";
import { registerBraintrustCommand } from "./commands/braintrust.js";
import { registerTasksCommand } from "./commands/tasks.js";
import packageJson from "../../package.json" with { type: "json" };
import { throwCommandNotFound } from "./command-not-found.js";
import {
  detectExecutionContext,
  formatCliHelpCommand,
  formatCliUsageCommand
} from "../utils/execution-context.js";

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
  return `Poe - ${parts.reverse().join(" ")}`;
}

interface RootHelpCommandSpec {
  path: readonly string[];
  args?: string;
}

const ROOT_HELP_COMMAND_SPECS: readonly RootHelpCommandSpec[] = [
  { path: ["install"] },
  { path: ["configure"] },
  { path: ["unconfigure"] },
  { path: ["login"] },
  { path: ["logout"] },
  { path: ["auth"] },
  { path: ["agent"] },
  { path: ["spawn"] },
  { path: ["wrap"] },
  { path: ["test"] },
  { path: ["generate"] },
  { path: ["models"] },
  { path: ["tasks", "verify"], args: "<list>" },
  { path: ["tasks", "sync"], args: "<list>" },
  { path: ["mcp", "configure"] },
  { path: ["mcp", "unconfigure"] },
  { path: ["skill", "configure"] },
  { path: ["skill", "unconfigure"] },
  { path: ["pipeline", "install"] },
  { path: ["pipeline", "run"] },
  { path: ["pipeline", "validate"] },
  { path: ["eval", "run"] },
  { path: ["eval", "report"], args: "[run-id]" },
  { path: ["eval", "init"], args: "<name>" },
  { path: ["eval", "check"], args: "[eval-id]" },
  { path: ["eval", "lint"], args: "[eval-id]" },
  { path: ["maestro"], args: "[path]" },
  { path: ["plan"], args: "[question]" },
  { path: ["plan", "install"] },
  { path: ["plan", "browse"] },
  { path: ["plan", "markdown-read"], args: "<file>" },
  { path: ["plan", "markdown-read-section"], args: "<file> <section>" },
  { path: ["plan", "markdown-reader-mcp"] },
  { path: ["memory", "init"] },
  { path: ["memory", "ls"] },
  { path: ["memory", "status"] },
  { path: ["provider", "list"] },
  { path: ["provider", "login"], args: "<id>" },
  { path: ["provider", "logout"], args: "<id>" },
  { path: ["braintrust", "status"] },
  { path: ["runtime", "init"] },
  { path: ["runtime", "build"] },
  { path: ["runtime", "templates", "ls"] },
  { path: ["runtime", "templates", "clear"] },
  { path: ["harness", "run"] },
  { path: ["harness", "new"], args: "<kind> <basename>" },
  { path: ["harness", "list"] },
  { path: ["experiment", "install"] },
  { path: ["experiment", "run"] },
  { path: ["experiment", "journal"] },
  { path: ["experiment", "validate"] },
  { path: ["ralph", "init"] },
  { path: ["ralph", "run"] },
  { path: ["launch"] },
  { path: ["approvals"], args: "[command]" },
  { path: ["github-workflows"], args: "[automation]" },
  { path: ["usage"] },
  { path: ["usage", "list"] },
  { path: ["utils", "config"] }
] as const;

function findCommandByPath(root: Command, path: readonly string[]): Command {
  let current = root;

  for (const segment of path) {
    const next = current.commands.find(
      (command) => Reflect.get(command, "_hidden") !== true && command.name() === segment
    );
    if (!next) {
      throw new Error(`Root help command is missing: ${path.join(" ")}`);
    }
    current = next;
  }

  return current;
}

function formatRootHelpCommandName(path: readonly string[], command: Command): string {
  const leaf = [command.name(), ...command.aliases()].join(", ");
  return path.length > 1 ? [...path.slice(0, -1), leaf].join(" ") : leaf;
}

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
  return formatUsage(command.usage(), ["[options]", "[command]"]);
}

function buildRootHelpRows(root: Command): Array<{
  name: string;
  args: string;
  description: string;
}> {
  return ROOT_HELP_COMMAND_SPECS.map((spec) => {
    const command = findCommandByPath(root, spec.path);
    return {
      name: formatRootHelpCommandName(spec.path, command),
      args: spec.args ?? formatRootHelpCommandArgs(command),
      description: command.description()
    };
  });
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
  const usage = formatUsage(cmd.usage(), ["[command]"]);
  const commandPath = formatCanonicalCommandPath(cmd);
  return usage.length > 0 ? `${commandPath} ${usage}` : commandPath;
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
  const commandRows = buildRootHelpRows(input.command);
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

  return [
    text.heading(input.heading),
    "",
    "Configure coding agents to use the Poe API.",
    "",
    `${text.section("Usage:")} ${text.usageCommand(input.usageCommand)} ${text.argument("<command> [...args]")}`,
    "",
    text.section("Commands:"),
    ...commandRows.map(cmd),
    "",
    `${text.muted("Run")} ${text.usageCommand(input.helpCommand)} ${text.muted("for command options.")}`,
    "",
    `${text.muted("Learn more about Poe:")}            ${text.link("https://poe.com/api")}`,
    `${text.muted("GitHub:")}                          ${text.link("https://github.com/poe-platform/poe-code")}`
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

  const optionList = helper
    .visibleOptions(cmd)
    .map((option) =>
      formatItem(helper.optionTerm(option), helper.optionDescription(option), text.option)
    );
  if (optionList.length > 0) {
    output.push(text.section("Options:"), formatList(optionList), "");
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

  return output.join("\n");
}

function resolveRootHelpHeading(argv: string[]): string {
  const invoked = basename(argv[1] ?? "");
  if (invoked === "poe" || invoked === "poe.cmd" || invoked === "poe.exe") {
    return "Poe";
  }
  return "Poe - poe-code";
}

const FORWARDABLE_TOOLCRAFT_FLAGS = new Set(["-y", "--yes", "--verbose"]);

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

type MaestroCommandArgs = Static<typeof maestroCommandSchema>;

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

function registerMaestroCommand(program: Command, container: CliContainer): void {
  program
    .command("maestro")
    .description("Run the Maestro task-driven agent daemon.")
    .argument(
      "[path]",
      maestroCommandSchema.shape.path.description ?? "Path to WORKFLOW.md",
      maestroCommandSchema.shape.path.default
    )
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
      const mergedOptions = {
        ...options,
        ...command.optsWithGlobals()
      } as Omit<MaestroCommandArgs, "path">;
      await runMaestro({
        workflowPath: path,
        maxConcurrent: mergedOptions.maxConcurrent,
        pollIntervalMs: mergedOptions.pollIntervalMs,
        list: mergedOptions.list,
        dryRun: mergedOptions.dryRun,
        yes: mergedOptions.yes,
        logLevel: mergedOptions.logLevel,
        logger: createMaestroLogger(container, mergedOptions)
      });
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

  const forwardedFlags = argv
    .slice(2, commandIndex)
    .filter((value) => FORWARDABLE_TOOLCRAFT_FLAGS.has(value));
  const commandArgs = argv.slice(commandIndex);

  if (commandArgs.length === 1) {
    return [entry, script, ...forwardedFlags, commandArgs[0]!, "--help"];
  }

  return [entry, script, ...forwardedFlags, ...commandArgs];
}

function createToolcraftHumanInLoopOptions(container: CliContainer) {
  return {
    taskList: {
      dir: join(container.env.cwd, ".poe-code", "approvals.yaml"),
      format: "yaml-file" as const
    }
  };
}

function registerForwardedToolcraftCommand(
  program: Command,
  container: CliContainer,
  options: {
    name: string;
    description: string;
    aliases?: readonly string[];
  },
  forwardedRoots: Group<object>[],
  heading: string,
  usageCommand: string
): void {
  const action = async () => {
    const originalArgv = [...process.argv];
    process.argv = buildToolcraftArgv(originalArgv, [options.name, ...(options.aliases ?? [])]);
    try {
      await runCLI(forwardedRoots, {
        rootDisplayName: heading,
        rootUsageName: usageCommand,
        humanInLoop: createToolcraftHumanInLoopOptions(container)
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

  if (dependencies.exitOverride ?? true) {
    applyExitOverride(program);
  }

  if (dependencies.suppressCommanderOutput) {
    suppressCommanderOutput(program);
  }

  return program;
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
    superintendentGroup as Group<object>
  ];

  program
    .name("poe-code")
    .description("Configure Poe API integrations for local developer tooling.")
    .option("-y, --yes", "Accept defaults without prompting.")
    .option("--dry-run", "Simulate commands without writing changes.")
    .option("--verbose", "Show verbose logs.")
    .helpOption("-h, --help", "Display help for command")
    .showHelpAfterError(false)
    .showSuggestionAfterError(true)
    .configureHelp({
      formatHelp: (cmd, helper) => {
        if (cmd.name() === "poe-code") {
          return formatHelpText({ command: cmd, heading, usageCommand, helpCommand, helper });
        }
        return formatSubcommandHelp(cmd, helper);
      }
    });

  registerVersionOption(program, container, packageJson.version);
  registerInstallCommand(program, container);
  registerConfigureCommand(program, container);
  registerAgentCommand(program, container);
  registerSpawnCommand(program, container, {
    handlers: { "poe-agent": createPoeAgentSpawnHandler() },
    extraServices: ["poe-agent"]
  });
  registerWrapCommand(program, container);
  registerGenerateCommand(program, container);
  registerTestCommand(program, container);
  registerUnconfigureCommand(program, container);
  registerLoginCommand(program, container);
  registerLogoutCommand(program, container);
  registerUtilsCommand(program, container);
  registerAuthCommand(program, container);
  registerMcpCommand(program, container);
  registerSkillCommand(program, container);
  registerPipelineCommand(program, container);
  registerMaestroCommand(program, container);
  registerPlanCommand(program, container);
  registerRalphCommand(program, container);
  registerExperimentCommand(program, container);
  registerLaunchCommand(program, container);
  registerMemoryCommand(program, container);
  registerProviderCommand(program, container);
  registerRuntimeCommand(program, container);
  registerHarnessCommand(program, container);
  registerBraintrustCommand(program, container);
  registerTasksCommand(program, container);
  registerForwardedToolcraftCommand(
    program,
    container,
    {
      name: evalGroup.name,
      description: evalGroup.description ?? "",
      aliases: evalGroup.aliases
    },
    toolcraftRoots,
    heading,
    usageCommand
  );
  registerForwardedToolcraftCommand(
    program,
    container,
    {
      name: ghGroup.name,
      description: ghGroup.description ?? "",
      aliases: ghGroup.aliases
    },
    toolcraftRoots,
    heading,
    usageCommand
  );
  registerForwardedToolcraftCommand(
    program,
    container,
    {
      name: superintendentGroup.name,
      description: superintendentGroup.description ?? "",
      aliases: superintendentGroup.aliases
    },
    toolcraftRoots,
    heading,
    usageCommand
  );
  registerForwardedToolcraftCommand(
    program,
    container,
    {
      name: "approvals",
      description: "Inspect and execute queued approvals."
    },
    toolcraftRoots,
    heading,
    usageCommand
  );
  registerUsageCommand(program, container);
  registerModelsCommand(program, container);

  program.allowExcessArguments().action(function (this: Command) {
    const args = this.args;
    if (args.length > 0) {
      throwCommandNotFound({
        container,
        scope: "cli",
        unknownCommand: args.at(0) ?? "",
        helpArgs: ["--help"],
        moduleUrl: import.meta.url
      });
    }
    this.outputHelp();
  });

  return program;
}

export type { CliDependencies };

function applyExitOverride(command: Command): void {
  command.exitOverride();
  for (const child of command.commands) {
    applyExitOverride(child);
  }
}

function suppressCommanderOutput(command: Command): void {
  command.configureOutput({
    writeOut: () => {},
    writeErr: () => {}
  });
  for (const child of command.commands) {
    suppressCommanderOutput(child);
  }
}
