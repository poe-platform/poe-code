import chalk from "chalk";
import type { CliEnvironment } from "../environment.js";

export type MenuThemeName = "dark" | "light";

export interface MenuPalette {
  header(text: string): string;
  divider(text: string): string;
  prompt(text: string): string;
  number(value: number): string;
  providerFallback(label: string): string;
  intro(text: string): string;
  resolvedSymbol: string;
}

export interface MenuTheme {
  name: MenuThemeName;
  palette: MenuPalette;
}

interface ThemeConfig {
  header: (text: string) => string;
  divider: (text: string) => string;
  prompt: (text: string) => string;
  number: (text: string) => string;
  providerFallback: (text: string) => string;
  intro: (text: string) => string;
  resolvedSymbol: string;
}

const DARK_THEME: ThemeConfig = {
  header: (text) => chalk.magentaBright.bold(text),
  divider: chalk.dim,
  prompt: (text) => chalk.cyan(text),
  number: (text) => chalk.cyanBright(text),
  providerFallback: (text) => text,
  intro: (text) => chalk.bgMagenta.white(` Poe - ${text} `),
  resolvedSymbol: chalk.magenta("◇")
};

const LIGHT_THEME: ThemeConfig = {
  header: (text) => chalk.hex("#a200ff").bold(text),
  divider: chalk.hex("#666666"),
  prompt: (text) => chalk.hex("#006699").bold(text),
  number: (text) => chalk.hex("#0077cc").bold(text),
  providerFallback: (text) => text,
  intro: (text) => chalk.bgHex("#a200ff").white(` Poe - ${text} `),
  resolvedSymbol: chalk.hex("#a200ff")("◇")
};

const THEMES: Record<MenuThemeName, ThemeConfig> = {
  dark: DARK_THEME,
  light: LIGHT_THEME
};

const DEFAULT_THEME: MenuThemeName = "dark";

function detectThemeFromEnv(env: CliEnvironment): MenuThemeName | undefined {
  const apple = env.getVariable("APPLE_INTERFACE_STYLE");
  if (typeof apple === "string") {
    return apple.toLowerCase() === "dark" ? "dark" : "light";
  }

  const vscodeKind = env.getVariable("VSCODE_COLOR_THEME_KIND");
  if (typeof vscodeKind === "string") {
    const normalized = vscodeKind.toLowerCase();
    if (normalized.includes("light")) {
      return "light";
    }
    if (normalized.includes("dark")) {
      return "dark";
    }
  }

  const colorFGBG = env.getVariable("COLORFGBG");
  if (typeof colorFGBG === "string") {
    const parts = colorFGBG.split(";").map((part) => Number.parseInt(part, 10));
    const background = parts.at(-1);
    if (Number.isFinite(background)) {
      return background! >= 8 ? "light" : "dark";
    }
  }

  return undefined;
}

export function resolveMenuThemeName(env: CliEnvironment): MenuThemeName {
  const raw = env.getVariable("POE_CODE_THEME")?.toLowerCase();
  if (raw === "light" || raw === "dark") {
    return raw;
  }
  const detected = detectThemeFromEnv(env);
  if (detected) {
    return detected;
  }
  return DEFAULT_THEME;
}

function buildPalette(config: ThemeConfig): MenuPalette {
  return {
    header: config.header,
    divider: config.divider,
    prompt: config.prompt,
    number: (value) => config.number(`[${value}]`),
    providerFallback: config.providerFallback,
    intro: config.intro,
    resolvedSymbol: config.resolvedSymbol
  };
}

function createTheme(themeName: MenuThemeName): MenuTheme {
  const config = THEMES[themeName];
  return {
    name: themeName,
    palette: buildPalette(config)
  };
}

export function createMenuTheme(env: CliEnvironment): MenuTheme {
  const themeName = resolveMenuThemeName(env);
  return createTheme(themeName);
}

export const defaultMenuTheme: MenuTheme = createTheme(DEFAULT_THEME);
