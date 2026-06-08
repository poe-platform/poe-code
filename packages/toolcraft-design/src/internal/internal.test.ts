import { describe, it, expect, beforeEach } from "vitest";
import { resolveOutputFormat, resetOutputFormatCache, withOutputFormat } from "./output-format.js";
import { resolveThemeName, getTheme, resetThemeCache } from "./theme-detect.js";
import { supportsColor } from "./color-support.js";
import { dark, light } from "../tokens/colors.js";
import { configureTheme, resetTheme } from "./theme-state.js";

describe("resolveOutputFormat", () => {
  beforeEach(() => {
    resetOutputFormatCache();
  });

  it("defaults to terminal when env var is unset", () => {
    expect(resolveOutputFormat({})).toBe("terminal");
  });

  it("returns markdown when OUTPUT_FORMAT=markdown", () => {
    expect(resolveOutputFormat({ OUTPUT_FORMAT: "markdown" })).toBe("markdown");
  });

  it("returns json when OUTPUT_FORMAT=json", () => {
    expect(resolveOutputFormat({ OUTPUT_FORMAT: "json" })).toBe("json");
  });

  it("returns terminal when OUTPUT_FORMAT=terminal", () => {
    expect(resolveOutputFormat({ OUTPUT_FORMAT: "terminal" })).toBe("terminal");
  });

  it("returns terminal for unknown values", () => {
    expect(resolveOutputFormat({ OUTPUT_FORMAT: "csv" })).toBe("terminal");
  });

  it("is case-insensitive", () => {
    expect(resolveOutputFormat({ OUTPUT_FORMAT: "MARKDOWN" })).toBe("markdown");
    resetOutputFormatCache();
    expect(resolveOutputFormat({ OUTPUT_FORMAT: "Json" })).toBe("json");
  });

  it("caches the result after first call", () => {
    resolveOutputFormat({ OUTPUT_FORMAT: "json" });
    expect(resolveOutputFormat({ OUTPUT_FORMAT: "markdown" })).toBe("json");
  });

  it("resetOutputFormatCache clears the cache", () => {
    resolveOutputFormat({ OUTPUT_FORMAT: "json" });
    resetOutputFormatCache();
    expect(resolveOutputFormat({ OUTPUT_FORMAT: "markdown" })).toBe("markdown");
  });

  it("uses the scoped override inside withOutputFormat", () => {
    resolveOutputFormat({ OUTPUT_FORMAT: "json" });

    const scoped = withOutputFormat("markdown", () => resolveOutputFormat());

    expect(scoped).toBe("markdown");
    expect(resolveOutputFormat()).toBe("json");
  });

  it("prefers the innermost scoped override", () => {
    const scoped = withOutputFormat("markdown", () =>
      withOutputFormat("json", () => resolveOutputFormat())
    );

    expect(scoped).toBe("json");
    expect(resolveOutputFormat({ OUTPUT_FORMAT: "terminal" })).toBe("terminal");
  });

  it("propagates the scoped override through await", async () => {
    const scoped = await withOutputFormat("markdown", async () => {
      await Promise.resolve();
      return resolveOutputFormat({ OUTPUT_FORMAT: "json" });
    });

    expect(scoped).toBe("markdown");
    expect(resolveOutputFormat({ OUTPUT_FORMAT: "json" })).toBe("json");
  });

  it("restores the outer scoped override after an inner async override completes", async () => {
    const scoped = await withOutputFormat("markdown", async () => {
      await withOutputFormat("json", async () => {
        await Promise.resolve();
        expect(resolveOutputFormat({ OUTPUT_FORMAT: "terminal" })).toBe("json");
      });

      return resolveOutputFormat({ OUTPUT_FORMAT: "terminal" });
    });

    expect(scoped).toBe("markdown");
    expect(resolveOutputFormat({ OUTPUT_FORMAT: "terminal" })).toBe("terminal");
  });

  it("propagates the scoped override through timer callbacks", async () => {
    const scoped = await withOutputFormat(
      "markdown",
      async () =>
        new Promise<ReturnType<typeof resolveOutputFormat>>((resolve) => {
          setTimeout(() => {
            resolve(resolveOutputFormat({ OUTPUT_FORMAT: "json" }));
          }, 0);
        })
    );

    expect(scoped).toBe("markdown");
    expect(resolveOutputFormat({ OUTPUT_FORMAT: "json" })).toBe("json");
  });
});

describe("supportsColor", () => {
  it("lets FORCE_COLOR override NO_COLOR", () => {
    expect(supportsColor({ FORCE_COLOR: "1", NO_COLOR: "1" }, {})).toBe(true);
  });

  it("honors NO_COLOR when FORCE_COLOR is not set", () => {
    expect(supportsColor({ NO_COLOR: "1", TERM: "xterm-256color" }, { isTTY: true })).toBe(false);
  });

  it("does not force color for FORCE_COLOR=0", () => {
    expect(supportsColor({ FORCE_COLOR: "0", TERM: "xterm-256color" }, { isTTY: false })).toBe(
      false
    );
  });
});

describe("theme-detect", () => {
  beforeEach(() => {
    resetTheme();
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

    it("respects POE_THEME=light", () => {
      expect(resolveThemeName({ POE_THEME: "light" })).toBe("light");
    });

    it("respects POE_THEME=dark", () => {
      expect(resolveThemeName({ POE_THEME: "dark" })).toBe("dark");
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
      expect(
        resolveThemeName({
          POE_CODE_THEME: "light",
          APPLE_INTERFACE_STYLE: "Dark"
        })
      ).toBe("light");
    });

    it("POE_CODE_THEME takes precedence over POE_THEME", () => {
      expect(
        resolveThemeName({
          POE_CODE_THEME: "light",
          POE_THEME: "dark"
        })
      ).toBe("light");
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

    it("returns light palette when POE_THEME=light", () => {
      const theme = getTheme({ POE_THEME: "light" });
      expect(theme).toBe(light);
    });

    it("uses POE_BRAND as a debug brand override", () => {
      const purple = getTheme({ POE_CODE_THEME: "dark" });
      const blue = getTheme({ POE_CODE_THEME: "dark", POE_BRAND: "blue" });

      expect(blue).not.toBe(purple);
    });

    it("ignores unknown POE_BRAND values", () => {
      expect(getTheme({ POE_CODE_THEME: "dark", POE_BRAND: "orange" })).toBe(dark);
    });

    it("prefers an explicitly configured brand over POE_BRAND", () => {
      configureTheme({ brand: "green" });

      const configured = getTheme({ POE_CODE_THEME: "dark" });
      const withOverride = getTheme({ POE_CODE_THEME: "dark", POE_BRAND: "blue" });

      expect(withOverride).toBe(configured);
    });

    it("caches each mode separately", () => {
      const theme1 = getTheme({ POE_CODE_THEME: "light" });
      const theme2 = getTheme({ POE_CODE_THEME: "dark" });
      expect(theme1).toBe(light);
      expect(theme2).toBe(dark);
      expect(getTheme({ POE_CODE_THEME: "light" })).toBe(theme1);
    });

    it("resetThemeCache clears the cache", () => {
      getTheme({ POE_CODE_THEME: "light" });
      resetThemeCache();
      const theme = getTheme({ POE_CODE_THEME: "dark" });
      expect(theme).toBe(dark);
    });

    it("caches by brand and mode", () => {
      const purple = getTheme({ POE_CODE_THEME: "dark" });
      configureTheme({ brand: "blue" });
      const blue = getTheme({ POE_CODE_THEME: "dark" });

      expect(blue).not.toBe(purple);
      expect(getTheme({ POE_CODE_THEME: "dark" })).toBe(blue);
    });
  });
});
