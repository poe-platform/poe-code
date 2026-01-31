import { describe, it, expect, vi } from "vitest";
import { createLoggerFactory } from "./logger.js";
import { createMutationReporter } from "../services/mutation-events.js";

describe("--verbose flag logging behavior", () => {
  it("hides mutation completion logs by default", () => {
    const emitter = vi.fn();
    const factory = createLoggerFactory(emitter);
    const logger = factory.create({ verbose: false });
    const reporter = createMutationReporter(logger);

    reporter.onComplete(
      { label: "write config", targetPath: "/tmp/config.json" },
      { changed: true, effect: "write", detail: "updated" }
    );

    expect(emitter).toHaveBeenCalledTimes(0);
  });

  it("shows mutation completion logs when verbose is enabled", () => {
    const emitter = vi.fn();
    const factory = createLoggerFactory(emitter);
    const logger = factory.create({ verbose: true });
    const reporter = createMutationReporter(logger);

    reporter.onComplete(
      { label: "write config", targetPath: "/tmp/config.json" },
      { changed: true, effect: "write", detail: "updated" }
    );

    expect(emitter).toHaveBeenCalledTimes(1);
  });

  it("omits scope prefixes when verbose is disabled", () => {
    const emitter = vi.fn();
    const factory = createLoggerFactory(emitter);
    const logger = factory.create({
      verbose: false,
      scope: "configure:claude-code"
    });

    logger.info("Configured Claude Code.");

    expect(emitter).toHaveBeenCalledWith("Configured Claude Code.");
  });

  it("includes scope prefixes when verbose is enabled", () => {
    const emitter = vi.fn();
    const factory = createLoggerFactory(emitter);
    const logger = factory.create({
      verbose: true,
      scope: "configure:claude-code"
    });

    logger.info("Configured Claude Code.");

    expect(emitter).toHaveBeenCalledWith(
      "[configure:claude-code] Configured Claude Code."
    );
  });
});
