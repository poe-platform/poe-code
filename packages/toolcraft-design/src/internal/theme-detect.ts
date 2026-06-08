import { getThemeConfig, getThemeRevision } from "./theme-state.js";
import { brands } from "../tokens/brand.js";
import { createPalette, dark, light, type ThemeName, type ThemePalette } from "../tokens/colors.js";

export interface ThemeEnv {
  POE_CODE_THEME?: string;
  POE_THEME?: string;
  APPLE_INTERFACE_STYLE?: string;
  VSCODE_COLOR_THEME_KIND?: string;
  COLORFGBG?: string;
}

function detectThemeFromEnv(env: ThemeEnv): ThemeName | undefined {
  const apple = env.APPLE_INTERFACE_STYLE;
  if (typeof apple === "string") {
    return apple.toLowerCase() === "dark" ? "dark" : "light";
  }

  const vscodeKind = env.VSCODE_COLOR_THEME_KIND;
  if (typeof vscodeKind === "string") {
    const normalized = vscodeKind.toLowerCase();
    if (normalized.includes("light")) {
      return "light";
    }
    if (normalized.includes("dark")) {
      return "dark";
    }
  }

  const colorFGBG = env.COLORFGBG;
  if (typeof colorFGBG === "string") {
    const parts = colorFGBG.split(";").map((part) => Number.parseInt(part, 10));
    const background = parts.at(-1);
    if (Number.isFinite(background)) {
      return background! >= 8 ? "light" : "dark";
    }
  }

  return undefined;
}

export function resolveThemeName(env: ThemeEnv = process.env as ThemeEnv): ThemeName {
  const raw = (env.POE_CODE_THEME ?? env.POE_THEME)?.toLowerCase();
  if (raw === "light" || raw === "dark") {
    return raw;
  }
  const detected = detectThemeFromEnv(env);
  if (detected) {
    return detected;
  }
  return "dark";
}

const themeCache = new Map<string, ThemePalette>();
let cachedRevision = -1;

export function getTheme(env?: ThemeEnv): ThemePalette {
  const themeName = resolveThemeName(env);
  const config = getThemeConfig();
  const revision = getThemeRevision();
  if (revision !== cachedRevision) {
    themeCache.clear();
    cachedRevision = revision;
  }
  const cacheKey = `${config.brand}:${themeName}`;
  const cachedTheme = themeCache.get(cacheKey);
  if (cachedTheme) {
    return cachedTheme;
  }
  const activeBrand = brands[config.brand]!;
  const theme =
    config.brand === "purple"
      ? themeName === "light"
        ? light
        : dark
      : createPalette(activeBrand, themeName);
  themeCache.set(cacheKey, theme);
  return theme;
}

export function resetThemeCache(): void {
  themeCache.clear();
  cachedRevision = getThemeRevision();
}
