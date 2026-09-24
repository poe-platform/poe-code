import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { MermaidError } from "./contracts.js";
import {
  darkThemeTokens,
  lightThemeTokens,
  parseCssColor,
  resolveMermaidTheme
} from "./theme.js";

describe("theme tokens and resolution", () => {
  it("locks exact light and dark mode palette colors and 8px spatial grid tokens", () => {
    assert.equal(lightThemeTokens.canvas, "#f8fafc");
    assert.equal(lightThemeTokens.surface, "#ffffff");
    assert.equal(lightThemeTokens.surfaceAccent, "#eff6ff");
    assert.equal(lightThemeTokens.accentBorder, "#60a5fa");
    assert.equal(lightThemeTokens.groupSurface, "#f1f5f980");
    assert.equal(lightThemeTokens.groupHeaderSurface, "#e2e8f080");
    assert.equal(lightThemeTokens.groupBorder, "#cbd5e1");
    assert.equal(lightThemeTokens.border, "#cbd5e1");
    assert.equal(lightThemeTokens.borderStrong, "#64748b");
    assert.equal(lightThemeTokens.edge, "#64748b");
    assert.equal(lightThemeTokens.edgeLabelBackground, "#ffffff");
    assert.equal(lightThemeTokens.edgeLabelBorder, "#e2e8f0");
    assert.equal(lightThemeTokens.noteSurface, "#fefce8");
    assert.equal(lightThemeTokens.noteBorder, "#facc15");
    assert.equal(lightThemeTokens.noteText, "#713f12");
    assert.equal(lightThemeTokens.text, "#0f172a");
    assert.equal(lightThemeTokens.mutedText, "#475569");
    assert.equal(lightThemeTokens.accent, "#2563eb");
    assert.equal(lightThemeTokens.shadowColor, "rgba(15, 23, 42, 0.06)");

    assert.equal(darkThemeTokens.canvas, "#0b1120");
    assert.equal(darkThemeTokens.surface, "#1e293b");
    assert.equal(darkThemeTokens.surfaceAccent, "#172554");
    assert.equal(darkThemeTokens.accentBorder, "#3b82f6");
    assert.equal(darkThemeTokens.groupSurface, "#0f172a99");
    assert.equal(darkThemeTokens.groupHeaderSurface, "#1e293b");
    assert.equal(darkThemeTokens.groupBorder, "#334155");
    assert.equal(darkThemeTokens.border, "#334155");
    assert.equal(darkThemeTokens.borderStrong, "#64748b");
    assert.equal(darkThemeTokens.edge, "#94a3b8");
    assert.equal(darkThemeTokens.edgeLabelBackground, "#1e293b");
    assert.equal(darkThemeTokens.edgeLabelBorder, "#334155");
    assert.equal(darkThemeTokens.noteSurface, "#422006");
    assert.equal(darkThemeTokens.noteBorder, "#ca8a04");
    assert.equal(darkThemeTokens.noteText, "#fef08a");
    assert.equal(darkThemeTokens.text, "#f8fafc");
    assert.equal(darkThemeTokens.mutedText, "#94a3b8");
    assert.equal(darkThemeTokens.accent, "#60a5fa");
    assert.equal(darkThemeTokens.shadowColor, "rgba(0, 0, 0, 0.35)");

    assert.equal(lightThemeTokens.padding, 32);
    assert.equal(lightThemeTokens.fontSize, 13);
    assert.equal(lightThemeTokens.secondaryFontSize, 11.5);
    assert.equal(lightThemeTokens.lineHeight, 20);
    assert.equal(lightThemeTokens.cornerRadius, 8);
    assert.equal(lightThemeTokens.elbowRadius, 10);
    assert.equal(lightThemeTokens.rankGap, 56);
    assert.equal(lightThemeTokens.nodeGap, 32);
  });

  it("merges host settings and CLI theme mode in documented priority order", () => {
    const resolved = resolveMermaidTheme({
      theme: "dark",
      settings: {
        theme: {
          mode: "light",
          dark: { accent: "#38bdf8" }
        }
      },
      backgroundColor: "transparent"
    });
    assert.equal(resolved.mode, "dark");
    assert.equal(resolved.tokens.accent, "#38bdf8");
    assert.equal(resolved.backgroundColor, "transparent");
  });

  it("parses hex, rgba, and named transparent colors into RGBA bytes", () => {
    assert.deepEqual(parseCssColor("#f8fafc"), { r: 248, g: 250, b: 252, a: 255 });
    assert.deepEqual(parseCssColor("#f1f5f980"), { r: 241, g: 245, b: 249, a: 128 });
    assert.deepEqual(parseCssColor("transparent"), { r: 0, g: 0, b: 0, a: 0 });
    assert.deepEqual(parseCssColor("red"), { r: 255, g: 0, b: 0, a: 255 });
    assert.deepEqual(parseCssColor("rebeccapurple"), { r: 102, g: 51, b: 153, a: 255 });
    assert.throws(() => parseCssColor("constructor"), (error: unknown) => error instanceof MermaidError);
    assert.deepEqual(parseCssColor("rgba(15, 23, 42, 0.5)"), { r: 15, g: 23, b: 42, a: 128 });
    assert.throws(() => parseCssColor("not-a-color"), (err: unknown) => err instanceof MermaidError && err.code === "E_CONFIG");
  });
});
