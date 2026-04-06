import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  FONT_FACE_CSS,
  JETBRAINS_MONO_BASE64,
  JETBRAINS_MONO_FONT_FILES,
  JETBRAINS_MONO_TTF_PATH
} from "./font.js";

const require = createRequire(import.meta.url);
const fontPackageRoot = dirname(require.resolve("jetbrains-mono/package.json"));
const shippedFontPath = join(fontPackageRoot, "fonts/webfonts/JetBrainsMono-Regular.woff2");
const shippedBoldFontPath = join(fontPackageRoot, "fonts/webfonts/JetBrainsMono-Bold.woff2");
const shippedItalicFontPath = join(fontPackageRoot, "fonts/webfonts/JetBrainsMono-Italic.woff2");
const shippedBoldItalicFontPath = join(fontPackageRoot, "fonts/webfonts/JetBrainsMono-BoldItalic.woff2");

describe("font", () => {
  it("embeds the full JetBrains Mono font family for svg rendering", () => {
    expect(Buffer.from(JETBRAINS_MONO_BASE64, "base64")).toEqual(readFileSync(shippedFontPath));
    expect(FONT_FACE_CSS).toContain("font-family: 'JetBrains Mono'");
    expect(FONT_FACE_CSS).toContain(`data:font/woff2;base64,${JETBRAINS_MONO_BASE64}`);
    expect(FONT_FACE_CSS).toContain("format('woff2')");
    expect(FONT_FACE_CSS).toContain(readFileSync(shippedBoldFontPath).toString("base64"));
    expect(FONT_FACE_CSS).toContain(readFileSync(shippedItalicFontPath).toString("base64"));
    expect(FONT_FACE_CSS).toContain(readFileSync(shippedBoldItalicFontPath).toString("base64"));
    expect(FONT_FACE_CSS).toContain("font-style: normal;\n  font-weight: 400;");
    expect(FONT_FACE_CSS).toContain("font-style: normal;\n  font-weight: 700;");
    expect(FONT_FACE_CSS).toContain("font-style: italic;\n  font-weight: 400;");
    expect(FONT_FACE_CSS).toContain("font-style: italic;\n  font-weight: 700;");
  });

  it("ships all JetBrains Mono faces for resvg font loading", () => {
    expect(JETBRAINS_MONO_FONT_FILES).toHaveLength(4);
    expect(JETBRAINS_MONO_TTF_PATH).toMatch(/jetbrains-mono-400-normal\.ttf$/);
    expect(readFileSync(JETBRAINS_MONO_TTF_PATH).byteLength).toBeGreaterThan(0);
    expect(JETBRAINS_MONO_FONT_FILES[1]).toMatch(/jetbrains-mono-700-normal\.ttf$/);
    expect(JETBRAINS_MONO_FONT_FILES[2]).toMatch(/jetbrains-mono-400-italic\.ttf$/);
    expect(JETBRAINS_MONO_FONT_FILES[3]).toMatch(/jetbrains-mono-700-italic\.ttf$/);
    expect(JETBRAINS_MONO_FONT_FILES.every((fontPath) => readFileSync(fontPath).byteLength > 0)).toBe(
      true
    );
  });
});
