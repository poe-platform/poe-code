import { color, type Color } from "../components/color.js";
import { getThemeConfig } from "../internal/theme-state.js";
import { brands, type Brand } from "./brand.js";

export const brand = brands.purple!.primary;

export type ThemeName = "dark" | "light";

export interface ThemePalette {
  header: (text: string) => string;
  divider: (text: string) => string;
  prompt: (text: string) => string;
  number: (text: string) => string;
  intro: (text: string) => string;
  resolvedSymbol: string;
  errorSymbol: string;
  accent: (text: string) => string;
  muted: (text: string) => string;
  success: (text: string) => string;
  warning: (text: string) => string;
  error: (text: string) => string;
  info: (text: string) => string;
  badge: (text: string) => string;
}

function brandColor(activeBrand: Brand, purple: Color): Color {
  return activeBrand.name === "purple" ? purple : color.hex(activeBrand.primary);
}

function brandBackground(activeBrand: Brand, purple: Color): Color {
  return activeBrand.name === "purple" ? purple : color.bgHex(activeBrand.primary);
}

export function createPalette(activeBrand: Brand, mode: ThemeName): ThemePalette {
  if (mode === "light") {
    const active = color.hex(activeBrand.primary);
    const prompt = activeBrand.name === "purple" ? color.hex("#006699") : active;
    const number = activeBrand.name === "purple" ? color.hex("#0077cc") : active;
    return {
      header: (text: string) => active.bold(text),
      divider: (text: string) => color.hex("#666666")(text),
      prompt: (text: string) => prompt.bold(text),
      number: (text: string) => number.bold(text),
      intro: (text: string) =>
        color.bgHex(activeBrand.primary).white(` ${getThemeConfig().label} - ${text} `),
      get resolvedSymbol() {
        return active("◇");
      },
      get errorSymbol() {
        return color.hex("#cc0000")("■");
      },
      accent: (text: string) => prompt.bold(text),
      muted: (text: string) => color.hex("#666666")(text),
      success: (text: string) => color.hex("#008800")(text),
      warning: (text: string) => color.hex("#cc6600")(text),
      error: (text: string) => color.hex("#cc0000")(text),
      info: (text: string) => active(text),
      badge: (text: string) => color.bgHex("#cc6600").white(` ${text} `)
    };
  }

  const active = brandColor(activeBrand, color.magenta);
  const activeBright = brandColor(activeBrand, color.magentaBright);
  const activeBackground = brandBackground(activeBrand, color.bgMagenta);
  const prompt = activeBrand.name === "purple" ? color.cyan : active;
  const number = activeBrand.name === "purple" ? color.cyanBright : active;
  return {
    header: (text: string) => activeBright.bold(text),
    divider: (text: string) => color.dim(text),
    prompt: (text: string) => prompt(text),
    number: (text: string) => number(text),
    intro: (text: string) => activeBackground.white(` ${getThemeConfig().label} - ${text} `),
    get resolvedSymbol() {
      return active("◇");
    },
    get errorSymbol() {
      return color.red("■");
    },
    accent: (text: string) => prompt(text),
    muted: (text: string) => color.dim(text),
    success: (text: string) => color.green(text),
    warning: (text: string) => color.yellow(text),
    error: (text: string) => color.red(text),
    info: (text: string) => active(text),
    badge: (text: string) => color.bgYellow.black(` ${text} `)
  };
}

export const dark = createPalette(brands.purple!, "dark");
export const light = createPalette(brands.purple!, "light");
