import { admitMermaidLimits, type MmdcSettings } from "./contracts.js";
import { resolveMermaidTheme } from "./theme.js";

export function snapshotSettings(settings?: MmdcSettings): MmdcSettings {
  if (!settings) return Object.freeze({});
  const limits = settings.limits ? admitMermaidLimits(settings.limits) : undefined;
  const light = settings.theme?.light ? Object.freeze({ ...settings.theme.light }) : undefined;
  const dark = settings.theme?.dark ? Object.freeze({ ...settings.theme.dark }) : undefined;
  const theme = settings.theme
    ? Object.freeze({
        mode: settings.theme.mode,
        light,
        dark
      })
    : undefined;
  // Validate theme snapshot upfront
  if (theme) {
    resolveMermaidTheme({ settings: { theme } });
  }
  return Object.freeze({
    theme,
    limits,
    replace: settings.replace
  });
}

