import chalk from "chalk";

export const typography = {
  bold: (text: string) => chalk.bold(text),
  dim: (text: string) => chalk.dim(text),
  italic: (text: string) => chalk.italic(text),
  underline: (text: string) => chalk.underline(text),
  strikethrough: (text: string) => chalk.strikethrough(text)
} as const;
