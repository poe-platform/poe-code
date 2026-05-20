import { describe, expect, it, vi } from "vitest";
import {
  buildMaestroExplorerConfig,
  runMaestroTui,
  type RunMaestroTuiOptions
} from "./index.js";

describe("maestro-tui public API", () => {
  it("builds a read-only explorer config placeholder", async () => {
    const config = buildMaestroExplorerConfig();

    await expect(config.rows()).resolves.toEqual([]);
    expect(config.title).toBe("Maestro Tasks");
    expect(config.actions).toEqual([]);
    expect(config.emptyHint).toBe("No maestro tasks found");
  });

  it("runs the generated config through the injected explorer", async () => {
    const runExplorerImpl: NonNullable<RunMaestroTuiOptions["runExplorerImpl"]> = vi
      .fn()
      .mockResolvedValue(null);

    await runMaestroTui({ runExplorerImpl });

    expect(runExplorerImpl).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Maestro Tasks",
        actions: []
      })
    );
  });
});
