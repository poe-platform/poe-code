import { basename } from "node:path";
import { Command, Help } from "commander";
import { createCliContainer, type CliContainer, type CliDependencies } from "./container.js";
import { text } from "@poe-code/design-system";
import { registerConfigureCommand } from "./commands/configure.js";
import { registerAgentCommand } from "./commands/agent.js";
import { registerSpawnCommand } from "./commands/spawn.js";
import { registerResearchCommand } from "./commands/research.js";
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

function formatHelpText(input: {
  heading: string;
  usageCommand: string;
  helpCommand: string;
}): string {
  const commandRows: Array<{
    name: string;
    aliases: string[];
    args: string;
    description: string;
  }> = [
    {
      name: "install",
      aliases: ["i"],
      args: "[agent]",
      description: "Install agent binary for a configured agent"
    },
    {
      name: "configure",
      aliases: ["c"],
      args: "[agent]",
      description: "Configure a coding agent"
    },
    {
      name: "unconfigure",
      aliases: ["uc"],
      args: "<agent>",
      description: "Remove a previously applied configuration"
    },
    {
      name: "login",
      aliases: [],
      args: "",
      description: "Store a Poe API key"
    },
    {
      name: "logout",
      aliases: [],
      args: "",
      description: "Remove all configuration"
    },
    {
      name: "auth status",
      aliases: [],
      args: "",
      description: "Show login status"
    },
    {
      name: "agent",
      aliases: [],
      args: "<prompt>",
      description: "Run a one-shot Poe agent prompt"
    },
    {
      name: "spawn",
      aliases: ["s"],
      args: "<agent> [prompt]",
      description: "Launch a coding agent"
    },
    {
      name: "wrap",
      aliases: ["w"],
      args: "<agent> [agentArgs...]",
      description: "Run an agent with Poe isolated configuration"
    },
    {
      name: "generate",
      aliases: ["g"],
      args: "[type]",
      description: "Call Poe models via CLI (text/image/video/audio)"
    },
    {
      name: "models",
      aliases: ["m"],
      args: "",
      description: "List available Poe API models"
    },
    {
      name: "mcp configure",
      aliases: [],
      args: "[agent]",
      description: "Configure Poe MCP for your coding agent"
    },
    {
      name: "mcp unconfigure",
      aliases: [],
      args: "<agent>",
      description: "Remove Poe MCP configuration from your agent"
    },
    {
      name: "experiment install",
      aliases: [],
      args: "[agent]",
      description: "Install the experiment skill into agent configuration"
    },
    {
      name: "skill configure",
      aliases: [],
      args: "[agent]",
      description: "Configure agent skills to call Poe models"
    },
    {
      name: "skill unconfigure",
      aliases: [],
      args: "[agent]",
      description: "Remove agent skills configuration"
    },
    {
      name: "pipeline install",
      aliases: [],
      args: "[agent]",
      description: "Install pipeline skill into agent configuration"
    },
    {
      name: "pipeline run",
      aliases: [],
      args: "",
      description: "Run a fixed-step task pipeline plan"
    },
    {
      name: "ralph init",
      aliases: [],
      args: "[doc]",
      description: "Write Ralph config into a markdown doc frontmatter"
    },
    {
      name: "ralph run",
      aliases: [],
      args: "[doc]",
      description: "Run a markdown doc through repeated agent iterations"
    },
    {
      name: "experiment run",
      aliases: [],
      args: "[doc]",
      description: "Run an experiment doc through the autonomous experiment loop"
    },
    {
      name: "experiment journal",
      aliases: [],
      args: "[doc]",
      description: "Display an experiment journal as a formatted table"
    },
    {
      name: "usage",
      aliases: ["u"],
      args: "",
      description: "Display current Poe compute points balance"
    },
    {
      name: "usage list",
      aliases: [],
      args: "",
      description: "Display usage history"
    },
    {
      name: "utils config",
      aliases: [],
      args: "",
      description: "Show config file paths and usage hints"
    }
  ];
  const nameWidth = Math.max(
    0,
    ...commandRows.map((row) => [row.name, ...row.aliases].join(", ").length)
  );
  const argsWidth = Math.max(0, ...commandRows.map((row) => row.args.length));
  const cmd = (row: (typeof commandRows)[number]) => {
    const displayName = [row.name, ...row.aliases].join(", ");
    const name = text.command(displayName.padEnd(nameWidth));
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
  output.push(`${text.section("Usage:")} ${text.usageCommand(helper.commandUsage(cmd))}`, "");

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
          return formatHelpText({ heading, usageCommand, helpCommand });
        }
        return formatSubcommandHelp(cmd, helper);
      }
    });

  registerVersionOption(program, container, packageJson.version);
  registerInstallCommand(program, container);
  registerConfigureCommand(program, container);
  registerAgentCommand(program, container);
  registerSpawnCommand(program, container);
  registerResearchCommand(program, container);
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
