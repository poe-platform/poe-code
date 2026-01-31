import { describe, it, expect } from "vitest";
import {
  createMenuTheme,
  resolveMenuThemeName
} from "./theme.js";
import type { CliEnvironment } from "../environment.js";

function createEnv(vars: Record<string, string | undefined>): CliEnvironment {
  return {
    cwd: "/repo",
    homeDir: "/home/test",
    platform: "darwin",
    credentialsPath: "/home/test/.poe-code/credentials.json",
    logDir: "/home/test/.poe-code/logs",
    poeApiBaseUrl: "https://api.poe.com/v1",
    poeBaseUrl: "https://api.poe.com",
    variables: vars,
    resolveHomePath: (...segments: string[]) => ["/home/test", ...segments].join("/"),
    getVariable: (name: string) => vars[name]
  };
}

describe("resolveMenuThemeName", () => {
  it("defaults to dark theme when unset", () => {
    const theme = resolveMenuThemeName(createEnv({}));
    expect(theme).toBe("dark");
  });

  it("respects POE_CODE_THEME=light", () => {
    const theme = resolveMenuThemeName(createEnv({ POE_CODE_THEME: "light" }));
    expect(theme).toBe("light");
  });

  it("detects dark mode via Apple interface style", () => {
    const theme = resolveMenuThemeName(
      createEnv({ APPLE_INTERFACE_STYLE: "Dark" })
    );
    expect(theme).toBe("dark");
  });

  it("detects light mode via VSCode theme kind", () => {
    const theme = resolveMenuThemeName(
      createEnv({ VSCODE_COLOR_THEME_KIND: "light" })
    );
    expect(theme).toBe("light");
  });

  it("uses COLORFGBG background to infer light mode", () => {
    const theme = resolveMenuThemeName(createEnv({ COLORFGBG: "0;15" }));
    expect(theme).toBe("light");
  });
});

describe("createMenuTheme", () => {
  it("wraps structural strings using ANSI styles but leaves fallback plain", () => {
    const theme = createMenuTheme(createEnv({}));
    const palette = theme.palette;
    expect(palette.header("headline")).toContain("\u001b[");
    expect(palette.number(1)).toContain("\u001b[");
    expect(palette.providerFallback("fallback")).toBe("fallback");
  });

  it("produces different prompt colors for light vs dark themes", () => {
    const dark = createMenuTheme(createEnv({}));
    const light = createMenuTheme(createEnv({ POE_CODE_THEME: "light" }));
    expect(dark.palette.prompt("Prompt")).not.toEqual(
      light.palette.prompt("Prompt")
    );
  });
});
