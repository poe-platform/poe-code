import { Command, Help } from "commander";
import { createRequire } from "node:module";
import {
  createCliContainer,
  type CliContainer,
  type CliDependencies
} from "./container.js";
import {
  createCliDesignLanguage,
  type CliDesignLanguage
} from "./ui/design-language.js";
import { registerConfigureCommand } from "./commands/configure.js";
import { registerSpawnCommand } from "./commands/spawn.js";
import { registerWrapCommand } from "./commands/wrap.js";
import { registerLoginCommand } from "./commands/login.js";
import { registerInstallCommand } from "./commands/install.js";
import { registerUnconfigureCommand } from "./commands/unconfigure.js";
import { registerTestCommand } from "./commands/test.js";
import { registerGenerateCommand } from "./commands/generate.js";
import { registerVersionOption } from "./commands/version.js";

const require = createRequire(import.meta.url);
const packageJson = require("../../package.json") as { version: string };

function formatHelpText(design: CliDesignLanguage): string {
  const { text } = design;

  const commandWidth = 11;
  const cmd = (name: string, args: string) => {
    const padded = name.padEnd(commandWidth);
    const argument = args ? ` ${text.argument(args)}` : "";
    return `  ${text.command(padded)}${argument}`;
  };
  const example = (value: string) =>
    `                                 ${text.example(value)}`;
  const opt = (flag: string, desc: string) =>
    `  ${text.option(flag.padEnd(27))}${desc}`;

  return [
    text.heading("Configure coding agents to use the Poe API."),
    "",
    `${text.section("Usage:")} ${text.usageCommand("poe-code")} ${text.argument("<command> [...options]")}`,
    "",
    text.section("Commands:"),
    cmd("configure", "[agent]") + "            Configure developer tooling for Poe API",
    example("poe-code configure claude-code"),
    "",
    cmd("unconfigure", "<agent>") + "       Remove existing Poe API tooling configuration",
    example("poe-code unconfigure codex"),
    "",
    cmd("install", "[agent]") + "            Install tooling for a configured agent",
    example("poe-code install opencode"),
    "",
    cmd("spawn", "<agent> [prompt]") + "   Run a single prompt through a configured agent CLI",
    example("poe-code spawn codex \"Say hello\""),
    "",
    cmd("wrap", "<agent>") + "            Run an agent CLI with Poe isolated configuration",
    example("poe-code wrap claude-code --help"),
    "",
    cmd("test", "[agent]") + "            Run agent health checks",
    example("poe-code test codex"),
    "",
    cmd("generate", "[type]") + "         Generate text or media via Poe API",
    example("poe-code generate \"What is 2+2?\""),
    "",
    cmd("login", "") + "                          Store a Poe API key for reuse across commands",
    "",
    text.section("Options:"),
    opt("-y, --yes", "Accept defaults without prompting"),
    opt("--dry-run", "Simulate commands without writing changes"),
    opt("--verbose", "Show verbose logs"),
    opt("-V, --version", "Output the version number"),
    opt("-h, --help", "Display help for command"),
    "",
    opt("<command> --help", "Print help text for command"),
    "",
    `${text.muted("Learn more about Poe:")}            ${text.link("https://poe.com")}`,
    `${text.muted("GitHub:")}                          ${text.link("https://github.com/poe-platform/poe-code")}`
  ].join("\n");
}

function formatSubcommandHelp(
  cmd: Command,
  helper: Help,
  design: CliDesignLanguage
): string {
  const { text } = design;
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
  output.push(text.heading(`Poe - ${cmd.name()}`), "");
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
  const design = createCliDesignLanguage(container.env);
  program
    .name("poe-code")
    .description("Configure Poe API integrations for local developer tooling.")
    .option("-y, --yes", "Accept defaults without prompting.")
    .option("--dry-run", "Simulate commands without writing changes.")
    .option("--verbose", "Show verbose logs.")
    .helpOption("-h, --help", "Display help for command")
    .configureHelp({
      formatHelp: (cmd, helper) => {
        if (cmd.name() === "poe-code") {
          return formatHelpText(design);
        }
        return formatSubcommandHelp(cmd, helper, design);
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

  program.action(() => {
    program.outputHelp();
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
