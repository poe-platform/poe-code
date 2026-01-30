import { describe, it, expect, beforeEach, vi } from "vitest";
import { Volume, createFsFromVolume } from "memfs";
import path from "node:path";
import type { FileSystem } from "../src/utils/file-system.js";
import {
  DEFAULT_FRONTIER_MODEL,
  FRONTIER_MODELS,
  PROVIDER_NAME
} from "../src/cli/constants.js";
import * as opencodeService from "../src/providers/opencode.js";
import { createCliEnvironment } from "../src/cli/environment.js";
import { createTestCommandContext } from "./test-command-context.js";
import type { ProviderContext } from "../src/cli/service-registry.js";
import { createLoggerFactory } from "../src/cli/logger.js";

function createMemFs(): { fs: FileSystem; vol: Volume } {
  const vol = new Volume();
  const fs = createFsFromVolume(vol);
  return { fs: fs.promises as unknown as FileSystem, vol };
}

const withProviderPrefix = (model: string): string =>
  `${PROVIDER_NAME}/${model}`;

const DEFAULT_PROVIDER_MODEL = withProviderPrefix(DEFAULT_FRONTIER_MODEL);

describe("opencode service", () => {
  let fs: FileSystem;
  let vol: Volume;
  const homeDir = "/home/user";
  const configPath = path.join(homeDir, ".config", "opencode", "config.json");
  const authPath = path.join(homeDir, ".opencode-data", "auth.json");
  let env = createCliEnvironment({ cwd: homeDir, homeDir });

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
      scope: "test:opencode"
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
    typeof opencodeService.openCodeService.configure
  >[0]["options"];

  const buildConfigureOptions = (
    overrides: Partial<ConfigureOptions> = {}
  ): ConfigureOptions => ({
    env,
    apiKey: "sk-test",
    model: DEFAULT_FRONTIER_MODEL,
    ...overrides
  });

  async function configureOpenCode(
    overrides: Partial<ConfigureOptions> = {}
  ): Promise<void> {
    await opencodeService.openCodeService.configure({
      fs,
      env,
      command: createTestCommandContext(fs),
      options: buildConfigureOptions(overrides)
    });
  }

  it("creates the opencode config and auth files", async () => {
    await configureOpenCode();

    const config = JSON.parse(await fs.readFile(configPath, "utf8"));
    expect(config).toEqual({
      $schema: "https://opencode.ai/config.json",
      model: DEFAULT_PROVIDER_MODEL,
      enabled_providers: [PROVIDER_NAME]
    });

    const auth = JSON.parse(await fs.readFile(authPath, "utf8"));
    expect(auth).toEqual({
      [PROVIDER_NAME]: {
        type: "api",
        key: "sk-test"
      }
    });
  });

  it("writes the selected frontier model to the config", async () => {
    const alternate = FRONTIER_MODELS[FRONTIER_MODELS.length - 1]!;
    await configureOpenCode({ model: alternate });

    const config = JSON.parse(await fs.readFile(configPath, "utf8"));
    expect(config.model).toBe(withProviderPrefix(alternate));
  });

  it("merges with existing config and preserves other settings", async () => {
    await fs.mkdir(path.dirname(configPath), { recursive: true });
    await fs.writeFile(
      configPath,
      JSON.stringify(
        {
          theme: "dark",
          customSetting: true
        },
        null,
        2
      )
    );

    await configureOpenCode();

    const config = JSON.parse(await fs.readFile(configPath, "utf8"));
    expect(config.theme).toBe("dark");
    expect(config.customSetting).toBe(true);
    expect(config.enabled_providers).toEqual([PROVIDER_NAME]);
    expect(config.$schema).toBe("https://opencode.ai/config.json");
  });

  it("replaces the Poe auth entry while keeping other providers", async () => {
    await fs.mkdir(path.dirname(authPath), { recursive: true });
    await fs.writeFile(
      authPath,
      JSON.stringify(
        {
          poe: {
            type: "legacy",
            key: "old-key"
          },
          openai: {
            type: "api",
            key: "openai-key"
          }
        },
        null,
        2
      )
    );

    await configureOpenCode();

    const auth = JSON.parse(await fs.readFile(authPath, "utf8"));
    expect(auth).toEqual({
      [PROVIDER_NAME]: {
        type: "api",
        key: "sk-test"
      },
      openai: {
        type: "api",
        key: "openai-key"
      }
    });
  });

  it("spawns the opencode CLI with the provided prompt and args", async () => {
    const runCommand = vi.fn(async () => ({
      stdout: "opencode-output\n",
      stderr: "",
      exitCode: 0
    }));
    const providerContext = createProviderTestContext(runCommand).context;

    const result = await opencodeService.openCodeService.spawn(providerContext, {
      prompt: "List all files",
      args: ["--format", "markdown"]
    });

    expect(runCommand).toHaveBeenCalledWith("poe-code", [
      "wrap",
      "opencode",
      "--model",
      DEFAULT_PROVIDER_MODEL,
      "run",
      "List all files",
      "--format",
      "markdown"
    ]);
    expect(result).toEqual({
      stdout: "opencode-output\n",
      stderr: "",
      exitCode: 0
    });
  });

  it("spawns the opencode CLI with a custom model", async () => {
    const runCommand = vi.fn(async () => ({
      stdout: "opencode-output\n",
      stderr: "",
      exitCode: 0
    }));
    const customModel = FRONTIER_MODELS[FRONTIER_MODELS.length - 1]!;
    const providerContext = createProviderTestContext(runCommand).context;

    await opencodeService.openCodeService.spawn(providerContext, {
      prompt: "List all files",
      model: customModel
    });

    expect(runCommand).toHaveBeenCalledWith("poe-code", [
      "wrap",
      "opencode",
      "--model",
      withProviderPrefix(customModel),
      "run",
      "List all files"
    ]);
  });

  it("avoids duplicating the provider prefix for prefixed models", async () => {
    const runCommand = vi.fn(async () => ({
      stdout: "opencode-output\n",
      stderr: "",
      exitCode: 0
    }));
    const prefixed = withProviderPrefix("Custom-Model");
    const providerContext = createProviderTestContext(runCommand).context;

    await opencodeService.openCodeService.spawn(providerContext, {
      prompt: "Describe the change",
      model: prefixed
    });

    expect(runCommand).toHaveBeenCalledWith("poe-code", [
      "wrap",
      "opencode",
      "--model",
      prefixed,
      "run",
      "Describe the change"
    ]);
  });

  it("runs the OpenCode health check when test is invoked", async () => {
    const runCommand = vi.fn(async () => ({
      stdout: "OPEN_CODE_OK\n",
      stderr: "",
      exitCode: 0
    }));
    const { context } = createProviderTestContext(runCommand);

    await opencodeService.openCodeService.test?.(context);

    expect(runCommand).toHaveBeenCalledWith("opencode", [
      "--model",
      DEFAULT_PROVIDER_MODEL,
      "run",
      "Output exactly: OPEN_CODE_OK"
    ]);
  });

  it("skips the OpenCode health check during dry runs", async () => {
    const runCommand = vi.fn();
    const { context, logs } = createProviderTestContext(runCommand, {
      dryRun: true
    });

    await opencodeService.openCodeService.test?.(context);

    expect(runCommand).not.toHaveBeenCalled();
    expect(
      logs.find((line) =>
        line.includes(
          `opencode --model ${DEFAULT_PROVIDER_MODEL} run "Output exactly: OPEN_CODE_OK"`
        )
      )
    ).toBeTruthy();
  });

  it("includes stdout and stderr when the OpenCode health check command fails", async () => {
    const runCommand = vi.fn(async () => ({
      stdout: "OPEN_FAIL_STDOUT\n",
      stderr: "OPEN_FAIL_STDERR\n",
      exitCode: 1
    }));
    const { context } = createProviderTestContext(runCommand);

    await expect(
      opencodeService.openCodeService.test?.(context)
    ).rejects.toThrow(/OPEN_FAIL_STDOUT/);
  });

  it("includes stdout and stderr when the OpenCode health check output is unexpected", async () => {
    const runCommand = vi.fn(async () => ({
      stdout: "MISCONFIG\n",
      stderr: "ALERT\n",
      exitCode: 0
    }));
    const { context } = createProviderTestContext(runCommand);

    await expect(
      opencodeService.openCodeService.test?.(context)
    ).rejects.toThrow(/expected "OPEN_CODE_OK" but received "MISCONFIG"/i);
  });
});
