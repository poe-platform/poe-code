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

describe("dry run change reporting", () => {
  function createDryHarness() {
    const logs: string[] = [];
    const loggerFactory = createLoggerFactory((message) => {
      logs.push(message);
    });
    const volume = new Volume();
    const fs = createFsFromVolume(volume).promises as unknown as FileSystem;
    const factory = createCommandContextFactory({ fs });
    return {
      logs,
      volume,
      context: factory.create({ dryRun: true, logger: loggerFactory.create(), runner })
    };
  }

  it("reports no filesystem changes when every previewed operation is a no-op", async () => {
    const { logs, volume, context } = createDryHarness();
    volume.mkdirSync("/home/test/.gemini", { recursive: true });
    volume.writeFileSync("/home/test/.gemini/settings.json", "{}\n");

    // Mirrors an agent whose config is already up to date: the manifest still
    // ensures the directory and rewrites identical content.
    await context.fs.mkdir("/home/test/.gemini", { recursive: true });
    await context.fs.writeFile("/home/test/.gemini/settings.json", "{}\n", { encoding: "utf8" });
    context.flushDryRun({ emitIfEmpty: false });
    context.complete({ success: "Configured Gemini CLI.", dry: "Dry run: would configure Gemini CLI." });

    const output = logs.join("\n");
    expect(output).toContain("Dry run: would configure Gemini CLI.");
    expect(output).toContain("no filesystem changes");
  });

  it("does not claim no filesystem changes when a real change was previewed", async () => {
    const { logs, volume, context } = createDryHarness();
    volume.mkdirSync("/home/test/.gemini", { recursive: true });
    volume.writeFileSync("/home/test/.gemini/settings.json", "{}\n");

    await context.fs.mkdir("/home/test/.gemini", { recursive: true });
    await context.fs.writeFile("/home/test/.gemini/settings.json", '{"model":"new"}\n', {
      encoding: "utf8"
    });
    context.flushDryRun({ emitIfEmpty: false });
    context.complete({ success: "Configured Gemini CLI.", dry: "Dry run: would configure Gemini CLI." });

    const output = logs.join("\n");
    expect(output).toContain("# update");
    expect(output).not.toContain("no filesystem changes");
  });
});

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
