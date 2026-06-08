import { afterEach, describe, expect, it } from "vitest";
import { configureTheme, resetTheme } from "../internal/theme-state.js";
import { getExplorerStyles, getExplorerTheme } from "./theme.js";

describe("explorer theme", () => {
  const previousPoeCodeTheme = process.env.POE_CODE_THEME;

  afterEach(() => {
    resetTheme();
    if (previousPoeCodeTheme === undefined) {
      delete process.env.POE_CODE_THEME;
    } else {
      process.env.POE_CODE_THEME = previousPoeCodeTheme;
    }
  });

  it("changes only brand-colored cells for a non-purple brand", () => {
    process.env.POE_CODE_THEME = "dark";
    const purple = getExplorerStyles();
    const purpleTheme = getExplorerTheme();

    configureTheme({ brand: "blue" });
    const blue = getExplorerStyles();
    const blueTheme = getExplorerTheme();

    expect(blue.accent).toEqual({ fg: "#2f6fed", bold: true });
    expect(blue.borderFocused).toEqual({ fg: "#2f6fed", bold: true });
    expect(blue.matchHighlight).toEqual({ fg: "#2f6fed", bold: true, underline: true });
    expect(blue.tones.info).toEqual({ fg: "#2f6fed" });
    expect(blue.muted).toEqual(purple.muted);
    expect(blue.border).toEqual(purple.border);
    expect(blue.tones.success).toEqual(purple.tones.success);
    expect(blue.tones.warning).toEqual(purple.tones.warning);
    expect(blue.tones.error).toEqual(purple.tones.error);
    expect(blue.tones.muted).toEqual(purple.tones.muted);
    expect(blueTheme.badge("info", "info")).toBe("\u001b[38;2;47;111;237m info \u001b[0m");
    expect(blueTheme.badge("success", "success")).toBe(purpleTheme.badge("success", "success"));
    expect(blueTheme.badge("warning", "warning")).toBe(purpleTheme.badge("warning", "warning"));
    expect(blueTheme.badge("error", "error")).toBe(purpleTheme.badge("error", "error"));
    expect(blueTheme.badge("muted", "muted")).toBe(purpleTheme.badge("muted", "muted"));
  });
});
