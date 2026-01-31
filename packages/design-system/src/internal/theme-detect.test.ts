import { describe, it, expect, beforeEach } from "vitest";
import { resolveThemeName, getTheme, resetThemeCache } from "./theme-detect.js";
import { dark, light } from "../tokens/colors.js";

describe("theme-detect", () => {
  beforeEach(() => {
    resetThemeCache();
  });

  describe("resolveThemeName", () => {
    it("returns dark by default", () => {
      expect(resolveThemeName({})).toBe("dark");
    });

    it("respects POE_CODE_THEME=light", () => {
      expect(resolveThemeName({ POE_CODE_THEME: "light" })).toBe("light");
    });

    it("respects POE_CODE_THEME=dark", () => {
      expect(resolveThemeName({ POE_CODE_THEME: "dark" })).toBe("dark");
    });

    it("POE_CODE_THEME is case insensitive", () => {
      expect(resolveThemeName({ POE_CODE_THEME: "LIGHT" })).toBe("light");
      expect(resolveThemeName({ POE_CODE_THEME: "Dark" })).toBe("dark");
    });

    it("detects dark from APPLE_INTERFACE_STYLE", () => {
      expect(resolveThemeName({ APPLE_INTERFACE_STYLE: "Dark" })).toBe("dark");
    });

    it("detects light from APPLE_INTERFACE_STYLE", () => {
      expect(resolveThemeName({ APPLE_INTERFACE_STYLE: "Light" })).toBe("light");
    });

    it("detects light from VSCODE_COLOR_THEME_KIND", () => {
      expect(resolveThemeName({ VSCODE_COLOR_THEME_KIND: "vscode-light" })).toBe("light");
    });

    it("detects dark from VSCODE_COLOR_THEME_KIND", () => {
      expect(resolveThemeName({ VSCODE_COLOR_THEME_KIND: "vscode-dark" })).toBe("dark");
    });

    it("detects dark from COLORFGBG with low background", () => {
      expect(resolveThemeName({ COLORFGBG: "15;0" })).toBe("dark");
    });

    it("detects light from COLORFGBG with high background", () => {
      expect(resolveThemeName({ COLORFGBG: "0;15" })).toBe("light");
    });

    it("POE_CODE_THEME takes precedence over APPLE_INTERFACE_STYLE", () => {
      expect(resolveThemeName({
        POE_CODE_THEME: "light",
        APPLE_INTERFACE_STYLE: "Dark"
      })).toBe("light");
    });
  });

  describe("getTheme", () => {
    it("returns dark palette by default", () => {
      const theme = getTheme({});
      expect(theme).toBe(dark);
    });

    it("returns light palette when POE_CODE_THEME=light", () => {
      const theme = getTheme({ POE_CODE_THEME: "light" });
      expect(theme).toBe(light);
    });

    it("caches the theme", () => {
      const theme1 = getTheme({ POE_CODE_THEME: "light" });
      const theme2 = getTheme({ POE_CODE_THEME: "dark" });
      expect(theme1).toBe(theme2);
    });

    it("resetThemeCache clears the cache", () => {
      getTheme({ POE_CODE_THEME: "light" });
      resetThemeCache();
      const theme = getTheme({ POE_CODE_THEME: "dark" });
      expect(theme).toBe(dark);
    });
  });
});
