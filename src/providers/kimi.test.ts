import { describe, it, expect, beforeEach, vi } from "vitest";
import { Volume, createFsFromVolume } from "memfs";
import path from "node:path";
import type { FileSystem } from "../utils/file-system.js";
import {
  DEFAULT_KIMI_MODEL,
  KIMI_MODELS,
  PROVIDER_NAME,
  stripModelNamespace
} from "../cli/constants.js";
import * as kimiService from "./kimi.js";
import { createCliEnvironment } from "../cli/environment.js";
import { createTestCommandContext } from "../../tests/test-command-context.js";
import type { ProviderContext } from "../cli/service-registry.js";
import { createLoggerFactory } from "../cli/logger.js";
import { parseTomlDocument, serializeTomlDocument } from "../utils/toml.js";

function createMemFs(): { fs: FileSystem; vol: Volume } {
  const vol = new Volume();
  const fs = createFsFromVolume(vol);
  return { fs: fs.promises as unknown as FileSystem, vol };
}

const withProviderPrefix = (model: string): string =>
  `${PROVIDER_NAME}/${stripModelNamespace(model)}`;

const DEFAULT_PROVIDER_MODEL = withProviderPrefix(DEFAULT_KIMI_MODEL);

describe("kimi service", () => {
  let fs: FileSystem;
  let vol: Volume;
  const homeDir = "/home/user";
  const configPath = path.join(homeDir, ".kimi", "config.toml");
  let env = createCliEnvironment({ cwd: homeDir, homeDir });

  it("advertises kimi-cli as an alias", () => {
    expect(kimiService.kimiService.aliases).toContain("kimi-cli");
  });

  beforeEach(() => {
    ({ fs, vol } = createMemFs());
    vol.mkdirSync(homeDir, { recursive: true });
    env = createCliEnvironment({ cwd: homeDir, homeDir });
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
      scope: "test:kimi"
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
    typeof kimiService.kimiService.configure
  >[0]["options"];

  const buildConfigureOptions = (
    overrides: Partial<ConfigureOptions> = {}
  ): ConfigureOptions => ({
    env,
    apiKey: "sk-test",
    model: DEFAULT_KIMI_MODEL,
    ...overrides
  });

  type UnconfigureOptions = Parameters<
    typeof kimiService.kimiService.unconfigure
  >[0]["options"];

  const buildUnconfigureOptions = (
    overrides: Partial<UnconfigureOptions> = {}
  ): UnconfigureOptions => ({
    env,
    ...overrides
  });

  async function configureKimi(
    overrides: Partial<ConfigureOptions> = {}
  ): Promise<void> {
    await kimiService.kimiService.configure({
      fs,
      env,
      command: createTestCommandContext(fs),
      options: buildConfigureOptions(overrides)
    });
  }

  async function unconfigureKimi(
    overrides: Partial<UnconfigureOptions> = {}
  ): Promise<boolean> {
    return kimiService.kimiService.unconfigure({
      fs,
      env,
      command: createTestCommandContext(fs),
      options: buildUnconfigureOptions(overrides)
    });
  }

  it("creates the kimi config file with default model", async () => {
    await configureKimi();

    const config = parseTomlDocument(await fs.readFile(configPath, "utf8"));
    expect(config.default_model).toBe(DEFAULT_PROVIDER_MODEL);
    expect(config.providers).toMatchObject({
      [PROVIDER_NAME]: {
        type: "openai_legacy",
        base_url: "https://api.poe.com/v1",
        api_key: "sk-test"
      }
    });
    expect(config.models).toMatchObject({
      [DEFAULT_PROVIDER_MODEL]: {
        provider: PROVIDER_NAME,
        model: stripModelNamespace(DEFAULT_KIMI_MODEL),
        max_context_size: 256000
      }
    });
  });

  it("writes the selected kimi model to the config", async () => {
    const alternate = KIMI_MODELS[KIMI_MODELS.length - 1]!;
    await configureKimi({ model: alternate });

    const config = parseTomlDocument(await fs.readFile(configPath, "utf8"));
    expect(config.default_model).toBe(withProviderPrefix(alternate));
    const models = config.models as Record<string, unknown>;
    expect(models[withProviderPrefix(alternate)]).toEqual({
      provider: PROVIDER_NAME,
      model: stripModelNamespace(alternate),
      max_context_size: 256000
    });
  });

  it("merges with existing config and preserves other providers", async () => {
    await fs.mkdir(path.dirname(configPath), { recursive: true });
    await fs.writeFile(
      configPath,
      serializeTomlDocument({
        providers: {
          local: {
            type: "openai_legacy",
            base_url: "http://localhost:8080",
            api_key: "local-key"
          }
        },
        models: {
          "local/test-model": {
            provider: "local",
            model: "test-model",
            max_context_size: 4096
          }
        }
      })
    );

    await configureKimi();

    const config = parseTomlDocument(await fs.readFile(configPath, "utf8"));
    const providers = config.providers as Record<string, unknown>;
    const models = config.models as Record<string, unknown>;
    expect(providers.local).toEqual({
      type: "openai_legacy",
      base_url: "http://localhost:8080",
      api_key: "local-key"
    });
    expect(providers[PROVIDER_NAME]).toMatchObject({
      type: "openai_legacy",
      base_url: "https://api.poe.com/v1",
      api_key: "sk-test"
    });
    expect(models["local/test-model"]).toEqual({
      provider: "local",
      model: "test-model",
      max_context_size: 4096
    });
  });

  it("prunes stale poe models while preserving other provider models", async () => {
    await fs.mkdir(path.dirname(configPath), { recursive: true });
    await fs.writeFile(
      configPath,
      serializeTomlDocument({
        default_model: "poe/Old-Model",
        models: {
          "poe/Old-Model": {
            provider: "poe",
            model: "Old-Model",
            max_context_size: 128000
          },
          "local/test-model": {
            provider: "local",
            model: "test-model",
            max_context_size: 4096
          }
        },
        providers: {
          poe: {
            type: "openai_legacy",
            base_url: "https://api.poe.com/v1",
            api_key: "old-key"
          }
        }
      })
    );

    await configureKimi();

    const config = parseTomlDocument(await fs.readFile(configPath, "utf8"));
    const models = config.models as Record<string, unknown>;

    expect(models["poe/Old-Model"]).toBeUndefined();
    expect(models["local/test-model"]).toBeDefined();

    for (const m of KIMI_MODELS) {
      expect(models[withProviderPrefix(m)]).toBeDefined();
    }
  });

  it("replaces the Poe provider entry while keeping other providers", async () => {
    await fs.mkdir(path.dirname(configPath), { recursive: true });
    await fs.writeFile(
      configPath,
      serializeTomlDocument({
        providers: {
          poe: {
            type: "openai_legacy",
            base_url: "https://api.poe.com/v1",
            api_key: "old-key"
          },
          openai: {
            type: "openai_legacy",
            base_url: "https://api.openai.com/v1",
            api_key: "openai-key"
          }
        }
      })
    );

    await configureKimi();

    const config = parseTomlDocument(await fs.readFile(configPath, "utf8"));
    const providers = config.providers as Record<string, Record<string, unknown>>;
    expect(providers[PROVIDER_NAME].api_key).toBe("sk-test");
    expect(providers.openai).toEqual({
      type: "openai_legacy",
      base_url: "https://api.openai.com/v1",
      api_key: "openai-key"
    });
  });

  it("spawns the kimi CLI with the provided prompt and args", async () => {
    const runCommand = vi.fn(async () => ({
      stdout: "kimi-output\n",
      stderr: "",
      exitCode: 0
    }));
    const providerContext = {
      env: {} as any,
      command: {
        runCommand,
        fs
      },
      logger: {
        context: { dryRun: false, verbose: true }
      }
    } as unknown as import("../src/cli/service-registry.js").ProviderContext;

    const result = await kimiService.kimiService.spawn(providerContext, {
      prompt: "List all files",
      args: ["--format", "markdown"]
    });

    expect(runCommand).toHaveBeenCalledWith("kimi", [
      "--quiet",
      "-p",
      "List all files",
      "--format",
      "markdown"
    ]);
    expect(result).toEqual({
      stdout: "kimi-output\n",
      stderr: "",
      exitCode: 0
    });
  });

  it("runs the Kimi health check when test is invoked", async () => {
    const runCommand = vi.fn(async () => ({
      stdout: "KIMI_OK\n",
      stderr: "",
      exitCode: 0
    }));
    const { context } = createProviderTestContext(runCommand);

    await kimiService.kimiService.test?.(context);

    expect(runCommand).toHaveBeenCalledWith("kimi", [
      "--quiet",
      "-p",
      "Output exactly: KIMI_OK"
    ]);
  });

  it("skips the Kimi health check during dry runs", async () => {
    const runCommand = vi.fn();
    const { context, logs } = createProviderTestContext(runCommand, {
      dryRun: true
    });

    await kimiService.kimiService.test?.(context);

    expect(runCommand).not.toHaveBeenCalled();
    expect(
      logs.find((line) =>
        line.includes('kimi --quiet -p "Output exactly: KIMI_OK"')
      )
    ).toBeTruthy();
  });

  it("includes stdout and stderr when the Kimi health check command fails", async () => {
    const runCommand = vi.fn(async () => ({
      stdout: "KIMI_FAIL_STDOUT\n",
      stderr: "KIMI_FAIL_STDERR\n",
      exitCode: 1
    }));
    const { context } = createProviderTestContext(runCommand);

    await expect(
      kimiService.kimiService.test?.(context)
    ).rejects.toThrow(/KIMI_FAIL_STDOUT/);
  });

  it("includes stdout and stderr when the Kimi health check output is unexpected", async () => {
    const runCommand = vi.fn(async () => ({
      stdout: "MISCONFIG\n",
      stderr: "ALERT\n",
      exitCode: 0
    }));
    const { context } = createProviderTestContext(runCommand);

    await expect(
      kimiService.kimiService.test?.(context)
    ).rejects.toThrow(/expected "KIMI_OK" but received "MISCONFIG"/i);
  });

  it("removes the Poe provider from config on remove", async () => {
    await configureKimi();

    const before = parseTomlDocument(await fs.readFile(configPath, "utf8"));
    const beforeProviders = before.providers as Record<string, unknown>;
    expect(beforeProviders[PROVIDER_NAME]).toBeDefined();

    const removed = await unconfigureKimi();
    expect(removed).toBe(true);

    const after = parseTomlDocument(await fs.readFile(configPath, "utf8"));
    const afterProviders = after.providers as Record<string, unknown> | undefined;
    expect(afterProviders?.[PROVIDER_NAME]).toBeUndefined();
  });
});
