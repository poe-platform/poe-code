import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);

// Full JetBrains Mono (all Unicode blocks including box-drawing and geometric shapes).
// The @fontsource subsets only cover Latin and miss characters used by the design system.
const fontPackageRoot = dirname(require.resolve("jetbrains-mono/package.json"));
const webfontRoot = join(fontPackageRoot, "fonts/webfonts");

function readWebfontBase64(filename: string): string {
  return readFileSync(join(webfontRoot, filename)).toString("base64");
}

function resolveAssetPath(filename: string): string {
  return fileURLToPath(new URL(`../assets/${filename}`, import.meta.url));
}

function createFontFace(base64: string, weight: 400 | 700, style: "normal" | "italic"): string {
  return `@font-face {
  font-family: 'JetBrains Mono';
  font-style: ${style};
  font-weight: ${weight};
  src: url('data:font/woff2;base64,${base64}') format('woff2');
}`;
}

export const JETBRAINS_MONO_BASE64 = readWebfontBase64("JetBrainsMono-Regular.woff2");
export const JETBRAINS_MONO_FONT_FILES = Object.freeze([
  resolveAssetPath("jetbrains-mono-400-normal.ttf"),
  resolveAssetPath("jetbrains-mono-700-normal.ttf"),
  resolveAssetPath("jetbrains-mono-400-italic.ttf"),
  resolveAssetPath("jetbrains-mono-700-italic.ttf")
] as const);
export const JETBRAINS_MONO_TTF_PATH = JETBRAINS_MONO_FONT_FILES[0];

export const FONT_FACE_CSS = [
  createFontFace(JETBRAINS_MONO_BASE64, 400, "normal"),
  createFontFace(readWebfontBase64("JetBrainsMono-Bold.woff2"), 700, "normal"),
  createFontFace(readWebfontBase64("JetBrainsMono-Italic.woff2"), 400, "italic"),
  createFontFace(readWebfontBase64("JetBrainsMono-BoldItalic.woff2"), 700, "italic")
].join("\n");
