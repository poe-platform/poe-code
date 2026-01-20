import { Command, Help } from "commander";
import chalk from "chalk";
import { createRequire } from "node:module";
import {
  createCliContainer,
  type CliContainer,
  type CliDependencies
} from "./container.js";
import { registerConfigureCommand } from "./commands/configure.js";
import { registerSpawnCommand } from "./commands/spawn.js";
import { registerWrapCommand } from "./commands/wrap.js";
import { registerLoginCommand } from "./commands/login.js";
import { registerInstallCommand } from "./commands/install.js";
import { registerUnconfigureCommand } from "./commands/unconfigure.js";
import { registerTestCommand } from "./commands/test.js";
import { registerQueryCommand } from "./commands/query.js";
import { registerVersionOption } from "./commands/version.js";

const require = createRequire(import.meta.url);
const packageJson = require("../../package.json") as { version: string };

function formatHelpText(): string {
  const dim = chalk.dim;
  const cyan = chalk.cyan;
  const yellow = chalk.yellow;
  const green = chalk.green;
  const bold = chalk.bold;

  const cmd = (name: string, args: string) =>
    `  ${cyan(name.padEnd(10))}${dim(args)}`;
  const example = (text: string) => `                                 ${dim(text)}`;
  const opt = (flag: string, desc: string) =>
    `  ${yellow(flag.padEnd(27))}${desc}`;

  return [
    bold("Configure coding agents to use the Poe API."),
    "",
    `${bold("Usage:")} ${green("poe-code")} ${dim("<command> [...options]")}`,
    "",
    bold("Commands:"),
    cmd("configure", "[service]") + "            Configure developer tooling for Poe API",
    example("poe-code configure claude-code"),
    "",
    cmd("unconfigure", "<service>") + "       Remove existing Poe API tooling configuration",
    example("poe-code unconfigure codex"),
    "",
    cmd("install", "[service]") + "            Install tooling for a configured service",
    example("poe-code install opencode"),
    "",
    cmd("spawn", "<service> [prompt]") + "   Run a single prompt through a configured service CLI",
    example("poe-code spawn codex \"Say hello\""),
    "",
    cmd("wrap", "<service>") + "            Run an agent CLI with Poe isolated configuration",
    example("poe-code wrap claude-code --help"),
    "",
    cmd("test", "[service]") + "            Run service health checks",
    example("poe-code test codex"),
    "",
    cmd("query", "[prompt]") + "             Query an LLM via Poe API directly",
    example("poe-code query \"What is 2+2?\""),
    "",
    cmd("login", "") + "                          Store a Poe API key for reuse across commands",
    "",
    bold("Options:"),
    opt("-y, --yes", "Accept defaults without prompting"),
    opt("--dry-run", "Simulate commands without writing changes"),
    opt("--verbose", "Show verbose logs"),
    opt("-V, --version", "Output the version number"),
    opt("-h, --help", "Display help for command"),
    "",
    opt("<command> --help", "Print help text for command"),
    "",
    `${dim("Learn more about Poe:")}            ${cyan("https://poe.com")}`,
    `${dim("GitHub:")}                          ${cyan("https://github.com/poe-platform/poe-code")}`
  ].join("\n");
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
          return formatHelpText();
        }
        const defaultHelper = new Help();
        return defaultHelper.formatHelp(cmd, helper);
      }
    });

  registerVersionOption(program, container, packageJson.version);
  registerInstallCommand(program, container);
  registerConfigureCommand(program, container);
  registerSpawnCommand(program, container);
  registerWrapCommand(program, container);
  registerQueryCommand(program, container);
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
