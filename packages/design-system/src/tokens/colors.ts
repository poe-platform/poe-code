import chalk from "chalk";

export const brand = "#a200ff";

export const dark = {
  header: (text: string) => chalk.magentaBright.bold(text),
  divider: (text: string) => chalk.dim(text),
  prompt: (text: string) => chalk.cyan(text),
  number: (text: string) => chalk.cyanBright(text),
  intro: (text: string) => chalk.bgMagenta.white(` Poe - ${text} `),
  resolvedSymbol: chalk.magenta("◇"),
  errorSymbol: chalk.red("■"),
  accent: (text: string) => chalk.cyan(text),
  muted: (text: string) => chalk.dim(text),
  success: (text: string) => chalk.green(text),
  warning: (text: string) => chalk.yellow(text),
  error: (text: string) => chalk.red(text),
  info: (text: string) => chalk.magenta(text)
};

export const light = {
  header: (text: string) => chalk.hex("#a200ff").bold(text),
  divider: (text: string) => chalk.hex("#666666")(text),
  prompt: (text: string) => chalk.hex("#006699").bold(text),
  number: (text: string) => chalk.hex("#0077cc").bold(text),
  intro: (text: string) => chalk.bgHex("#a200ff").white(` Poe - ${text} `),
  resolvedSymbol: chalk.hex("#a200ff")("◇"),
  errorSymbol: chalk.hex("#cc0000")("■"),
  accent: (text: string) => chalk.hex("#006699").bold(text),
  muted: (text: string) => chalk.hex("#666666")(text),
  success: (text: string) => chalk.hex("#008800")(text),
  warning: (text: string) => chalk.hex("#cc6600")(text),
  error: (text: string) => chalk.hex("#cc0000")(text),
  info: (text: string) => chalk.hex("#a200ff")(text)
};

export type ThemeName = "dark" | "light";
export type ThemePalette = typeof dark;
