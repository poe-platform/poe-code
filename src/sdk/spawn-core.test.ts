import { describe, it, expect, vi, beforeEach } from "vitest";
import { Volume, createFsFromVolume } from "memfs";
import { resolveConfigPath } from "@poe-code/poe-code-config";
import { createCliContainer, type CliDependencies } from "../cli/container.js";
import { DEFAULT_FRONTIER_MODEL } from "../cli/constants.js";
import { resolveConfiguredModel, spawnCore } from "./spawn-core.js";
import type { FileSystem } from "../utils/file-system.js";
import type {
  CommandRunner,
  CommandRunnerOptions,
  CommandRunnerResult
} from "../utils/command-checks.js";

const cwd = "/repo";
const homeDir = "/home/test";

function createMemFs(): FileSystem {
  const vol = new Volume();
  vol.mkdirSync(homeDir, { recursive: true });
  vol.mkdirSync(`${homeDir}/.poe-code`, { recursive: true });
  return createFsFromVolume(vol).promises as unknown as FileSystem;
}

interface CommandCall {
  command: string;
  args: string[];
  options?: CommandRunnerOptions;
}

function createCommandRunnerStub(
  result: CommandRunnerResult = { stdout: "", stderr: "", exitCode: 0 }
): { runner: CommandRunner; calls: CommandCall[] } {
  const calls: CommandCall[] = [];
  const runner: CommandRunner = async (command, args, options) => {
    const call: CommandCall = { command, args };
    if (options) {
      call.options = options;
    }
    calls.push(call);
    return { ...result };
  };
  return { runner, calls };
}

function createContainerWithDependencies(
  overrides: Partial<CliDependencies> = {}
): {
  container: ReturnType<typeof createCliContainer>;
  logs: string[];
  commandCalls: CommandCall[];
} {
  const logs: string[] = [];
  const { runner, calls } = createCommandRunnerStub();
  const container = createCliContainer({
    fs: overrides.fs ?? createMemFs(),
    prompts: overrides.prompts ?? vi.fn().mockResolvedValue({}),
    env: overrides.env ?? { cwd, homeDir },
    commandRunner: overrides.commandRunner ?? runner,
    logger: overrides.logger ?? ((message) => {
      logs.push(message);
    })
  });
  return { container, logs, commandCalls: calls };
}

describe("spawnCore", () => {
  let fs: FileSystem;

  beforeEach(() => {
    fs = createMemFs();
    vi.clearAllMocks();
  });

  it("prefers explicit model over configured values", async () => {
    await fs.writeFile(
      resolveConfigPath(homeDir),
      `${JSON.stringify({ models: { default: "anthropic/claude-opus-4.6", opencode: "openai/gpt-5.4" } }, null, 2)}\n`,
      { encoding: "utf8" }
    );

    const { container } = createContainerWithDependencies({ fs });

    await expect(
      resolveConfiguredModel(container, "opencode", "google/gemini-3-pro")
    ).resolves.toBe("google/gemini-3-pro");
  });

  it("falls back to the global configured model when no agent override exists", async () => {
    await fs.writeFile(
      resolveConfigPath(homeDir),
      `${JSON.stringify({ models: { default: "anthropic/claude-opus-4.6" } }, null, 2)}\n`,
      { encoding: "utf8" }
    );

    const { container } = createContainerWithDependencies({ fs });

    await expect(resolveConfiguredModel(container, "opencode")).resolves.toBe(
      "anthropic/claude-opus-4.6"
    );
  });

  it("falls back to the provider default when config has no matching model", async () => {
    const { container } = createContainerWithDependencies({ fs });

    await expect(resolveConfiguredModel(container, "opencode")).resolves.toBe(
      DEFAULT_FRONTIER_MODEL
    );
  });

  async function ensureIsolatedConfig(service: string): Promise<void> {
    if (service === "codex") {
      await fs.mkdir(`${homeDir}/.poe-code/codex`, { recursive: true });
      await fs.writeFile(
        `${homeDir}/.poe-code/codex/config.toml`,
        "",
        { encoding: "utf8" }
      );
      return;
    }
    if (service === "opencode") {
      await fs.mkdir(`${homeDir}/.poe-code/opencode/.config/opencode`, {
        recursive: true
      });
      await fs.writeFile(
        `${homeDir}/.poe-code/opencode/.config/opencode/config.json`,
        "{}",
        { encoding: "utf8" }
      );
    }
  }

  it("throws error for unknown service", async () => {
    const { container } = createContainerWithDependencies({ fs });

    await expect(
      spawnCore(container, "unknown-service", { prompt: "test" })
    ).rejects.toThrow('Unknown service "unknown-service".');
  });

  it("returns SpawnResult with stdout, stderr, exitCode", async () => {
    const { runner } = createCommandRunnerStub({
      stdout: "output text",
      stderr: "error text",
      exitCode: 0
    });
    const { container } = createContainerWithDependencies({
      fs,
      commandRunner: runner
    });
    await ensureIsolatedConfig("opencode");

    const result = await spawnCore(container, "opencode", {
      prompt: "test prompt"
    });

    expect(result).toEqual({
      stdout: "output text",
      stderr: "error text",
      exitCode: 0
    });
  });

  it("uses the configured model when no explicit model is provided", async () => {
    const { runner, calls } = createCommandRunnerStub({
      stdout: "",
      stderr: "",
      exitCode: 0
    });
    await fs.writeFile(
      resolveConfigPath(homeDir),
      `${JSON.stringify({ models: { opencode: "openai/gpt-5.4" } }, null, 2)}\n`,
      { encoding: "utf8" }
    );

    const { container } = createContainerWithDependencies({
      fs,
      commandRunner: runner
    });
    await ensureIsolatedConfig("opencode");

    await spawnCore(container, "opencode", {
      prompt: "test prompt"
    });

    expect(calls.length).toBeGreaterThan(0);
    const lastCall = calls[calls.length - 1];
    expect(lastCall.args).toContain("poe/openai/gpt-5.4");
  });

  it("passes prompt and args to provider", async () => {
    const { runner, calls } = createCommandRunnerStub({
      stdout: "",
      stderr: "",
      exitCode: 0
    });
    const { container } = createContainerWithDependencies({
      fs,
      commandRunner: runner
    });
    await ensureIsolatedConfig("opencode");

    await spawnCore(container, "opencode", {
      prompt: "fix the bug",
      args: ["--extra", "arg"]
    });

    expect(calls.length).toBeGreaterThan(0);
    const lastCall = calls[calls.length - 1];
    expect(lastCall.args).toContain("fix the bug");
    expect(lastCall.args).toContain("--extra");
    expect(lastCall.args).toContain("arg");
  });

  it("handles dry run mode", async () => {
    const { container, logs } = createContainerWithDependencies({ fs });
    await ensureIsolatedConfig("opencode");

    const result = await spawnCore(
      container,
      "codex",
      { prompt: "test prompt" },
      { dryRun: true, verbose: false }
    );

    expect(result).toEqual({
      stdout: "",
      stderr: "",
      exitCode: 0
    });
    expect(logs.some((log) => log.includes("Dry run"))).toBe(true);
  });

  it("resolves relative cwd to absolute path", async () => {
    const { runner, calls } = createCommandRunnerStub({
      stdout: "",
      stderr: "",
      exitCode: 0
    });
    const { container } = createContainerWithDependencies({
      fs,
      commandRunner: runner
    });
    await ensureIsolatedConfig("opencode");

    await spawnCore(container, "opencode", {
      prompt: "test",
      cwd: "subdir"
    });

    expect(calls.length).toBeGreaterThan(0);
    const lastCall = calls[calls.length - 1];
    expect(lastCall.options?.cwd).toBe("/repo/subdir");
  });

  it("preserves absolute cwd path", async () => {
    const { runner, calls } = createCommandRunnerStub({
      stdout: "",
      stderr: "",
      exitCode: 0
    });
    const { container } = createContainerWithDependencies({
      fs,
      commandRunner: runner
    });
    await ensureIsolatedConfig("opencode");

    await spawnCore(container, "opencode", {
      prompt: "test",
      cwd: "/absolute/path"
    });

    expect(calls.length).toBeGreaterThan(0);
    const lastCall = calls[calls.length - 1];
    expect(lastCall.options?.cwd).toBe("/absolute/path");
  });

  it("returns empty result when provider returns void", async () => {
    // Create a mock provider that returns void
    const { container } = createContainerWithDependencies({ fs });
    
    // Mock the registry to return a provider that returns void
    const originalGet = container.registry.get.bind(container.registry);
    vi.spyOn(container.registry, "get").mockImplementation((name) => {
      const adapter = originalGet(name);
      if (adapter && name === "opencode") {
        return {
          ...adapter,
          spawn: async () => undefined
        };
      }
      return adapter;
    });
    await ensureIsolatedConfig("opencode");

    const result = await spawnCore(container, "opencode", {
      prompt: "test"
    });

    expect(result).toEqual({
      stdout: "",
      stderr: "",
      exitCode: 0
    });
  });
});
