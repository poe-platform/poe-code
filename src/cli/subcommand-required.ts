import type { Command } from "commander";
import { log, outro, symbols, text, typography } from "toolcraft-design";
import { detectExecutionContext, formatCliHelpCommand } from "../utils/execution-context.js";
import type { CliContainer } from "./container.js";
import { SilentError } from "./errors.js";

/**
 * Bare group invocations that have no read-only overview subcommand to default to
 * land here: render the subcommand menu plus the most common next step and exit
 * non-zero, instead of dumping a wall of help.
 */
export function throwSubcommandRequired(input: {
  container: CliContainer;
  command: Command;
  scope: string;
  mostCommon: string;
  moduleUrl: string;
}): never {
  const { container, command, scope, mostCommon, moduleUrl } = input;

  const context = detectExecutionContext({
    argv: process.argv,
    env: container.env.variables,
    moduleUrl
  });
  const subcommands = command
    .createHelp()
    .visibleCommands(command)
    .map((subcommand) => subcommand.name());
  const helpCommand = formatCliHelpCommand(context, [scope, "--help"]);

  const label = `${typography.bold("Pick a subcommand:")} ${subcommands
    .map((subcommand) => text.command(subcommand))
    .join(text.muted(", "))}`;
  const footer = `${text.muted("Most common:")} ${text.usageCommand(
    formatCliHelpCommand(context, [scope, mostCommon])
  )}${text.muted(` — run ${helpCommand} for all options.`)}`;

  const logger = container.loggerFactory.create({ dryRun: false, verbose: false, scope });

  if (container.dependencies.logger == null) {
    logger.intro(`${scope}: pick a subcommand`);
    log.message(label, { symbol: symbols.errorResolved });
    outro(footer);
  } else {
    logger.error(`${label}\n${footer}`);
  }

  process.exitCode = 1;
  throw new SilentError();
}
