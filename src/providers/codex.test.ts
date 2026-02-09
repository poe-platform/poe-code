import { describe, it, expect, beforeEach, vi } from "vitest";
import path from "node:path";
import type { FileSystem } from "../utils/file-system.js";
import * as codexService from "./codex.js";
import { createMockFs, parseToml, type MockFileSystem } from "@poe-code/config-mutations/testing";
import type { ProviderContext } from "../cli/service-registry.js";
import { createCliEnvironment } from "../cli/environment.js";
import { createTestCommandContext } from "../../tests/test-command-context.js";
import { DEFAULT_CODEX_MODEL, stripModelNamespace } from "../cli/constants.js";
import { createLoggerFactory } from "../cli/logger.js";

describe("codex service", () => {
  let fs: FileSystem;
  let mockFs: MockFileSystem;
  const home = "/home/user";
  const configDir = path.join(home, ".codex");
  const configPath = path.join(configDir, "config.toml");
  let env = createCliEnvironment({ cwd: home, homeDir: home });

  beforeEach(async () => {
    mockFs = createMockFs({}, home);
    fs = mockFs;
    env = createCliEnvironment({ cwd: home, homeDir: home });
  });

  function createProviderTestContext(
    runCommand: ReturnType<typeof vi.fn>,
    options: { dryRun?: boolean } = {}
  ): { context: ProviderContext; logs: string[] } {
    const logs: string[] = [];
    const logger = createLoggerFactory((message) => {
      logs.push(message);
    }).create({
      dryRun: options.dryRun ?? false,
      verbose: true,
      scope: "test:codex"
    });

    const context = {
      env,
      command: {
        runCommand,
        fs
      },
      logger,
      async runCheck(check) {
        await check.run({
          isDryRun: logger.context.dryRun,
          runCommand,
          logDryRun: (message) => logger.dryRun(message)
        });
      }
    } as ProviderContext;

    return { context, logs };
  }

  type ConfigureOptions = Parameters<
    typeof codexService.codexService.configure
  >[0]["options"];

  type UnconfigureOptions = Parameters<
    typeof codexService.codexService.unconfigure
  >[0]["options"];

  const buildConfigureOptions = (
    overrides: Partial<ConfigureOptions> = {}
  ): ConfigureOptions => ({
    env,
    apiKey: "sk-test",
    model: DEFAULT_CODEX_MODEL,
    reasoningEffort: "medium",
    ...overrides
  });

  const buildUnconfigureOptions = (
    overrides: Partial<UnconfigureOptions> = {}
  ): UnconfigureOptions => ({
    env,
    ...overrides
  });

  async function configureCodex(
    overrides: Partial<ConfigureOptions> = {}
  ): Promise<void> {
    await codexService.codexService.configure({
      fs,
      env,
      command: createTestCommandContext(fs),
      options: buildConfigureOptions(overrides)
    });
  }

  async function unconfigureCodex(
    overrides: Partial<UnconfigureOptions> = {}
  ): Promise<boolean> {
    return codexService.codexService.unconfigure({
      fs,
      env,
      command: createTestCommandContext(fs),
      options: buildUnconfigureOptions(overrides)
    });
  }

  it("writes codex config from template", async () => {
    await configureCodex({
      timestamp: () => "20240101T000000"
    });

    const content = await fs.readFile(configPath, "utf8");
    expect(content.trim()).toContain(
      `model = "${stripModelNamespace(DEFAULT_CODEX_MODEL)}"`
    );
    expect(content.trim()).toContain('model_reasoning_effort = "medium"');
    expect(content.trim()).toContain(
      'experimental_bearer_token = "sk-test"'
    );
    await expect(fs.readFile(path.join(configDir, "auth.json"), "utf8")).rejects
      .toThrow();

    await expect(
      fs.readFile(`${configPath}.backup.20240101T000000`, "utf8")
    ).rejects.toThrow();
  });

  it("uses POE_BASE_URL when writing base_url", async () => {
    env = createCliEnvironment({
      cwd: home,
      homeDir: home,
      variables: { POE_BASE_URL: "https://proxy.example.com/v1" }
    });

    await configureCodex();

    const doc = parseToml(await fs.readFile(configPath, "utf8"));
    const providers = doc["model_providers"] as Record<string, unknown>;
    const poe = providers["poe"] as Record<string, unknown>;
    expect(poe.base_url).toBe("https://proxy.example.com/v1");
  });

  it("removes generated config without restoring backup", async () => {
    await fs.mkdir(configDir, { recursive: true });
    await fs.writeFile(configPath, "original", { encoding: "utf8" });

    await configureCodex({
      timestamp: () => "20240101T000000"
    });

    await fs.writeFile(
      `${configPath}.backup.20240101T000000`,
      "legacy",
      { encoding: "utf8" }
    );
    const removed = await unconfigureCodex();
    expect(removed).toBe(true);

    await expect(fs.readFile(configPath, "utf8")).rejects.toThrow();
  });

  it("deletes config when content matches template", async () => {
    await configureCodex({
      timestamp: () => "20240101T000000"
    });

    const removed = await unconfigureCodex();
    expect(removed).toBe(true);

    await expect(fs.readFile(configPath, "utf8")).rejects.toThrow();
  });

  it("keeps config when file differs from template", async () => {
    await fs.mkdir(configDir, { recursive: true });
    await fs.writeFile(configPath, 'model = "custom"', {
      encoding: "utf8"
    });

    const removed = await unconfigureCodex();
    expect(removed).toBe(false);

    const content = await fs.readFile(configPath, "utf8");
    expect(content).toBe('model = "custom"');
  });

  it("removes codex block with different formatting", async () => {
    await fs.mkdir(configDir, { recursive: true });
    await fs.writeFile(
      configPath,
      [
        'model_provider="poe"',
        `model="${DEFAULT_CODEX_MODEL}"`,
        'model_reasoning_effort="medium"',
        "",
        "[model_providers.poe]",
        'name="poe"',
        'base_url="https://api.poe.com/v1"',
        'wire_api="chat"',
        'env_key="POE_API_KEY"',
        'experimental_bearer_token="POE_API_KEY"',
        "",
        "[features]",
        "foo = true",
        ""
      ].join("\n"),
      { encoding: "utf8" }
    );

    const removed = await unconfigureCodex();
    expect(removed).toBe(true);

    const content = await fs.readFile(configPath, "utf8");
    expect(content.trim()).toBe("[features]\nfoo = true");
  });

  it("removes legacy codex provider configuration", async () => {
    await fs.mkdir(configDir, { recursive: true });
    await fs.writeFile(
      configPath,
      [
        'model_provider="poe"',
        `model="${DEFAULT_CODEX_MODEL}"`,
        'model_reasoning_effort="medium"',
        "",
        "[model_providers.poe]",
        'name="poe"',
        'base_url="https://api.poe.com/v1"',
        'wire_api="chat"',
        'env_key="OPENAI_API_KEY"',
        "",
        "[features]",
        "foo = true",
        ""
      ].join("\n"),
      { encoding: "utf8" }
    );

    const removed = await unconfigureCodex();
    expect(removed).toBe(true);

    const content = await fs.readFile(configPath, "utf8");
    expect(content.trim()).toBe("[features]\nfoo = true");
  });

  it("removes codex configuration with wire_api responses format", async () => {
    await fs.mkdir(configDir, { recursive: true });
    await fs.writeFile(
      configPath,
      [
        'model_provider="poe"',
        `model="${DEFAULT_CODEX_MODEL}"`,
        'model_reasoning_effort="medium"',
        "",
        "[model_providers.poe]",
        'name="poe"',
        'base_url="https://api.poe.com/v1"',
        'wire_api="responses"',
        'experimental_bearer_token="test-key"',
        "",
        "[features]",
        "bar = true",
        ""
      ].join("\n"),
      { encoding: "utf8" }
    );

    const removed = await unconfigureCodex();
    expect(removed).toBe(true);

    const content = await fs.readFile(configPath, "utf8");
    expect(content.trim()).toBe("[features]\nbar = true");
  });

  it("creates timestamped backup when overwriting existing config", async () => {
    await fs.mkdir(configDir, { recursive: true });
    await fs.writeFile(configPath, "legacy-config", { encoding: "utf8" });

    await configureCodex();

    // Find backup file by pattern
    const files = mockFs.files;
    const backupFile = Object.keys(files).find((f) =>
      f.startsWith(`${configPath}.backup-`)
    );
    expect(backupFile).toBeDefined();
    const backupContent = await fs.readFile(backupFile!, "utf8");
    expect(backupContent).toBe("legacy-config");
    await expect(
      fs.readFile(path.join(configDir, "auth.json"), "utf8")
    ).rejects.toThrow();
  });

  it("merges codex configuration with existing content", async () => {
    await fs.mkdir(configDir, { recursive: true });
    await fs.writeFile(
      configPath,
      ['model_provider = "legacy"', "", "[features]", "foo = true", ""].join(
        "\n"
      ),
      { encoding: "utf8" }
    );

    await configureCodex();

    const doc = parseToml(await fs.readFile(configPath, "utf8"));
    expect(doc["model_provider"]).toBe("poe");
    expect(doc["model"]).toBe(stripModelNamespace(DEFAULT_CODEX_MODEL));
    expect(doc["model_reasoning_effort"]).toBe("medium");
    expect(doc["features"]).toEqual({ foo: true });

    const providers = doc["model_providers"] as Record<string, unknown>;
    expect(providers).toBeDefined();
    const poe = (providers ?? {})["poe"] as Record<string, unknown>;
    expect(poe).toMatchObject({
      name: "poe",
      base_url: "https://api.poe.com/v1",
      wire_api: "responses",
      experimental_bearer_token: "sk-test"
    });

    // Find backup file by pattern
    const files = mockFs.files;
    const backupFile = Object.keys(files).find((f) =>
      f.startsWith(`${configPath}.backup-`)
    );
    expect(backupFile).toBeDefined();
    const backupContent = await fs.readFile(backupFile!, "utf8");
    expect(backupContent.trim()).toContain('model_provider = "legacy"');
    expect(backupContent.trim()).toContain("[features]");
    await expect(
      fs.readFile(path.join(configDir, "auth.json"), "utf8")
    ).rejects.toThrow();
  });

  // IMPORTANT: The codex binary only accepts bare model IDs (e.g. "gpt-5.2-codex").
  // Namespaced models like "openai/gpt-5.2-codex" cause "model not found" errors.
  // The health check must pass stripModelNamespace(model) — do NOT change this.
  it("runs the Codex CLI health check when invoking the provider test", async () => {
    const runCommand = vi.fn(async () => ({
      stdout: "CODEX_OK\n",
      stderr: "",
      exitCode: 0
    }));
    const { context } = createProviderTestContext(runCommand);

    await codexService.codexService.test?.(context);

    expect(runCommand).toHaveBeenCalledWith("codex", [
      "exec",
      "Output exactly: CODEX_OK",
      "--model",
      stripModelNamespace(DEFAULT_CODEX_MODEL),
      "--skip-git-repo-check",
      "--json",
      "-s",
      "danger-full-access"
    ]);
  });

  it("skips the Codex health check during dry runs", async () => {
    const runCommand = vi.fn();
    const { context, logs } = createProviderTestContext(runCommand, {
      dryRun: true
    });

    await codexService.codexService.test?.(context);

    expect(runCommand).not.toHaveBeenCalled();
    expect(
      logs.find((line) =>
        line.includes(
          `codex exec "Output exactly: CODEX_OK" --model ${stripModelNamespace(DEFAULT_CODEX_MODEL)}`
        )
      )
    ).toBeTruthy();
  });

  it("accepts additional stdout lines as long as the expected marker is present", async () => {
    const runCommand = vi.fn(async () => ({
      stdout: [
        "[2025-11-29T15:05:32] OpenAI Codex v0.40.0 (research preview)",
        "--------",
        "CODEX_OK"
      ].join("\n"),
      stderr: "",
      exitCode: 0
    }));
    const { context } = createProviderTestContext(runCommand);

    await codexService.codexService.test?.(context);

    expect(runCommand).toHaveBeenCalledTimes(1);
  });

  it("includes stdout and stderr when the health check command fails", async () => {
    const runCommand = vi.fn(async () => ({
      stdout: "FAIL_STDOUT\n",
      stderr: "FAIL_STDERR\n",
      exitCode: 1
    }));
    const { context } = createProviderTestContext(runCommand);

    await expect(codexService.codexService.test?.(context)).rejects.toThrow(
      /FAIL_STDOUT/
    );
  });

  it("includes stdout and stderr when the health check output is unexpected", async () => {
    const runCommand = vi.fn(async () => ({
      stdout: "WRONG\n",
      stderr: "WARN\n",
      exitCode: 0
    }));
    const { context } = createProviderTestContext(runCommand);

    await expect(codexService.codexService.test?.(context)).rejects.toThrow(
      /expected "CODEX_OK" but received "WRONG"/i
    );
  });
});
