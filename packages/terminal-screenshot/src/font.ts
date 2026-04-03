import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);

// Resolve the shipped woff2 asset from the installed package at import time.
// This runs once and keeps the per-render path free of extra I/O.
const fontPackageRoot = dirname(require.resolve("@fontsource/jetbrains-mono/package.json"));
const fontPath = join(fontPackageRoot, "files", "jetbrains-mono-latin-400-normal.woff2");

export const JETBRAINS_MONO_BASE64 = readFileSync(fontPath).toString("base64");

export const FONT_FACE_CSS = `@font-face {
  font-family: 'JetBrains Mono';
  font-style: normal;
  font-weight: 400;
  src: url('data:font/woff2;base64,${JETBRAINS_MONO_BASE64}') format('woff2');
}`;
