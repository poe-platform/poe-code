import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { FONT_FACE_CSS, JETBRAINS_MONO_BASE64 } from "./font.js";

const require = createRequire(import.meta.url);
const fontPackageRoot = dirname(require.resolve("@fontsource/jetbrains-mono/package.json"));
const shippedFontPath = join(
  fontPackageRoot,
  "files",
  "jetbrains-mono-latin-400-normal.woff2"
);

describe("font", () => {
  it("embeds the shipped JetBrains Mono latin 400 woff2 asset", () => {
    expect(Buffer.from(JETBRAINS_MONO_BASE64, "base64")).toEqual(readFileSync(shippedFontPath));
    expect(FONT_FACE_CSS).toContain("font-family: 'JetBrains Mono'");
    expect(FONT_FACE_CSS).toContain("font-style: normal");
    expect(FONT_FACE_CSS).toContain("font-weight: 400");
    expect(FONT_FACE_CSS).toContain(`data:font/woff2;base64,${JETBRAINS_MONO_BASE64}`);
    expect(FONT_FACE_CSS).toContain("format('woff2')");
  });
});
