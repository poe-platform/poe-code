import { describe, it, expect, vi, beforeEach } from "vitest";
import { Volume, createFsFromVolume } from "memfs";
import type { FileSystem } from "../src/utils/file-system.js";
import type { CommandRunnerResult } from "../src/utils/command-checks.js";
import { createCliEnvironment } from "../src/cli/environment.js";
import type { ProviderIsolatedEnv } from "../src/cli/service-registry.js";
import { EventEmitter } from "events";

function createMemFs(): FileSystem {
  const vol = new Volume();
  vol.mkdirSync("/home/test/.poe-code/test-provider", { recursive: true });
  vol.writeFileSync("/home/test/.poe-code/test-provider/config.json", "{}");
  return createFsFromVolume(vol).promises as unknown as FileSystem;
}

const mockSpawn = vi.fn();

vi.mock("node:child_process", () => ({
  spawn: mockSpawn
}));

describe("isolatedEnvRunner", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSpawn.mockReset();
  });

  it("checks binary exists before spawning", async () => {
    const { isolatedEnvRunner } = await import("../src/cli/isolated-env-runner.js");

    const fs = createMemFs();
    const env = createCliEnvironment({
      cwd: "/repo",
      homeDir: "/home/test"
    });

    const mockCommandRunner = vi.fn(async (command: string): Promise<CommandRunnerResult> => {
      if (command === "which") {
        return { stdout: "", stderr: "", exitCode: 1 };
      }
      if (command === "where") {
        return { stdout: "", stderr: "", exitCode: 1 };
      }
      if (command === "test") {
        return { stdout: "", stderr: "", exitCode: 1 };
      }
      if (command === "ls") {
        return { stdout: "", stderr: "", exitCode: 1 };
      }
      return { stdout: "", stderr: "", exitCode: 0 };
    });

    const isolated: ProviderIsolatedEnv = {
      agentBinary: "nonexistent-binary",
      configProbe: {
        kind: "isolatedDir"
      },
      env: {}
    };

    await expect(
      isolatedEnvRunner({
        env,
        providerName: "test-provider",
        isolated,
        argv: ["node", "poe-code", "--version"],
        fs,
        commandRunner: mockCommandRunner
      })
    ).rejects.toThrow(
      'test-provider binary "nonexistent-binary" not found. Please ensure it is installed and available on PATH.'
    );

    expect(mockCommandRunner).toHaveBeenCalled();
    expect(mockSpawn).not.toHaveBeenCalled();
  });

  it("skips binary check when commandRunner is not provided", async () => {
    const { isolatedEnvRunner } = await import("../src/cli/isolated-env-runner.js");

    const fs = createMemFs();
    const env = createCliEnvironment({
      cwd: "/repo",
      homeDir: "/home/test"
    });

    // Mock spawn to simulate ENOENT error
    mockSpawn.mockImplementation(() => {
      const emitter = new EventEmitter();
      setImmediate(() => {
        const error: NodeJS.ErrnoException = new Error("spawn test-binary ENOENT");
        error.code = "ENOENT";
        emitter.emit("error", error);
      });
      return emitter;
    });

    const isolated: ProviderIsolatedEnv = {
      agentBinary: "test-binary",
      configProbe: {
        kind: "isolatedDir"
      },
      env: {}
    };

    const promise = isolatedEnvRunner({
      env,
      providerName: "test-provider",
      isolated,
      argv: ["node", "poe-code", "--version"],
      fs
    });

    // The function will attempt to spawn, which we expect to fail with ENOENT
    // but it won't fail with our custom error message (since commandRunner is not provided)
    await expect(promise).rejects.toThrow("spawn test-binary ENOENT");
    expect(mockSpawn).toHaveBeenCalledWith("test-binary", ["--version"], expect.any(Object));
  });

  it("throws error when config does not exist", async () => {
    const { isolatedEnvRunner } = await import("../src/cli/isolated-env-runner.js");

    const vol = new Volume();
    vol.mkdirSync("/home/test", { recursive: true });
    const fs = createFsFromVolume(vol).promises as unknown as FileSystem;

    const env = createCliEnvironment({
      cwd: "/repo",
      homeDir: "/home/test"
    });

    const mockCommandRunner = vi.fn(async (): Promise<CommandRunnerResult> => ({
      stdout: "",
      stderr: "",
      exitCode: 0
    }));

    const isolated: ProviderIsolatedEnv = {
      agentBinary: "test-binary",
      configProbe: {
        kind: "isolatedDir"
      },
      env: {}
    };

    await expect(
      isolatedEnvRunner({
        env,
        providerName: "test-provider",
        isolated,
        argv: ["node", "poe-code", "--version"],
        fs,
        commandRunner: mockCommandRunner
      })
    ).rejects.toThrow(
      "test-provider is not configured. Run 'poe-code login' or 'poe-code configure test-provider'."
    );

    // Binary check should not be called if config doesn't exist
    expect(mockCommandRunner).not.toHaveBeenCalled();
    expect(mockSpawn).not.toHaveBeenCalled();
  });

  it("proceeds to spawn when binary exists", async () => {
    const { isolatedEnvRunner } = await import("../src/cli/isolated-env-runner.js");

    const fs = createMemFs();
    const env = createCliEnvironment({
      cwd: "/repo",
      homeDir: "/home/test"
    });

    const mockCommandRunner = vi.fn(async (command: string): Promise<CommandRunnerResult> => {
      if (command === "which") {
        return { stdout: "/usr/local/bin/test-binary", stderr: "", exitCode: 0 };
      }
      return { stdout: "", stderr: "", exitCode: 1 };
    });

    // Mock spawn to simulate spawn error (since binary doesn't really exist)
    mockSpawn.mockImplementation(() => {
      const emitter = new EventEmitter();
      setImmediate(() => {
        const error: NodeJS.ErrnoException = new Error("spawn test-binary ENOENT");
        error.code = "ENOENT";
        emitter.emit("error", error);
      });
      return emitter;
    });

    const isolated: ProviderIsolatedEnv = {
      agentBinary: "test-binary",
      configProbe: {
        kind: "isolatedDir"
      },
      env: {}
    };

    const promise = isolatedEnvRunner({
      env,
      providerName: "test-provider",
      isolated,
      argv: ["node", "poe-code", "--version"],
      fs,
      commandRunner: mockCommandRunner
    });

    // The spawn will fail because the binary doesn't actually exist,
    // but we should verify that the binary check passed
    await expect(promise).rejects.toThrow("spawn test-binary ENOENT");

    // Verify that the binary check was attempted and passed
    expect(mockCommandRunner).toHaveBeenCalledWith("which", ["test-binary"]);
    // Verify that spawn was called (meaning binary check passed)
    expect(mockSpawn).toHaveBeenCalledWith("test-binary", ["--version"], expect.any(Object));
  });
});
