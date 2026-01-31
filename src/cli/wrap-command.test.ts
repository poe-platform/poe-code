import { describe, it, expect, vi, beforeEach } from "vitest";
import { Volume, createFsFromVolume } from "memfs";
import type { FileSystem } from "../utils/file-system.js";

vi.mock("./isolated-env-runner.js", () => ({
  isolatedEnvRunner: vi.fn(async () => {
    throw new Error("STOP_WRAP");
  })
}));

vi.mock("./commands/ensure-isolated-config.js", () => ({
  ensureIsolatedConfigForService: vi.fn(async () => {})
}));

import { createProgram } from "./program.js";
import * as runner from "./isolated-env-runner.js";
import * as ensure from "./commands/ensure-isolated-config.js";

function createMemFs(): FileSystem {
  const vol = new Volume();
  vol.mkdirSync("/home/test", { recursive: true });
  return createFsFromVolume(vol).promises as unknown as FileSystem;
}

describe("wrap command", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("forwards only agent args to the wrapped binary", async () => {
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
