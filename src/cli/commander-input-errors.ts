import type { Command, CommanderError } from "commander";
import { ValidationError } from "./errors.js";

const MISSING_INPUT_CODES = new Set([
  "commander.missingArgument",
  "commander.missingMandatoryOptionValue"
]);

/**
 * Commander reports bad input in its own skin, and reports only the first
 * missing value it finds. This takes the reporting over: Commander's own error
 * output is silenced and every bad-input exit is re-raised as a
 * ValidationError, which the CLI renders once through the design system like
 * any other user error. Help and version exits (exit code 0) are not errors and
 * stay with the caller.
 */
export function interceptCommanderInputErrors(
  command: Command,
  handleNonErrorExit: (error: CommanderError) => never
): void {
  command.configureOutput({ outputError: () => {} });
  command.exitOverride((error) => {
    if (error.exitCode === 0) {
      handleNonErrorExit(error);
    }
    throw new ValidationError(
      MISSING_INPUT_CODES.has(error.code)
        ? formatMissingInputs(command, error)
        : withoutErrorPrefix(error.message)
    );
  });

  for (const child of command.commands) {
    interceptCommanderInputErrors(child, handleNonErrorExit);
  }
}

function formatMissingInputs(command: Command, error: CommanderError): string {
  const missing = describeMissingInputs(command);
  if (missing.length === 0) {
    return withoutErrorPrefix(error.message);
  }

  return [
    "Missing required input.",
    "",
    "Required:",
    ...missing.map((entry) => `- ${entry}`),
    "",
    `Usage: ${command.createHelp().commandUsage(command)}`
  ].join("\n");
}

function describeMissingInputs(command: Command): string[] {
  const suppliedArguments = command.args.length;
  const missing = command.registeredArguments
    .filter((argument, index) => argument.required && index >= suppliedArguments)
    .map((argument) =>
      describeInput(`<${argument.name()}>`, argument.description, argument.argChoices)
    );

  const values = command.opts();
  for (const option of command.options) {
    if (option.mandatory && values[option.attributeName()] === undefined) {
      missing.push(describeInput(option.flags, option.description, option.argChoices));
    }
  }

  return missing;
}

function describeInput(
  term: string,
  description: string,
  choices: readonly string[] | undefined
): string {
  const detail = description.length > 0 ? ` — ${description}` : "";
  const allowed = choices === undefined ? "" : ` (choices: ${choices.join(", ")})`;
  return `${term}${detail}${allowed}`;
}

function withoutErrorPrefix(message: string): string {
  const prefix = "error: ";
  return message.startsWith(prefix) ? message.slice(prefix.length) : message;
}
