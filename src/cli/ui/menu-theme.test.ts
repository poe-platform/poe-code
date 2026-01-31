import { describe, it, expect, beforeEach } from "vitest";
import {
  resolveThemeName,
  getTheme,
  resetThemeCache,
  dark,
  light
} from "@poe-code/design-system";

beforeEach(() => {
  resetThemeCache();
});

describe("resolveThemeName", () => {
  it("defaults to dark theme when unset", () => {
    const theme = resolveThemeName({});
    expect(theme).toBe("dark");
  });

  it("respects POE_CODE_THEME=light", () => {
    const theme = resolveThemeName({ POE_CODE_THEME: "light" });
    expect(theme).toBe("light");
  });

  it("detects dark mode via Apple interface style", () => {
    const theme = resolveThemeName({ APPLE_INTERFACE_STYLE: "Dark" });
    expect(theme).toBe("dark");
  });

  it("detects light mode via VSCode theme kind", () => {
    const theme = resolveThemeName({ VSCODE_COLOR_THEME_KIND: "light" });
    expect(theme).toBe("light");
  });

  it("uses COLORFGBG background to infer light mode", () => {
    const theme = resolveThemeName({ COLORFGBG: "0;15" });
    expect(theme).toBe("light");
  });
});

describe("getTheme", () => {
  it("wraps structural strings using ANSI styles", () => {
    const palette = getTheme({ POE_CODE_THEME: "dark" });
    expect(palette.header("headline")).toContain("\u001b[");
    expect(palette.number("1")).toContain("\u001b[");
  });

  it("produces different prompt colors for light vs dark themes", () => {
    expect(dark.prompt("Prompt")).not.toEqual(light.prompt("Prompt"));
  });
});
