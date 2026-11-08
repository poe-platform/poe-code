import { describe, expect, it, vi } from "vitest";
import { createRuntimeLogger } from "./runtime-logging.js";

describe("runtime logging", () => {
  it("gates diagnostic events by log level", () => {
    const emit = vi.fn();
    const logger = createRuntimeLogger({
      level: "warn",
      logger: emit
    });

    logger.emit({ level: "info", message: "starting", category: "progress" });
    logger.emit({ level: "warn", message: "retrying", category: "retry" });
    logger.emit({ level: "error", message: "failed", category: "runtime" });

    expect(logger.level).toBe("warn");
    expect(emit).toHaveBeenCalledTimes(2);
    expect(emit.mock.calls.map(([event]) => event.message)).toEqual(["retrying", "failed"]);
  });

  it("supports silent log level for non-error diagnostic events", () => {
    const emit = vi.fn();
    const logger = createRuntimeLogger({
      level: "silent",
      logger: emit
    });

    logger.emit({ level: "error", message: "failed", category: "runtime" });

    expect(emit).not.toHaveBeenCalled();
  });
});
