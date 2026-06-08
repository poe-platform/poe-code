import { beforeEach, describe, expect, it, vi } from "vitest";

describe("toolcraft CLI entry point theme", () => {
  beforeEach(async () => {
    const { resetTheme } = await import("toolcraft-design");
    resetTheme();
    vi.resetModules();
  });

  it("configures the toolcraft brand on import", async () => {
    await import("./cli.js");
    const { getThemeConfig } = await import("toolcraft-design");

    expect(getThemeConfig()).toEqual({ brand: "blue", label: "Toolcraft" });
  });
});
