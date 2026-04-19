import { afterEach, describe, expect, it, vi } from "vitest";
import { Command } from "commander";
import { Volume, createFsFromVolume } from "memfs";
import { createCliContainer } from "../container.js";
import type { FileSystem } from "../../utils/file-system.js";
import { registerPlanCommand } from "./plan.js";

const { runPlanBrowserMock } = vi.hoisted(() => ({
  runPlanBrowserMock: vi.fn().mockResolvedValue(undefined)
}));

vi.mock("@poe-code/plan-browser", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@poe-code/plan-browser")>();
  return {
    ...actual,
    runPlanBrowser: runPlanBrowserMock
  };
});

vi.mock("@poe-code/design-system", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@poe-code/design-system")>();
  return {
    ...actual,
    intro: vi.fn()
  };
});

function createMemFs(): FileSystem {
  const volume = Volume.fromJSON({}, "/");
  return createFsFromVolume(volume).promises as unknown as FileSystem;
}

function createBaseProgram(): Command {
  const program = new Command();
  program.exitOverride();
  program.name("poe-code").option("-y, --yes").option("--dry-run").option("--verbose");
  return program;
}

describe("plan browse command", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  it("passes assumeYes to the browser for --yes", async () => {
    const container = createCliContainer({
      fs: createMemFs(),
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd: "/repo", homeDir: "/home/test" },
      logger: () => {}
    });
    const program = createBaseProgram();
    registerPlanCommand(program, container);

    await program.parseAsync(["node", "cli", "--yes", "plan", "browse"]);

    expect(runPlanBrowserMock).toHaveBeenCalledWith(
      expect.objectContaining({
        assumeYes: true
      })
    );
  });

  it("forwards --kind to the browser", async () => {
    const container = createCliContainer({
      fs: createMemFs(),
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd: "/repo", homeDir: "/home/test" },
      logger: () => {}
    });
    const program = createBaseProgram();
    registerPlanCommand(program, container);

    await program.parseAsync([
      "node",
      "cli",
      "plan",
      "browse",
      "--kind",
      "ralph"
    ]);

    expect(runPlanBrowserMock).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "ralph" })
    );
  });

  it("forwards superintendent kinds to the browser", async () => {
    const container = createCliContainer({
      fs: createMemFs(),
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd: "/repo", homeDir: "/home/test" },
      logger: () => {}
    });
    const program = createBaseProgram();
    registerPlanCommand(program, container);

    await program.parseAsync([
      "node",
      "cli",
      "plan",
      "browse",
      "--kind",
      "superintendent"
    ]);

    expect(runPlanBrowserMock).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "superintendent" })
    );
  });
});
