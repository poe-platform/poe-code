import { formatCommandNotFoundPanel, log, outro, symbols } from "toolcraft-design";
import { detectExecutionContext, formatCliHelpCommand } from "../utils/execution-context.js";
import type { CliContainer } from "./container.js";
import { SilentError } from "./errors.js";

export function throwCommandNotFound(input: {
  container: CliContainer;
  scope: "cli" | "mcp" | "skill";
  unknownCommand: string;
  helpArgs: string[];
  moduleUrl: string;
}): never {
  const { container, scope, unknownCommand, helpArgs, moduleUrl } = input;

  const context = detectExecutionContext({
    argv: process.argv,
    env: container.env.variables,
    moduleUrl
  });
  const helpCommand = formatCliHelpCommand(context, helpArgs);
  const panel = formatCommandNotFoundPanel({
    title: scope === "cli" ? "command not found" : `${scope} command not found`,
    unknownCommand,
    helpCommand
  });

  const logger = container.loggerFactory.create({
    dryRun: false,
    verbose: false,
    scope
  });

  const shouldRenderIntroOutro = container.dependencies.logger == null;
  if (shouldRenderIntroOutro) {
    logger.intro(panel.title);
    log.message(panel.label, { symbol: symbols.errorResolved });
    outro(panel.footer);
  } else {
    logger.error(`${panel.label}\n${panel.footer}`);
  }

  process.exitCode = 1;
  throw new SilentError();
}
