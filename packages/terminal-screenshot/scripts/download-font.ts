/**
 * Downloads the full JetBrains Mono Regular TTF (including box-drawing and
 * geometric shape characters) and writes it to the assets directory.
 *
 * The @fontsource/jetbrains-mono TTF is Latin-only and lacks the characters
 * used by the design system (●, ◆, │, ─, etc.). This downloads the upstream
 * font directly from the JetBrains GitHub release.
 *
 * Usage: npx tsx scripts/download-font.ts
 */
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const FONT_URL =
  "https://raw.githubusercontent.com/JetBrains/JetBrainsMono/v2.304/fonts/ttf/JetBrainsMono-Regular.ttf";

const outPath = join(
  dirname(fileURLToPath(import.meta.url)),
  "../assets/jetbrains-mono-400-normal.ttf"
);

const response = await fetch(FONT_URL);
if (!response.ok) {
  throw new Error(`Failed to fetch font: ${response.status} ${response.statusText}`);
}

const buffer = await response.arrayBuffer();
writeFileSync(outPath, Buffer.from(buffer));
console.log(`Saved ${buffer.byteLength} bytes to ${outPath}`);
