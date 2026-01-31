import chalk from "chalk";
import { getTheme } from "../internal/theme-detect.js";
import { typography } from "../tokens/typography.js";

export const text = {
  intro(content: string): string {
    const theme = getTheme();
    return theme.intro(content);
  },
  heading(content: string): string {
    const theme = getTheme();
    return theme.header(content);
  },
  section(content: string): string {
    return typography.bold(content);
  },
  command(content: string): string {
    const theme = getTheme();
    return theme.accent(content);
  },
  argument(content: string): string {
    const theme = getTheme();
    return theme.muted(content);
  },
  option(content: string): string {
    return chalk.yellow(content);
  },
  example(content: string): string {
    const theme = getTheme();
    return theme.muted(content);
  },
  usageCommand(content: string): string {
    return chalk.green(content);
  },
  link(content: string): string {
    const theme = getTheme();
    return theme.accent(content);
  },
  muted(content: string): string {
    const theme = getTheme();
    return theme.muted(content);
  }
} as const;
