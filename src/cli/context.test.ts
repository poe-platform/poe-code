import { describe, it, expect } from "vitest";
import { Volume, createFsFromVolume } from "memfs";
import { createCommandContextFactory } from "./context.js";
import { createLoggerFactory } from "./logger.js";
import type { FileSystem } from "../utils/file-system.js";
import type { CommandRunner } from "../utils/command-checks.js";

const runner: CommandRunner = async () => ({
  stdout: "",
  stderr: "",
  exitCode: 0
});

function createHarness() {
  const logs: string[] = [];
  const loggerFactory = createLoggerFactory((message) => {
    logs.push(message);
  });
  const fs = createFsFromVolume(new Volume()).promises as unknown as FileSystem;
  const factory = createCommandContextFactory({ fs });
  return {
    logs,
    factory,
    logger: loggerFactory.create(),
    feedbackLines: () => logs.filter((line) => line.includes("Problems?"))
  };
}

describe("command context finalize", () => {
  it("emits the feedback footer once even when finalize is called repeatedly", () => {
    const { factory, logger, feedbackLines } = createHarness();
    const context = factory.create({ dryRun: false, logger, runner });

    context.finalize();
    context.finalize();
    context.finalize();

    expect(feedbackLines()).toHaveLength(1);
  });

  it("emits the feedback footer once across sub-operation contexts", () => {
    const { factory, logger, feedbackLines } = createHarness();

    factory.create({ dryRun: false, logger, runner }).finalize();
    factory.create({ dryRun: true, logger, runner }).finalize();
    factory.create({ dryRun: false, logger, runner }).finalize();

    expect(feedbackLines()).toHaveLength(1);
  });
});
