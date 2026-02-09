import { Command, Help } from "commander";
import {
  createCliContainer,
  type CliContainer,
  type CliDependencies
} from "./container.js";
import { text } from "@poe-code/design-system";
import { registerConfigureCommand } from "./commands/configure.js";
import { registerSpawnCommand } from "./commands/spawn.js";
import { registerWrapCommand } from "./commands/wrap.js";
import { registerLoginCommand } from "./commands/login.js";
import { registerInstallCommand } from "./commands/install.js";
import { registerUnconfigureCommand } from "./commands/unconfigure.js";
import { registerTestCommand } from "./commands/test.js";
import { registerGenerateCommand } from "./commands/generate.js";
import { registerMcpCommand } from "./commands/mcp.js";
import { registerSkillCommand } from "./commands/skill.js";
import { registerVersionOption } from "./commands/version.js";
import { registerRalphCommand } from "./commands/ralph.js";
import { registerUsageCommand } from "./commands/usage.js";
import { registerModelsCommand } from "./commands/models.js";
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
  usageCommand: string;
  helpCommand: string;
}): string {
  const commandRows: Array<{ name: string; args: string; description: string }> =
    [
      {
        name: "configure",
        args: "[agent]",
        description: "Configure a coding agent (claude-code, codex, opencode)"
      },
      {
        name: "unconfigure",
        args: "<agent>",
        description: "Remove a previously applied configuration"
      },
      {
        name: "spawn",
        args: "<agent> [prompt]",
        description: "Launch a coding agent"
      },
      {
        name: "generate",
        args: "[type]",
        description: "Call Poe models via CLI (text/image/video/audio)"
      },
      {
        name: "mcp configure",
        args: "[agent]",
        description: "Configure Poe MCP for your coding agent"
      },
      {
        name: "mcp unconfigure",
        args: "<agent>",
        description: "Remove Poe MCP configuration from your agent"
      },
      {
        name: "mcp serve",
        args: "",
        description: "Run the Poe MCP server on stdin/stdout"
      },
      {
        name: "skill configure",
        args: "[agent]",
        description: "Configure agent skills to call Poe models"
      },
      {
        name: "skill unconfigure",
        args: "[agent]",
        description: "Remove agent skills configuration"
      },
      {
        name: "usage",
        args: "",
        description: "Display current Poe compute points balance"
      },
      {
        name: "usage list",
        args: "",
        description: "Display usage history"
      }
    ];
  const nameWidth = Math.max(0, ...commandRows.map((row) => row.name.length));
  const argsWidth = Math.max(
    0,
    ...commandRows.map((row) => row.args.length)
  );
  const cmd = (row: (typeof commandRows)[number]) => {
    const name = text.command(row.name.padEnd(nameWidth));
    const args = row.args.length > 0
      ? text.argument(row.args.padEnd(argsWidth))
      : " ".repeat(argsWidth);
    return `  ${name} ${args}  ${row.description}`;
  };

  return [
    text.heading("Poe - poe-code"),
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

function formatSubcommandHelp(
  cmd: Command,
  helper: Help
): string {
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

  const formatList = (items: string[]): string =>
    items.map(indentBlock).join("\n");

  const output: string[] = [];
  output.push(text.heading(formatCommandHeader(cmd)), "");
  output.push(
    `${text.section("Usage:")} ${text.usageCommand(helper.commandUsage(cmd))}`,
    ""
  );

  const commandDescription = helper.commandDescription(cmd);
  if (commandDescription.length > 0) {
    output.push(commandDescription, "");
  }

  const argumentList = helper.visibleArguments(cmd).map((argument) =>
    formatItem(
      helper.argumentTerm(argument),
      helper.argumentDescription(argument),
      text.argument
    )
  );
  if (argumentList.length > 0) {
    output.push(text.section("Arguments:"), formatList(argumentList), "");
  }

  const optionList = helper.visibleOptions(cmd).map((option) =>
    formatItem(
      helper.optionTerm(option),
      helper.optionDescription(option),
      text.option
    )
  );
  if (optionList.length > 0) {
    output.push(text.section("Options:"), formatList(optionList), "");
  }

  if (helper.showGlobalOptions) {
    const globalOptionList = helper.visibleGlobalOptions(cmd).map((option) =>
      formatItem(
        helper.optionTerm(option),
        helper.optionDescription(option),
        text.option
      )
    );
    if (globalOptionList.length > 0) {
      output.push(
        text.section("Global Options:"),
        formatList(globalOptionList),
        ""
      );
    }
  }

  const commandList = helper.visibleCommands(cmd).map((subcommand) =>
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
  const usageCommand = formatCliUsageCommand(executionContext);
  const helpCommand = formatCliHelpCommand(executionContext, [
    "<command>",
    "--help"
  ]);

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
          return formatHelpText({ usageCommand, helpCommand });
        }
        return formatSubcommandHelp(cmd, helper);
      }
    });

  registerVersionOption(program, container, packageJson.version);
  registerInstallCommand(program, container);
  registerConfigureCommand(program, container);
  registerSpawnCommand(program, container);
  registerWrapCommand(program, container);
  registerGenerateCommand(program, container);
  registerTestCommand(program, container);
  registerUnconfigureCommand(program, container);
  registerLoginCommand(program, container);
  registerMcpCommand(program, container);
  registerSkillCommand(program, container);
  registerRalphCommand(program, container);
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
