import { describe, it, expect, beforeEach } from "vitest";
import path from "node:path";
import type { FileSystem } from "../utils/file-system.js";
import {
  DEFAULT_FRONTIER_MODEL,
  FRONTIER_MODELS,
  PROVIDER_NAME,
  stripModelNamespace
} from "../cli/constants.js";
import * as openClawModule from "./openclaw.js";
import { createCliEnvironment } from "../cli/environment.js";
import { createTestCommandContext } from "../../tests/test-command-context.js";
import { createMockFs } from "@poe-code/config-mutations/testing";

const withProviderPrefix = (model: string): string =>
  `${PROVIDER_NAME}/${stripModelNamespace(model)}`;

describe("openclaw service", () => {
  let fs: FileSystem;
  const homeDir = "/home/user";
  const configPath = path.join(homeDir, ".openclaw", "openclaw.json");
  let env = createCliEnvironment({ cwd: homeDir, homeDir });

  beforeEach(() => {
    fs = createMockFs({}, homeDir);
    env = createCliEnvironment({ cwd: homeDir, homeDir });
  });

  type ConfigureOptions = Parameters<
    typeof openClawModule.openClawService.configure
  >[0]["options"];

  type UnconfigureOptions = Parameters<
    typeof openClawModule.openClawService.unconfigure
  >[0]["options"];

  const buildConfigureOptions = (
    overrides: Partial<ConfigureOptions> = {}
  ): ConfigureOptions => ({
    env,
    apiKey: "sk-test",
    model: DEFAULT_FRONTIER_MODEL,
    ...overrides
  });

  const buildUnconfigureOptions = (
    overrides: Partial<UnconfigureOptions> = {}
  ): UnconfigureOptions => ({
    env,
    ...overrides
  });

  async function configureOpenClaw(
    overrides: Partial<ConfigureOptions> = {}
  ): Promise<void> {
    await openClawModule.openClawService.configure({
      fs,
      env,
      command: createTestCommandContext(fs),
      options: buildConfigureOptions(overrides)
    });
  }

  async function unconfigureOpenClaw(
    overrides: Partial<UnconfigureOptions> = {}
  ): Promise<boolean> {
    return openClawModule.openClawService.unconfigure({
      fs,
      env,
      command: createTestCommandContext(fs),
      options: buildUnconfigureOptions(overrides)
    });
  }

  it("creates the openclaw config with poe provider", async () => {
    await configureOpenClaw();

    const config = JSON.parse(await fs.readFile(configPath, "utf8"));
    expect(config).toEqual({
      agents: {
        defaults: {
          model: {
            primary: withProviderPrefix(DEFAULT_FRONTIER_MODEL)
          }
        }
      },
      models: {
        providers: {
          [PROVIDER_NAME]: {
            baseUrl: env.poeApiBaseUrl,
            apiKey: "sk-test",
            api: "openai-completions",
            models: FRONTIER_MODELS.map((id) => ({ id: stripModelNamespace(id) }))
          }
        }
      }
    });
  });

  it("writes the selected model as the primary", async () => {
    const alternate = FRONTIER_MODELS[FRONTIER_MODELS.length - 1]!;
    await configureOpenClaw({ model: alternate });

    const config = JSON.parse(await fs.readFile(configPath, "utf8"));
    expect(config.agents.defaults.model.primary).toBe(withProviderPrefix(alternate));
  });

  it("merges with existing config and preserves other settings", async () => {
    await fs.mkdir(path.dirname(configPath), { recursive: true });
    await fs.writeFile(
      configPath,
      JSON.stringify({ theme: "dark", customSetting: true }, null, 2)
    );

    await configureOpenClaw();

    const config = JSON.parse(await fs.readFile(configPath, "utf8"));
    expect(config.theme).toBe("dark");
    expect(config.customSetting).toBe(true);
    expect(config.models.providers[PROVIDER_NAME]).toBeDefined();
  });

  it("replaces the poe provider entry while keeping other providers", async () => {
    await fs.mkdir(path.dirname(configPath), { recursive: true });
    await fs.writeFile(
      configPath,
      JSON.stringify(
        {
          models: {
            providers: {
              poe: {
                baseUrl: "https://api.poe.com/v1",
                apiKey: "old-key",
                api: "openai-completions",
                models: []
              },
              openai: {
                baseUrl: "https://api.openai.com/v1",
                apiKey: "openai-key",
                api: "openai-completions",
                models: []
              }
            }
          }
        },
        null,
        2
      )
    );

    await configureOpenClaw();

    const config = JSON.parse(await fs.readFile(configPath, "utf8"));
    expect(config.models.providers[PROVIDER_NAME].apiKey).toBe("sk-test");
    expect(config.models.providers.openai).toEqual({
      baseUrl: "https://api.openai.com/v1",
      apiKey: "openai-key",
      api: "openai-completions",
      models: []
    });
  });

  it("removes the poe provider and model on unconfigure", async () => {
    await configureOpenClaw();

    const removed = await unconfigureOpenClaw();
    expect(removed).toBe(true);

    await expect(fs.readFile(configPath, "utf8")).rejects.toThrow();
  });

  it("preserves other providers when unconfiguring", async () => {
    await fs.mkdir(path.dirname(configPath), { recursive: true });
    await fs.writeFile(
      configPath,
      JSON.stringify(
        {
          agents: {
            defaults: {
              model: { primary: "poe/claude-sonnet-4.6" }
            }
          },
          models: {
            providers: {
              poe: {
                baseUrl: "https://api.poe.com/v1",
                apiKey: "sk-test",
                api: "openai-completions",
                models: []
              },
              openai: {
                baseUrl: "https://api.openai.com/v1",
                apiKey: "openai-key",
                api: "openai-completions",
                models: []
              }
            }
          }
        },
        null,
        2
      )
    );

    await unconfigureOpenClaw();

    const config = JSON.parse(await fs.readFile(configPath, "utf8"));
    expect(config.models?.providers?.poe).toBeUndefined();
    expect(config.models.providers.openai).toBeDefined();
  });

  it("returns false when config file is absent on unconfigure", async () => {
    const removed = await unconfigureOpenClaw();
    expect(removed).toBe(false);
  });

  it("creates ~/.openclaw directory when configuring", async () => {
    await configureOpenClaw();
    await fs.stat(path.join(homeDir, ".openclaw"));
  });
});
