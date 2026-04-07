import { basename } from "node:path";
import { Command, Help } from "commander";
import type { Group } from "@poe-code/cmdkit";
import { runCLI } from "@poe-code/cmdkit/cli";
import { ghGroup } from "@poe-code/github-workflows";
import { createCliContainer, type CliContainer, type CliDependencies } from "./container.js";
import { text } from "@poe-code/design-system";
import { registerConfigureCommand } from "./commands/configure.js";
import { registerAgentCommand } from "./commands/agent.js";
import { registerSpawnCommand } from "./commands/spawn.js";
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
import { registerRalphCommand } from "./commands/ralph.js";
import { registerExperimentCommand } from "./commands/experiment.js";
import { registerLaunchCommand } from "./commands/launch.js";
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
  { path: ["auth", "status"] },
  { path: ["agent"] },
  { path: ["spawn"] },
  { path: ["wrap"] },
  { path: ["generate"] },
  { path: ["models"] },
  { path: ["mcp", "configure"] },
  { path: ["mcp", "unconfigure"] },
  { path: ["experiment", "install"] },
  { path: ["skill", "configure"] },
  { path: ["skill", "unconfigure"] },
  { path: ["pipeline", "install"] },
  { path: ["pipeline", "run"] },
  { path: ["ralph", "init"] },
  { path: ["ralph", "run"] },
  { path: ["experiment", "run"] },
  { path: ["experiment", "journal"] },
  { path: ["launch"] },
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

function formatRootHelpCommandArgs(command: Command): string {
  const parts = command
    .usage()
    .split(" ")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
  const filtered: string[] = [];

  for (const part of parts) {
    if (part === "[options]" || part === "[command]") {
      continue;
    }
    filtered.push(part);
  }

  return filtered.join(" ");
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
  const usage = cmd.usage().trim();
  const commandPath = formatCanonicalCommandPath(cmd);
  return usage.length > 0 ? `${commandPath} ${usage}` : commandPath;
}

function formatHelpText(input: {
  command: Command;
  heading: string;
  usageCommand: string;
  helpCommand: string;
}): string {
  const commandRows = buildRootHelpRows(input.command);
  const nameWidth = Math.max(
    0,
    ...commandRows.map((row) => row.name.length)
  );
  const argsWidth = Math.max(0, ...commandRows.map((row) => row.args.length));
  const cmd = (row: (typeof commandRows)[number]) => {
    const name = text.command(row.name.padEnd(nameWidth));
    const args =
      row.args.length > 0 ? text.argument(row.args.padEnd(argsWidth)) : " ".repeat(argsWidth);
    return `  ${name} ${args}  ${row.description}`;
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
  const itemIndentWidth = 2;
  const itemSeparatorWidth = 2;
  const padWidth = termWidth + itemSeparatorWidth;
  const indent = " ".repeat(itemIndentWidth);

  const formatItem = (
    term: string,
    description: string,
    style: (value: string) => string
  ): string => {
    const padding = " ".repeat(Math.max(0, padWidth - term.length));
    const styledTerm = `${style(term)}${padding}`;
    if (!description) {
      return style(term);
    }
    return `${styledTerm}${description}`;
  };

  const indentBlock = (value: string): string =>
    value
      .split("\n")
      .map((line) => `${indent}${line}`)
      .join("\n");

  const formatList = (items: string[]): string => items.map(indentBlock).join("\n");

  const output: string[] = [];
  output.push(text.heading(formatCommandHeader(cmd)), "");
  output.push(`${text.section("Usage:")} ${text.usageCommand(formatCanonicalCommandUsage(cmd))}`, "");

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

const FORWARDABLE_CMDKIT_FLAGS = new Set(["-y", "--yes", "--verbose"]);

function buildCmdkitArgv(argv: string[], group: Group): string[] {
  const entry = argv[0] ?? "node";
  const script = argv[1] ?? "cli";
  const commandNames = new Set([group.name, ...group.aliases]);
  const commandIndex = argv.findIndex((value, index) => index >= 2 && commandNames.has(value));

  if (commandIndex < 0) {
    return [entry, script];
  }

  const forwardedFlags = argv.slice(2, commandIndex).filter((value) => FORWARDABLE_CMDKIT_FLAGS.has(value));
  const commandArgs = argv.slice(commandIndex + 1);

  if (commandArgs.length === 0) {
    return [entry, script, ...forwardedFlags, "--help"];
  }

  return [entry, script, ...forwardedFlags, ...commandArgs];
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
          return formatHelpText({ command: cmd, heading, usageCommand, helpCommand });
        }
        return formatSubcommandHelp(cmd, helper);
      }
    });

  registerVersionOption(program, container, packageJson.version);
  registerInstallCommand(program, container);
  registerConfigureCommand(program, container);
  registerAgentCommand(program, container);
  registerSpawnCommand(program, container);
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
  registerRalphCommand(program, container);
  registerExperimentCommand(program, container);
  registerLaunchCommand(program, container);
  program
    .command(ghGroup.name)
    .description(ghGroup.description ?? "")
    .aliases(ghGroup.aliases)
    .argument("[args...]")
    .allowUnknownOption()
    .allowExcessArguments()
    .helpOption(false)
    .action(async () => {
      const originalArgv = [...process.argv];
      process.argv = buildCmdkitArgv(originalArgv, ghGroup);
      try {
        await runCLI(ghGroup, { rootDisplayName: `Poe - ${ghGroup.name}` });
      } finally {
        process.argv = originalArgv;
      }
    });
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
