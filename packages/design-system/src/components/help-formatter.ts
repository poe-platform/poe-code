import { text } from "./text.js";
import { widths } from "../tokens/widths.js";

export interface CommandInfo {
  name: string;
  description: string;
}

export interface OptionInfo {
  flags: string;
  description: string;
}

export function formatCommand(name: string, description: string): string {
  const paddedName = name.padEnd(widths.helpColumn);
  return `  ${text.command(paddedName)}  ${description}`;
}

export function formatUsage(command: string, args?: string): string {
  const argsStr = args ? ` ${text.argument(args)}` : "";
  return `${text.usageCommand(command)}${argsStr}`;
}

export function formatOption(flags: string, description: string): string {
  const paddedFlags = flags.padEnd(widths.helpColumn);
  return `  ${text.option(paddedFlags)}  ${description}`;
}

export function formatCommandList(commands: CommandInfo[]): string {
  return commands.map((cmd) => formatCommand(cmd.name, cmd.description)).join("\n");
}

export function formatOptionList(options: OptionInfo[]): string {
  return options.map((opt) => formatOption(opt.flags, opt.description)).join("\n");
}

export const helpFormatter = {
  formatCommand,
  formatUsage,
  formatOption,
  formatCommandList,
  formatOptionList
} as const;
