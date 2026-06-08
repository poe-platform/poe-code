import { beforeEach, describe, expect, it, vi } from "vitest";

describe("poe-code CLI entry point theme", () => {
  beforeEach(async () => {
    const { resetTheme } = await import("toolcraft-design");
    resetTheme();
    vi.resetModules();
  });

  it("configures the poe brand on import", async () => {
    await import("./index.js");
    const { getThemeConfig } = await import("toolcraft-design");

    expect(getThemeConfig()).toEqual({ brand: "purple", label: "Poe" });
  });

  it("restores the poe brand after loading the toolcraft CLI", async () => {
    const { main } = await import("./index.js");
    const design = await import("toolcraft-design");
    design.configureTheme({ brand: "green", label: "Other" });

    await main();

    expect(design.getThemeConfig()).toEqual({ brand: "purple", label: "Poe" });
  });
});
