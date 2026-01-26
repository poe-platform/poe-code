import { describe, it, expect, vi, beforeEach } from "vitest";
import { Volume, createFsFromVolume } from "memfs";
import type { FileSystem } from "../src/utils/file-system.js";

function createMemFs(): FileSystem {
  const vol = new Volume();
  vol.mkdirSync("/home/test", { recursive: true });
  return createFsFromVolume(vol).promises as unknown as FileSystem;
}

vi.mock("../src/cli/isolated-env-runner.js", () => ({
  isolatedEnvRunner: vi.fn(async () => {
    throw new Error("STOP_WRAP");
  })
}));

vi.mock("../src/cli/commands/ensure-isolated-config.js", () => ({
  ensureIsolatedConfigForService: vi.fn(async () => {})
}));

describe("wrap command", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("forwards only agent args to the wrapped binary", async () => {
    const { createProgram } = await import("../src/cli/program.js");
    const runner = await import("../src/cli/isolated-env-runner.js");
    const ensure = await import("../src/cli/commands/ensure-isolated-config.js");

    const fs = createMemFs();
    const program = createProgram({
      fs,
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd: "/repo", homeDir: "/home/test" },
      logger: () => {},
      commandRunner: vi.fn(async () => ({ stdout: "", stderr: "", exitCode: 0 }))
    });

    await expect(
      program.parseAsync(["node", "cli", "wrap", "codex", "--", "--version"])
    ).rejects.toThrow("STOP_WRAP");

    expect(ensure.ensureIsolatedConfigForService).toHaveBeenCalledWith(
      expect.objectContaining({ service: "codex", refresh: true })
    );

    expect(runner.isolatedEnvRunner).toHaveBeenCalledWith(
      expect.objectContaining({
        argv: ["node", "poe-code", "--version"],
        providerName: "codex"
      })
    );
  });

  it("accepts option-like agent args without an extra --", async () => {
    const { createProgram } = await import("../src/cli/program.js");
    const runner = await import("../src/cli/isolated-env-runner.js");

    const fs = createMemFs();
    const program = createProgram({
      fs,
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd: "/repo", homeDir: "/home/test" },
      logger: () => {},
      commandRunner: vi.fn(async () => ({ stdout: "", stderr: "", exitCode: 0 }))
    });

    await expect(
      program.parseAsync(["node", "cli", "wrap", "codex", "-p", "Say hi"])
    ).rejects.toThrow("STOP_WRAP");

    expect(runner.isolatedEnvRunner).toHaveBeenCalledWith(
      expect.objectContaining({
        argv: ["node", "poe-code", "-p", "Say hi"],
        providerName: "codex"
      })
    );
  });
});
