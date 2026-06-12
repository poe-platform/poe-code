import { describe, expect, it } from "vitest";
import { configureTheme, getThemeConfig, resetTheme } from "toolcraft-design";
import { applyPoeTheme } from "./poe-theme.js";

describe("applyPoeTheme", () => {
  it("configures the Poe brand", () => {
    resetTheme();

    applyPoeTheme();

    expect(getThemeConfig()).toEqual({ brand: "purple", label: "Poe" });
  });

  it("restores the Poe brand after another entry point changes it", () => {
    resetTheme();
    applyPoeTheme();
    configureTheme({ brand: "green", label: "Other" });

    applyPoeTheme();

    expect(getThemeConfig()).toEqual({ brand: "purple", label: "Poe" });
  });
});
