import { color } from "../components/color.js";

export const brand = "#a200ff";

export const dark = {
  header: (text: string) => color.magentaBright.bold(text),
  divider: (text: string) => color.dim(text),
  prompt: (text: string) => color.cyan(text),
  number: (text: string) => color.cyanBright(text),
  intro: (text: string) => color.bgMagenta.white(` Poe - ${text} `),
  resolvedSymbol: color.magenta("◇"),
  errorSymbol: color.red("■"),
  accent: (text: string) => color.cyan(text),
  muted: (text: string) => color.dim(text),
  success: (text: string) => color.green(text),
  warning: (text: string) => color.yellow(text),
  error: (text: string) => color.red(text),
  info: (text: string) => color.magenta(text),
  badge: (text: string) => color.bgYellow.black(` ${text} `)
};

export const light = {
  header: (text: string) => color.hex("#a200ff").bold(text),
  divider: (text: string) => color.hex("#666666")(text),
  prompt: (text: string) => color.hex("#006699").bold(text),
  number: (text: string) => color.hex("#0077cc").bold(text),
  intro: (text: string) => color.bgHex("#a200ff").white(` Poe - ${text} `),
  resolvedSymbol: color.hex("#a200ff")("◇"),
  errorSymbol: color.hex("#cc0000")("■"),
  accent: (text: string) => color.hex("#006699").bold(text),
  muted: (text: string) => color.hex("#666666")(text),
  success: (text: string) => color.hex("#008800")(text),
  warning: (text: string) => color.hex("#cc6600")(text),
  error: (text: string) => color.hex("#cc0000")(text),
  info: (text: string) => color.hex("#a200ff")(text),
  badge: (text: string) => color.bgHex("#cc6600").white(` ${text} `)
};

export type ThemeName = "dark" | "light";
export type ThemePalette = typeof dark;
