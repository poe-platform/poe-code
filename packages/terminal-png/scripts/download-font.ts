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
import * as fsPromises from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { assertSafeOutputDirectory } from "../../../scripts/guard-package-dist.mjs";

const FONT_URL =
  "https://raw.githubusercontent.com/JetBrains/JetBrainsMono/v2.304/fonts/ttf/JetBrainsMono-Regular.ttf";

const defaultOutPath = join(
  dirname(fileURLToPath(import.meta.url)),
  "../assets/jetbrains-mono-400-normal.ttf"
);
const defaultPackageDir = join(dirname(fileURLToPath(import.meta.url)), "..");

export async function downloadFont(options: {
  fetch?: typeof fetch;
  fs?: typeof fsPromises;
  outPath?: string;
  packageDir?: string;
} = {}): Promise<void> {
  const fetchFn = options.fetch ?? fetch;
  const fileSystem = options.fs ?? fsPromises;
  const outPath = options.outPath ?? defaultOutPath;
  const packageDir = options.packageDir ?? defaultPackageDir;
  const response = await fetchFn(FONT_URL);
  if (!response.ok) {
    throw new Error(`Failed to fetch font: ${response.status} ${response.statusText}`);
  }

  const buffer = await response.arrayBuffer();
  await assertSafeOutputDirectory(packageDir, outPath, fileSystem);
  if (options.fs === undefined) {
    writeFileSync(outPath, Buffer.from(buffer));
  } else {
    await options.fs.writeFile(outPath, Buffer.from(buffer));
  }
  console.log(`Saved ${buffer.byteLength} bytes to ${outPath}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await downloadFont();
}
