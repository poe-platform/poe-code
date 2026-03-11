import { describe, it, expect, beforeEach, vi } from "vitest";
import { createMockFs } from "@poe-code/config-mutations/testing";
import { createCliContainer } from "../cli/container.js";
import {
  buildProviderContext,
  createExecutionResources
} from "../cli/commands/shared.js";
import { provider as openClawProvider } from "./openclaw.js";

const cwd = "/repo";
const homeDir = "/home/test";

function createModelEntry(overrides: Partial<{
  id: string;
  owned_by: string;
  created: number;
  input_modalities: string[];
  output_modalities: string[];
  pricing: {
    prompt: number | null;
    completion: number | null;
    input_cache_read: number | null;
    input_cache_write: number | null;
  } | null;
  context_length: number | null;
  max_output_tokens: number | null;
}> = {}) {
  return {
    id: overrides.id ?? "claude-sonnet-4.6",
    object: "model",
    created: overrides.created ?? 1700000000000,
    owned_by: overrides.owned_by ?? "Anthropic",
    architecture: {
      input_modalities: overrides.input_modalities ?? ["text"],
      output_modalities: overrides.output_modalities ?? ["text"],
      modality: "text->text"
    },
    metadata: {
      display_name: overrides.id ?? "claude-sonnet-4.6"
    },
    pricing: overrides.pricing ?? {
      prompt: 0.000001,
      completion: 0.000002,
      input_cache_read: 0.0000001,
      input_cache_write: 0.0000002
    },
    context_window: {
      context_length: overrides.context_length ?? 200000,
      max_output_tokens: overrides.max_output_tokens ?? 8192
    },
    reasoning: null,
    supported_features: [],
    parameters: []
  };
}

function createCommandContext(
  fs: ReturnType<typeof createMockFs>,
  commandRunner: ReturnType<typeof vi.fn>
) {
  return {
    fs,
    runCommand: commandRunner,
    runCommandWithEnv: commandRunner,
    flushDryRun() {},
    complete() {},
    finalize() {}
  };
}

describe("openclaw provider", () => {
  const fs = createMockFs({}, homeDir);
  let commandRunner: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    commandRunner = vi.fn(async (command: string, args: string[]) => {
      if (command === "openclaw" && args[0] === "config" && args[1] === "file") {
        return {
          stdout: `${homeDir}/.openclaw/openclaw.json\n`,
          stderr: "",
          exitCode: 0
        };
      }
      if (
        command === "openclaw" &&
        args[0] === "config" &&
        args[1] === "validate" &&
        args.includes("--json")
      ) {
        return {
          stdout: JSON.stringify({
            valid: true,
            path: `${homeDir}/.openclaw/openclaw.json`
          }),
          stderr: "",
          exitCode: 0
        };
      }
      return { stdout: "", stderr: "", exitCode: 0 };
    });
  });

  it("builds configure payload from live Poe models", async () => {
    const container = createCliContainer({
      fs,
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir },
      commandRunner,
      httpClient: vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({
          object: "list",
          data: [
            createModelEntry({ id: "claude-sonnet-4.6", owned_by: "Anthropic" }),
            createModelEntry({ id: "gpt-5.2", owned_by: "OpenAI", created: 1800000000000 })
          ]
        })
      }))
    });
    vi.spyOn(container.options, "resolveApiKey").mockResolvedValue("sk-openclaw");
    const resolveModel = vi
      .spyOn(container.options, "resolveModel")
      .mockResolvedValue("claude-sonnet-4.6");
    const resources = createExecutionResources(
      container,
      { dryRun: false, assumeYes: false, verbose: false },
      "configure:openclaw"
    );
    const context = buildProviderContext(
      container,
      openClawProvider,
      resources
    );

    const payload = await (openClawProvider as any).buildConfigurePayload({
      container,
      flags: { dryRun: false, assumeYes: false, verbose: false },
      options: {},
      context,
      logger: resources.logger
    });

    expect(resolveModel).toHaveBeenCalledWith(
      expect.objectContaining({
        defaultValue: "claude-sonnet-4.6",
        choices: [
          { title: "Claude Sonnet 4.6", value: "claude-sonnet-4.6" },
          { title: "GPT-5.2", value: "gpt-5.2" }
        ]
      })
    );
    expect(payload).toEqual(
      expect.objectContaining({
        options: expect.objectContaining({
          apiKey: "sk-openclaw",
          model: "claude-sonnet-4.6",
          configPath: `${homeDir}/.openclaw/openclaw.json`
        }),
        files: [`${homeDir}/.openclaw/openclaw.json`]
      })
    );
  });

  it("normalizes tilde OpenClaw config paths in the configure payload", async () => {
    commandRunner = vi.fn(async (command: string, args: string[]) => {
      if (command === "openclaw" && args[0] === "config" && args[1] === "file") {
        return {
          stdout: "~/.openclaw/openclaw.json\n",
          stderr: "",
          exitCode: 0
        };
      }
      if (
        command === "openclaw" &&
        args[0] === "config" &&
        args[1] === "validate" &&
        args.includes("--json")
      ) {
        return {
          stdout: JSON.stringify({
            valid: true,
            path: `${homeDir}/.openclaw/openclaw.json`
          }),
          stderr: "",
          exitCode: 0
        };
      }
      return { stdout: "", stderr: "", exitCode: 0 };
    });
    const container = createCliContainer({
      fs,
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir },
      commandRunner,
      httpClient: vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({
          object: "list",
          data: [
            createModelEntry({ id: "claude-sonnet-4.6", owned_by: "Anthropic" })
          ]
        })
      }))
    });
    vi.spyOn(container.options, "resolveApiKey").mockResolvedValue("sk-openclaw");
    vi.spyOn(container.options, "resolveModel").mockResolvedValue(
      "claude-sonnet-4.6"
    );
    const resources = createExecutionResources(
      container,
      { dryRun: false, assumeYes: false, verbose: false },
      "configure:openclaw"
    );
    const context = buildProviderContext(
      container,
      openClawProvider,
      resources
    );

    const payload = await (openClawProvider as any).buildConfigurePayload({
      container,
      flags: { dryRun: false, assumeYes: false, verbose: false },
      options: {},
      context,
      logger: resources.logger
    });

    expect(payload.options.configPath).toBe(
      `${homeDir}/.openclaw/openclaw.json`
    );
    expect(payload.files).toEqual([`${homeDir}/.openclaw/openclaw.json`]);
  });

  it("fails with onboarding guidance when the OpenClaw config is invalid", async () => {
    commandRunner = vi.fn(async (command: string, args: string[]) => {
      if (command === "openclaw" && args[0] === "config" && args[1] === "file") {
        return {
          stdout: `${homeDir}/.openclaw/openclaw.json\n`,
          stderr: "",
          exitCode: 0
        };
      }
      if (
        command === "openclaw" &&
        args[0] === "config" &&
        args[1] === "validate" &&
        args.includes("--json")
      ) {
        return {
          stdout: JSON.stringify({
            valid: false,
            path: `${homeDir}/.openclaw/openclaw.json`
          }),
          stderr: "",
          exitCode: 0
        };
      }
      return { stdout: "", stderr: "", exitCode: 0 };
    });

    const container = createCliContainer({
      fs,
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir },
      commandRunner,
      httpClient: vi.fn()
    });
    const resources = createExecutionResources(
      container,
      { dryRun: false, assumeYes: false, verbose: false },
      "configure:openclaw"
    );
    const context = buildProviderContext(
      container,
      openClawProvider,
      resources
    );

    await expect(
      (openClawProvider as any).buildConfigurePayload({
        container,
        flags: { dryRun: false, assumeYes: false, verbose: false },
        options: {},
        context,
        logger: resources.logger
      })
    ).rejects.toThrow(
      "Run `openclaw onboard` or `openclaw doctor`."
    );
  });

  it("fails when the openclaw binary is not installed", async () => {
    commandRunner = vi.fn(async () => ({
      stdout: "",
      stderr: "",
      exitCode: 1
    }));
    const container = createCliContainer({
      fs,
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir },
      commandRunner,
      httpClient: vi.fn()
    });
    const resources = createExecutionResources(
      container,
      { dryRun: false, assumeYes: false, verbose: false },
      "configure:openclaw"
    );
    const context = buildProviderContext(
      container,
      openClawProvider,
      resources
    );

    await expect(
      (openClawProvider as any).buildConfigurePayload({
        container,
        flags: { dryRun: false, assumeYes: false, verbose: false },
        options: {},
        context,
        logger: resources.logger
      })
    ).rejects.toThrow("openclaw CLI binary not found on PATH.");
  });

  it("rejects explicit models that are not live Poe model ids", async () => {
    const container = createCliContainer({
      fs,
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir },
      commandRunner,
      httpClient: vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({
          object: "list",
          data: [
            createModelEntry({ id: "claude-sonnet-4.6", owned_by: "Anthropic" })
          ]
        })
      }))
    });
    vi.spyOn(container.options, "resolveApiKey").mockResolvedValue("sk-openclaw");
    const resolveModel = vi.spyOn(container.options, "resolveModel");
    const resources = createExecutionResources(
      container,
      { dryRun: false, assumeYes: false, verbose: false },
      "configure:openclaw"
    );
    const context = buildProviderContext(
      container,
      openClawProvider,
      resources
    );

    await expect(
      (openClawProvider as any).buildConfigurePayload({
        container,
        flags: { dryRun: false, assumeYes: false, verbose: false },
        options: { model: "missing-model" },
        context,
        logger: resources.logger
      })
    ).rejects.toThrow(
      'Unknown Poe model "missing-model" for OpenClaw.'
    );
    expect(resolveModel).not.toHaveBeenCalled();
  });

  it.each([
    [
      "omits the valid flag",
      {
        path: `${homeDir}/.openclaw/openclaw.json`
      }
    ],
    [
      "returns a malformed valid flag",
      {
        valid: "yes",
        path: `${homeDir}/.openclaw/openclaw.json`
      }
    ]
  ])("fails closed when OpenClaw validation JSON %s", async (_label, payload) => {
    commandRunner = vi.fn(async (command: string, args: string[]) => {
      if (command === "openclaw" && args[0] === "config" && args[1] === "file") {
        return {
          stdout: `${homeDir}/.openclaw/openclaw.json\n`,
          stderr: "",
          exitCode: 0
        };
      }
      if (
        command === "openclaw" &&
        args[0] === "config" &&
        args[1] === "validate" &&
        args.includes("--json")
      ) {
        return {
          stdout: JSON.stringify(payload),
          stderr: "",
          exitCode: 0
        };
      }
      return { stdout: "", stderr: "", exitCode: 0 };
    });
    const container = createCliContainer({
      fs,
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir },
      commandRunner,
      httpClient: vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({
          object: "list",
          data: [
            createModelEntry({ id: "claude-sonnet-4.6", owned_by: "Anthropic" })
          ]
        })
      }))
    });
    vi.spyOn(container.options, "resolveApiKey").mockResolvedValue("sk-openclaw");
    vi.spyOn(container.options, "resolveModel").mockResolvedValue(
      "claude-sonnet-4.6"
    );
    const resources = createExecutionResources(
      container,
      { dryRun: false, assumeYes: false, verbose: false },
      "configure:openclaw"
    );
    const context = buildProviderContext(
      container,
      openClawProvider,
      resources
    );

    await expect(
      (openClawProvider as any).buildConfigurePayload({
        container,
        flags: { dryRun: false, assumeYes: false, verbose: false },
        options: {},
        context,
        logger: resources.logger
      })
    ).rejects.toThrow(
      `OpenClaw configuration is not valid at ${homeDir}/.openclaw/openclaw.json.`
    );
  });

  it("skips text-output models that do not accept text or image input", async () => {
    const container = createCliContainer({
      fs,
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir },
      commandRunner,
      httpClient: vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({
          object: "list",
          data: [
            createModelEntry({
              id: "audio-transcriber",
              owned_by: "OpenAI",
              input_modalities: ["audio"],
              output_modalities: ["text"]
            }),
            createModelEntry({
              id: "claude-sonnet-4.6",
              owned_by: "Anthropic",
              input_modalities: ["text"],
              output_modalities: ["text"]
            })
          ]
        })
      }))
    });
    vi.spyOn(container.options, "resolveApiKey").mockResolvedValue("sk-openclaw");
    const resolveModel = vi
      .spyOn(container.options, "resolveModel")
      .mockResolvedValue("claude-sonnet-4.6");
    const resources = createExecutionResources(
      container,
      { dryRun: false, assumeYes: false, verbose: false },
      "configure:openclaw"
    );
    const context = buildProviderContext(
      container,
      openClawProvider,
      resources
    );

    const payload = await (openClawProvider as any).buildConfigurePayload({
      container,
      flags: { dryRun: false, assumeYes: false, verbose: false },
      options: {},
      context,
      logger: resources.logger
    });

    expect(resolveModel).toHaveBeenCalledWith(
      expect.objectContaining({
        choices: [{ title: "Claude Sonnet 4.6", value: "claude-sonnet-4.6" }]
      })
    );
    expect(payload.options.providerConfig.models).toEqual([
      expect.objectContaining({
        id: "claude-sonnet-4.6",
        input: ["text"]
      })
    ]);
  });

  it("configures OpenClaw through its CLI", async () => {
    await openClawProvider.configure({
      fs,
      env: containerEnv(),
      command: createCommandContext(fs, commandRunner),
      options: {
        dryRun: false,
        model: "claude-sonnet-4.6",
        providerConfig: {
          baseUrl: "https://api.poe.com/v1",
          apiKey: "sk-openclaw",
          api: "openai-completions",
          models: [
            {
              id: "claude-sonnet-4.6",
              name: "Claude Sonnet 4.6",
              reasoning: false,
              input: ["text"],
              cost: {
                input: 0.000001,
                output: 0.000002,
                cacheRead: 0.0000001,
                cacheWrite: 0.0000002
              },
              contextWindow: 200000,
              maxTokens: 8192
            }
          ]
        }
      }
    });

    expect(commandRunner).toHaveBeenNthCalledWith(
      1,
      "openclaw",
      [
        "config",
        "set",
        "models.providers.poe",
        expect.any(String),
        "--strict-json"
      ]
    );
    const configValue = commandRunner.mock.calls[0]?.[1]?.[3];
    expect(JSON.parse(configValue)).toEqual({
      baseUrl: "https://api.poe.com/v1",
      apiKey: "sk-openclaw",
      api: "openai-completions",
      models: [
        {
          id: "claude-sonnet-4.6",
          name: "Claude Sonnet 4.6",
          reasoning: false,
          input: ["text"],
          cost: {
            input: 0.000001,
            output: 0.000002,
            cacheRead: 0.0000001,
            cacheWrite: 0.0000002
          },
          contextWindow: 200000,
          maxTokens: 8192
        }
      ]
    });
    expect(commandRunner).toHaveBeenNthCalledWith(2, "openclaw", [
      "models",
      "set",
      "poe/claude-sonnet-4.6"
    ]);
    expect(commandRunner).toHaveBeenNthCalledWith(3, "openclaw", [
      "config",
      "validate",
      "--json"
    ]);
  });

  it("fails configure when OpenClaw validation returns valid false after writes", async () => {
    commandRunner = vi.fn(async (command: string, args: string[]) => {
      if (
        command === "openclaw" &&
        args[0] === "config" &&
        args[1] === "validate" &&
        args.includes("--json")
      ) {
        return {
          stdout: JSON.stringify({
            valid: false,
            path: `${homeDir}/.openclaw/openclaw.json`
          }),
          stderr: "",
          exitCode: 0
        };
      }
      return { stdout: "", stderr: "", exitCode: 0 };
    });

    await expect(
      openClawProvider.configure({
        fs,
        env: containerEnv(),
        command: createCommandContext(fs, commandRunner),
        options: {
          dryRun: false,
          model: "claude-sonnet-4.6",
          providerConfig: {
            baseUrl: "https://api.poe.com/v1",
            apiKey: "sk-openclaw",
            api: "openai-completions",
            models: []
          },
          configPath: `${homeDir}/.openclaw/openclaw.json`,
          apiKey: "sk-openclaw"
        }
      })
    ).rejects.toThrow("OpenClaw configuration became invalid.");
  });

  it("skips OpenClaw CLI mutations during configure dry run", async () => {
    await openClawProvider.configure({
      fs,
      env: containerEnv(),
      command: {
        fs,
        runCommand: commandRunner,
        runCommandWithEnv: commandRunner,
        flushDryRun() {},
        complete() {},
        finalize() {}
      },
      options: {
        dryRun: true,
        model: "claude-sonnet-4.6",
        providerConfig: {
          baseUrl: "https://api.poe.com/v1",
          apiKey: "sk-openclaw",
          api: "openai-completions",
          models: []
        },
        configPath: `${homeDir}/.openclaw/openclaw.json`,
        apiKey: "sk-openclaw"
      }
    });

    expect(commandRunner).not.toHaveBeenCalled();
  });

  it("unconfigures the Poe provider and only clears Poe primary models", async () => {
    commandRunner = vi.fn(async (command: string, args: string[]) => {
      if (command !== "openclaw") {
        return { stdout: "", stderr: "", exitCode: 0 };
      }
      if (args[0] === "config" && args[1] === "file") {
        return {
          stdout: `${homeDir}/.openclaw/openclaw.json\n`,
          stderr: "",
          exitCode: 0
        };
      }
      if (
        args[0] === "config" &&
        args[1] === "get" &&
        args[2] === "models.providers.poe"
      ) {
        return {
          stdout: JSON.stringify({ apiKey: "sk-openclaw" }),
          stderr: "",
          exitCode: 0
        };
      }
      if (
        args[0] === "config" &&
        args[1] === "get" &&
        args[2] === "agents.defaults.model.primary"
      ) {
        return {
          stdout: JSON.stringify("poe/claude-sonnet-4.6"),
          stderr: "",
          exitCode: 0
        };
      }
      if (
        args[0] === "config" &&
        args[1] === "validate" &&
        args.includes("--json")
      ) {
        return {
          stdout: JSON.stringify({
            valid: true,
            path: `${homeDir}/.openclaw/openclaw.json`
          }),
          stderr: "",
          exitCode: 0
        };
      }
      return { stdout: "", stderr: "", exitCode: 0 };
    });

    const changed = await openClawProvider.unconfigure({
      fs,
      env: containerEnv(),
      command: createCommandContext(fs, commandRunner),
      options: {
        dryRun: false
      }
    });

    expect(changed).toBe(true);
    expect(commandRunner).toHaveBeenNthCalledWith(1, "openclaw", [
      "config",
      "file"
    ]);
    expect(commandRunner).toHaveBeenNthCalledWith(2, "openclaw", [
      "config",
      "validate",
      "--json"
    ]);
    expect(commandRunner).toHaveBeenNthCalledWith(3, "openclaw", [
      "config",
      "get",
      "models.providers.poe",
      "--json"
    ]);
    expect(commandRunner).toHaveBeenNthCalledWith(4, "openclaw", [
      "config",
      "get",
      "agents.defaults.model.primary",
      "--json"
    ]);
    expect(commandRunner).toHaveBeenNthCalledWith(5, "openclaw", [
      "config",
      "unset",
      "models.providers.poe"
    ]);
    expect(commandRunner).toHaveBeenNthCalledWith(6, "openclaw", [
      "config",
      "unset",
      "agents.defaults.model.primary"
    ]);
    expect(commandRunner).toHaveBeenNthCalledWith(7, "openclaw", [
      "config",
      "validate",
      "--json"
    ]);
  });

  it("fails unconfigure when OpenClaw cannot read the Poe provider path", async () => {
    commandRunner = vi.fn(async (command: string, args: string[]) => {
      if (command !== "openclaw") {
        return { stdout: "", stderr: "", exitCode: 0 };
      }
      if (args[0] === "config" && args[1] === "file") {
        return {
          stdout: `${homeDir}/.openclaw/openclaw.json\n`,
          stderr: "",
          exitCode: 0
        };
      }
      if (
        args[0] === "config" &&
        args[1] === "validate" &&
        args.includes("--json")
      ) {
        return {
          stdout: JSON.stringify({
            valid: true,
            path: `${homeDir}/.openclaw/openclaw.json`
          }),
          stderr: "",
          exitCode: 0
        };
      }
      if (
        args[0] === "config" &&
        args[1] === "get" &&
        args[2] === "models.providers.poe"
      ) {
        return {
          stdout: "",
          stderr: "permission denied",
          exitCode: 2
        };
      }
      return { stdout: "", stderr: "", exitCode: 0 };
    });

    await expect(
      openClawProvider.unconfigure({
        fs,
        env: containerEnv(),
        command: createCommandContext(fs, commandRunner),
        options: {
          dryRun: false
        }
      })
    ).rejects.toThrow(
      "Failed to read OpenClaw config value at models.providers.poe."
    );
  });
});

function containerEnv() {
  return {
    cwd,
    homeDir,
    platform: "darwin" as const,
    configPath: `${homeDir}/.poe-code/config.json`,
    logDir: `${homeDir}/.poe-code/logs`,
    poeApiBaseUrl: "https://api.poe.com/v1",
    poeBaseUrl: "https://api.poe.com",
    variables: {},
    resolveHomePath: (...segments: string[]) => [homeDir, ...segments].join("/"),
    getVariable: () => undefined
  };
}
