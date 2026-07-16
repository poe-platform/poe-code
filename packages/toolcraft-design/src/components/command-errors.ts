import { typography } from "../tokens/typography.js";
import { text } from "./text.js";

export function formatCommandNotFound(input: {
  unknownCommand: string;
  helpCommand: string;
  suggestions?: readonly string[];
}): { label: string; hint: string } {
  const unknownInput = input.unknownCommand.replaceAll("\r\n", " ").replaceAll("\n", " ").replaceAll("\r", " ");
  const unknown = unknownInput.length > 0
    ? unknownInput
    : "<command>";

  const suggestions = input.suggestions ?? [];
  const didYouMean = suggestions.length > 0
    ? `
${text.muted("Did you mean:")} ${suggestions.map((suggestion) => text.command(suggestion)).join(text.muted(", "))}${text.muted("?")}`
    : "";

  return {
    label: `${typography.bold("Unknown command:")} ${text.command(unknown)}${didYouMean}`,
    hint: `${text.muted("Run")} ${text.usageCommand(input.helpCommand)} ${text.muted("for available commands.")}`
  };
}

export function formatCommandNotFoundPanel(input: {
  unknownCommand: string;
  helpCommand: string;
  suggestions?: readonly string[];
  title?: string;
}): { title: string; label: string; footer: string } {
  const message = formatCommandNotFound({
    unknownCommand: input.unknownCommand,
    helpCommand: input.helpCommand,
    suggestions: input.suggestions
  });

  return {
    title: input.title ?? "command not found",
    label: message.label,
    footer: message.hint
  };
}
