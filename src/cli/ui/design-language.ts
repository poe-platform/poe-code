import chalk from "chalk";
import type { CliEnvironment } from "../environment.js";
import { createMenuTheme } from "./theme.js";

export interface CliTextStyles {
  intro(text: string): string;
  heading(text: string): string;
  section(text: string): string;
  command(text: string): string;
  argument(text: string): string;
  option(text: string): string;
  example(text: string): string;
  usageCommand(text: string): string;
  link(text: string): string;
  muted(text: string): string;
}

export interface CliCopy {
  tagline: string;
  menuHeader: string;
  serviceSelection(action: string): string;
}

export interface CliDesignLanguage {
  text: CliTextStyles;
  symbols: {
    info: string;
    success: string;
    resolved: string;
    errorResolved: string;
  };
  copy: CliCopy;
}

export function createCliCopy(): CliCopy {
  const tagline = "Configure coding agents to use the Poe API.";
  return {
    tagline,
    menuHeader: `poe-code · ${tagline}`,
    serviceSelection: (action) => `Pick an agent to ${action}:`
  };
}

export function createCliDesignLanguage(
  env: CliEnvironment
): CliDesignLanguage {
  const theme = createMenuTheme(env);
  const accent = theme.palette.prompt;
  const muted = chalk.dim;
  const copy = createCliCopy();

  return {
    text: {
      intro: theme.palette.intro,
      heading: theme.palette.header,
      section: chalk.bold,
      command: accent,
      argument: muted,
      option: chalk.yellow,
      example: muted,
      usageCommand: chalk.green,
      link: accent,
      muted
    },
    symbols: {
      info: chalk.magenta("●"),
      success: chalk.magenta("◆"),
      resolved: theme.palette.resolvedSymbol,
      errorResolved: theme.palette.errorSymbol
    },
    copy
  };
}
