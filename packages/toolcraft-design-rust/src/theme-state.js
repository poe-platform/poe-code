import { createRequire } from "node:module";
const native = createRequire(import.meta.url)("./toolcraft-design-rust.node");
let config = { brand: "purple", label: "Poe" },
  revision = 0,
  brandConfigured = false;
export function configureTheme(patch) {
  if (patch.brand !== undefined && !native.designBrandKnown(patch.brand))
    throw Error(`Unknown brand: ${patch.brand}`);
  config = { brand: patch.brand ?? config.brand, label: patch.label ?? config.label };
  if (patch.brand !== undefined) brandConfigured = true;
  revision++;
}
export function getThemeConfig() {
  return { ...config };
}
export function getThemeRevision() {
  return revision;
}
export function isThemeBrandConfigured() {
  return brandConfigured;
}
export function resetTheme() {
  config = { brand: "purple", label: "Poe" };
  brandConfigured = false;
  revision++;
}
