import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../internal/color-support.js", () => ({
  supportsColor: () => true
}));

import { configureTheme, resetTheme } from "../internal/theme-state.js";
import { brands } from "./brand.js";
import { createPalette, dark, light } from "./colors.js";

describe("createPalette", () => {
  beforeEach(() => {
    resetTheme();
  });

  it("preserves the default palettes exactly", () => {
    const purpleDark = createPalette(brands.purple!, "dark");
    const purpleLight = createPalette(brands.purple!, "light");

    for (const key of Object.keys(dark) as Array<keyof typeof dark>) {
      const current = dark[key];
      const created = purpleDark[key];
      expect(typeof created === "function" ? created("value") : created).toBe(
        typeof current === "function" ? current("value") : current
      );
    }
    for (const key of Object.keys(light) as Array<keyof typeof light>) {
      const current = light[key];
      const created = purpleLight[key];
      expect(typeof created === "function" ? created("value") : created).toBe(
        typeof current === "function" ? current("value") : current
      );
    }
  });

  it.each([
    ["blue", "#2f6fed", "47;111;237"],
    ["green", "#1f9d57", "31;157;87"]
  ] as const)("uses the %s brand for dark brand colors", (name, primary, rgb) => {
    const palette = createPalette(brands[name]!, "dark");

    expect(brands[name]!.primary).toBe(primary);
    expect(palette.header("Header")).toBe(`\x1b[38;2;${rgb}m\x1b[1mHeader\x1b[0m`);
    expect(palette.intro("Intro")).toBe(`\x1b[48;2;${rgb}m\x1b[37m Poe - Intro \x1b[0m`);
    expect(palette.resolvedSymbol).toBe(`\x1b[38;2;${rgb}m◇\x1b[0m`);
    expect(palette.info("Info")).toBe(`\x1b[38;2;${rgb}mInfo\x1b[0m`);
    expect(palette.accent("Accent")).toBe(`\x1b[38;2;${rgb}mAccent\x1b[0m`);
    expect(palette.prompt("Prompt")).toBe(`\x1b[38;2;${rgb}mPrompt\x1b[0m`);
    expect(palette.number("1")).toBe(`\x1b[38;2;${rgb}m1\x1b[0m`);

    expect(palette.success("Success")).toBe(dark.success("Success"));
    expect(palette.warning("Warning")).toBe(dark.warning("Warning"));
    expect(palette.error("Error")).toBe(dark.error("Error"));
    expect(palette.muted("Muted")).toBe(dark.muted("Muted"));
  });

  it("embeds the configured label", () => {
    configureTheme({ label: "Acme" });

    expect(createPalette(brands.purple!, "dark").intro("Ready")).toBe(
      "\x1b[45m\x1b[37m Acme - Ready \x1b[0m"
    );
  });
});
