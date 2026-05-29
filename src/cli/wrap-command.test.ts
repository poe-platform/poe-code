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

async function configureService(fs: FileSystem, service: string, provider: string): Promise<void> {
  const apiShape = service === "gemini-cli" ? "google-generations" : "anthropic-messages";
  await fs.mkdir("/home/test/.poe-code", { recursive: true });
  await fs.writeFile(
    "/home/test/.poe-code/config.json",
    JSON.stringify({ configured_services: { [service]: { provider, apiShape, files: [] } } })
  );
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

  it.each([
    ["claude-code", "poe", { POE_API_KEY: "sk-wrap" }],
    [
      "gemini-cli",
      "cloudflare",
      { CF_AIG_TOKEN: "sk-wrap", CF_AIG_BASE_URL: "https://gateway.example.test/poe" }
    ]
  ])("passes provider context to the %s isolated runner", async (service, provider, variables) => {
      const fs = createMemFs();
      await configureService(fs, service, provider);
      const program = createProgram({
        fs,
        prompts: vi.fn().mockResolvedValue({}),
        env: { cwd: "/repo", homeDir: "/home/test", variables },
        logger: () => {},
        commandRunner: vi.fn(async () => ({ stdout: "", stderr: "", exitCode: 0 }))
      });

      await expect(program.parseAsync(["node", "cli", "wrap", service])).rejects.toThrow(
        "STOP_WRAP"
      );

      expect(runner.isolatedEnvRunner).toHaveBeenCalledWith(
        expect.objectContaining({
          providerName: service,
          activeProvider: expect.objectContaining({ credential: "sk-wrap" })
        })
      );
    });
});
