import { createRequire } from "node:module";
import { createColor, color } from "./color.js";
import { getThemeConfig, getThemeRevision, isThemeBrandConfigured } from "./theme-state.js";
const native = createRequire(import.meta.url)("./toolcraft-design-rust.node");
export const brands = {
  purple: { name: "purple", primary: "#a200ff" },
  blue: { name: "blue", primary: "#2f6fed" },
  green: { name: "green", primary: "#1f9d57" }
};
export const brand = brands.purple.primary;
export function createPalette(activeBrand, mode) {
  const light = mode === "light",
    plan = native.designPalette(activeBrand.name, activeBrand.primary, light),
    palette = {};
  for (const key of Object.keys(plan.opens)) {
    const style = createColor(plan.opens[key]);
    if (key === "resolvedSymbol" || key === "errorSymbol")
      Object.defineProperty(palette, key, {
        enumerable: true,
        configurable: true,
        get: () => style(key === "resolvedSymbol" ? "◇" : "■")
      });
    else if (key === "intro")
      palette[key] = (value) =>
        light
          ? color.bgHex(activeBrand.primary).white(` ${getThemeConfig().label} - ${value} `)
          : style(` ${getThemeConfig().label} - ${value} `);
    else if (key === "badge") palette[key] = (value) => style(` ${value} `);
    else palette[key] = style;
  }
  return Object.defineProperty(palette, "styles", { value: plan.styles, enumerable: false });
}
export const dark = createPalette(brands.purple, "dark"),
  light = createPalette(brands.purple, "light");
export function resolveThemeName(env = process.env) {
  const explicit = (env.POE_CODE_THEME ?? env.POE_THEME)?.toLowerCase();
  let selected =
    typeof explicit === "string" ? native.designThemeHint("explicit", explicit) : undefined;
  if (selected) return selected;
  const apple = env.APPLE_INTERFACE_STYLE;
  if (typeof apple === "string") return native.designThemeHint("apple", apple);
  const vscode = env.VSCODE_COLOR_THEME_KIND;
  if (typeof vscode === "string") {
    selected = native.designThemeHint("vscode", vscode);
    if (selected) return selected;
  }
  const background = env.COLORFGBG;
  if (typeof background === "string") {
    selected = native.designThemeHint("background", background);
    if (selected) return selected;
  }
  return "dark";
}
const cache = new Map();
let cachedRevision = -1;
export function getTheme(env) {
  const mode = resolveThemeName(env),
    config = getThemeConfig(),
    requested = env?.POE_BRAND?.toLowerCase(),
    name =
      !isThemeBrandConfigured() && requested && Object.hasOwn(brands, requested)
        ? requested
        : config.brand,
    revision = getThemeRevision();
  if (revision !== cachedRevision) {
    cache.clear();
    cachedRevision = revision;
  }
  const key = `${name}:${mode}`;
  if (!cache.has(key))
    cache.set(
      key,
      name === "purple" ? (mode === "light" ? light : dark) : createPalette(brands[name], mode)
    );
  return cache.get(key);
}
export function resetThemeCache() {
  cache.clear();
  cachedRevision = getThemeRevision();
}
