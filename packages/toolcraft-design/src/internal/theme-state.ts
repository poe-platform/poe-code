import { brands } from "../tokens/brand.js";

export interface ThemeConfig {
  brand: string;
  label: string;
}

const defaults: ThemeConfig = {
  brand: "purple",
  label: "Poe"
};

let config: ThemeConfig = { ...defaults };
let revision = 0;

export function configureTheme(patch: { brand?: string; label?: string }): void {
  if (patch.brand !== undefined && !Object.hasOwn(brands, patch.brand)) {
    throw new Error(`Unknown brand: ${patch.brand}`);
  }

  config = {
    brand: patch.brand ?? config.brand,
    label: patch.label ?? config.label
  };
  revision += 1;
}

export function getThemeConfig(): ThemeConfig {
  return { ...config };
}

export function getThemeRevision(): number {
  return revision;
}

export function resetTheme(): void {
  config = { ...defaults };
  revision += 1;
}
