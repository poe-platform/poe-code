import { describe, it, expect, vi, beforeEach } from "vitest";
import { executeConfigure } from "./configure.js";
import { createCliContainer } from "../container.js";
import type { FileSystem } from "../utils/file-system.js";
import type { CommandRunner } from "../../utils/command-checks.js";
import { createHomeFs, createTestProgram } from "../../../tests/test-helpers.js";
import type { HttpClient } from "../http.js";
import type { LoggerFn } from "../types.js";
import { createProviderStub } from "../../../tests/provider-stub.js";
import { provider as openClawProvider } from "../../providers/openclaw.js";

const cwd = "/repo";
const homeDir = "/home/test";
const configPath = homeDir + "/.poe-code/config.json";

describe("configure command", () => {
  let fs: FileSystem;

  beforeEach(() => {
    fs = createHomeFs(homeDir);
  });

  function createContainer(
    overrides: {
      commandRunner?: CommandRunner;
      logger?: LoggerFn;
      httpClient?: HttpClient;
    } = {}
  ) {
    const prompts = vi.fn().mockResolvedValue({});
    const commandRunner: CommandRunner =
      overrides.commandRunner ??
      vi.fn(async (command, args) => {
        if (command === "codex" && args.includes("exec")) {
          return { stdout: "CODEX_OK\n", stderr: "", exitCode: 0 };
        }
        if (command === "opencode" && args.includes("run")) {
          return { stdout: "OPEN_CODE_OK\n", stderr: "", exitCode: 0 };
        }
        if (command === "claude" && args[0] === "-p") {
          return { stdout: "CLAUDE_CODE_OK\n", stderr: "", exitCode: 0 };
        }
        return { stdout: "", stderr: "", exitCode: 0 };
      });
    const logger = overrides.logger ?? (() => {});
    const container = createCliContainer({
      fs,
      prompts,
      env: { cwd, homeDir },
      logger,
      commandRunner,
      httpClient: overrides.httpClient
    });
    return { container, prompts, commandRunner };
  }

  it("does not invoke install when configuring a service", async () => {
    const { container } = createContainer();

    vi.spyOn(container.options, "resolveApiKey").mockResolvedValue("sk-test");
    vi.spyOn(container.options, "resolveModel").mockResolvedValue(
      "test-model"
    );
    vi.spyOn(container.options, "resolveReasoning").mockResolvedValue("none");

    const invokeSpy = vi.spyOn(container.registry, "invoke");
    const program = createTestProgram();

    await executeConfigure(program, container, "codex", {});

    expect(invokeSpy).toHaveBeenCalledTimes(1);
    const [, operation] = invokeSpy.mock.calls[0]!;
    expect(operation).toBe("configure");
  });

  it("stores configured service metadata", async () => {
    const { container } = createContainer();
    await fs.mkdir(`${homeDir}/.poe-code/opencode/.config/opencode`, {
      recursive: true
    });
    vi.spyOn(container.options, "resolveApiKey").mockResolvedValue("sk-opencode");
    vi.spyOn(container.options, "resolveModel").mockImplementation(
      async ({ defaultValue }) => defaultValue
    );

    const program = createTestProgram();
    await executeConfigure(program, container, "opencode", {});

    const content = JSON.parse(await fs.readFile(configPath, "utf8"));
    expect(content.configured_services.opencode).toEqual({
      files: [
        homeDir + "/.config/opencode/config.json",
        homeDir + "/.local/share/opencode/auth.json",
        homeDir + "/.poe-code/opencode/.config/opencode/config.json",
        homeDir + "/.poe-code/opencode/.local/share/opencode/auth.json"
      ]
    });
  });

  it("skips metadata persistence during dry run", async () => {
    const { container } = createContainer();
    await fs.mkdir(`${homeDir}/.poe-code/opencode/.config/opencode`, {
      recursive: true
    });
    vi.spyOn(container.options, "resolveApiKey").mockResolvedValue("sk-opencode");
    vi.spyOn(container.options, "resolveModel").mockImplementation(
      async ({ defaultValue }) => defaultValue
    );

    const program = createTestProgram(["node", "cli", "--dry-run"]);
    await executeConfigure(program, container, "opencode", {});

    await expect(fs.readFile(configPath, "utf8")).rejects.toThrow();
  });

  it("uses provider-defined prompt metadata for configure flows", async () => {
    const { container } = createContainer();
    const provider = container.registry.require("codex") as any;
    provider.configurePrompts = {
      model: {
        label: "Custom Codex model",
        defaultValue: "custom-model",
        choices: [{ title: "Custom", value: "custom-model" }]
      },
      reasoningEffort: {
        label: "Custom reasoning label",
        defaultValue: "extra"
      }
    };

    const resolveModel = vi
      .spyOn(container.options, "resolveModel")
      .mockImplementation(async (input) => {
        expect(input.label).toBe("Custom Codex model");
        expect(input.defaultValue).toBe("custom-model");
        return input.defaultValue;
      });
    const resolveReasoning = vi
      .spyOn(container.options, "resolveReasoning")
      .mockImplementation(async (input) => {
        expect(input.label).toBe("Custom reasoning label");
        expect(input.defaultValue).toBe("extra");
        return input.defaultValue;
      });
    vi.spyOn(container.options, "resolveApiKey").mockResolvedValue("sk-test");

    const program = createTestProgram();
    await executeConfigure(program, container, "codex", {});

    expect(resolveModel).toHaveBeenCalled();
    expect(resolveReasoning).toHaveBeenCalled();
  });

  it("resolves the model when configuring kimi", async () => {
    const { container } = createContainer();
    vi.spyOn(container.options, "resolveApiKey").mockResolvedValue("sk-kimi");
    const resolvedModel = "Kimi-Custom";
    const resolveModel = vi
      .spyOn(container.options, "resolveModel")
      .mockResolvedValue(resolvedModel);

    const program = createTestProgram();
    await executeConfigure(program, container, "kimi", {});

    expect(resolveModel).toHaveBeenCalled();
  });

  it("accepts --model option to set a model without prompting", async () => {
    const { container } = createContainer();
    const customModel = "Custom-Model";

    const resolveModel = vi.spyOn(container.options, "resolveModel");
    vi.spyOn(container.options, "resolveApiKey").mockResolvedValue("sk-test");

    const program = createTestProgram();
    await executeConfigure(program, container, "opencode", {
      model: customModel
    });

    expect(resolveModel).toHaveBeenCalledWith(
      expect.objectContaining({
        value: customModel
      })
    );

    const configPath = homeDir + "/.config/opencode/config.json";
    const settings = JSON.parse(await fs.readFile(configPath, "utf8"));
    expect(settings.model).toBe(`poe/${customModel}`);
  });

  it("accepts the `claude` alias for Claude Code", async () => {
    const { container } = createContainer();
    vi.spyOn(container.options, "resolveApiKey").mockResolvedValue("sk-test");
    vi.spyOn(container.options, "resolveModel").mockImplementation(
      async ({ defaultValue }) => defaultValue
    );

    const program = createTestProgram();
    await executeConfigure(program, container, "claude", {});

    const content = JSON.parse(await fs.readFile(configPath, "utf8"));
    expect(content.configured_services["claude-code"]).toBeDefined();
    expect(content.configured_services.claude).toBeUndefined();
  });

  it("uses provider-built configure payloads and managed files", async () => {
    const { container } = createContainer();
    const afterConfigure = vi.fn(async () => {});
    const managedPath = `${homeDir}/.openclaw/openclaw.json`;
    const configureSpy = vi.fn(async () => {});
    const buildConfigurePayload = vi.fn(async () => ({
      options: {
        env: container.env,
        apiKey: "sk-openclaw",
        model: "claude-sonnet-4.6"
      },
      files: [managedPath],
      afterConfigure
    }));

    const adapter = createProviderStub({
      name: "test-service",
      label: "Test Service",
      async configure(context) {
        configureSpy(context.options);
      }
    }) as any;
    adapter.buildConfigurePayload = buildConfigurePayload;
    container.registry.register(adapter);

    const program = createTestProgram();
    await executeConfigure(program, container, "test-service", {});

    expect(buildConfigurePayload).toHaveBeenCalled();
    expect(configureSpy).toHaveBeenCalledWith({
      env: container.env,
      apiKey: "sk-openclaw",
      model: "claude-sonnet-4.6"
    });
    expect(afterConfigure).toHaveBeenCalledTimes(1);

    const content = JSON.parse(await fs.readFile(configPath, "utf8"));
    expect(content.configured_services["test-service"]).toEqual({
      files: [managedPath]
    });
  });

  it("tracks isolated configuration files in configured service metadata", async () => {
    const { container } = createContainer();
    vi.spyOn(container.options, "resolveApiKey").mockResolvedValue("sk-test");

    const configureSpy = vi.fn(async () => {});
    const adapter = createProviderStub({
      name: "isolated-service",
      label: "Isolated Service",
      isolatedEnv: {
        agentBinary: "isolated-service",
        env: {
          HOME: { kind: "isolatedDir" }
        }
      },
      async configure(_context, runOptions) {
        const callNumber = configureSpy.mock.calls.length;
        configureSpy();
        const targetPath = callNumber === 0
          ? `${homeDir}/.config/isolated-service/config.json`
          : `${homeDir}/.local/share/poe-code/isolated/isolated-service/config.json`;
        runOptions?.observers?.onComplete?.(
          {
            manifestId: "isolated-service",
            kind: "transformFile",
            label: `Transform file ${targetPath}`,
            targetPath
          },
          {
            changed: true,
            effect: "write",
            detail: "write"
          }
        );
      }
    });
    container.registry.register(adapter);

    const program = createTestProgram();
    await executeConfigure(program, container, "isolated-service", {});

    const content = JSON.parse(await fs.readFile(configPath, "utf8"));
    expect(content.configured_services["isolated-service"]).toEqual({
      files: [
        `${homeDir}/.config/isolated-service/config.json`,
        `${homeDir}/.local/share/poe-code/isolated/isolated-service/config.json`
      ]
    });
  });

  it("persists managed files before afterConfigure can fail", async () => {
    const { container } = createContainer();
    const baseManagedPath = `${homeDir}/.openclaw/openclaw.json`;
    const baseMutationPath = `${homeDir}/.config/test-service/config.json`;
    const isolatedMutationPath =
      `${homeDir}/.local/share/poe-code/isolated/test-service/config.json`;
    let configureCalls = 0;
    const afterConfigure = vi.fn(async () => {
      throw new Error("restart failed");
    });
    const buildConfigurePayload = vi.fn(async () => ({
      options: {},
      files: [baseManagedPath],
      afterConfigure
    }));

    const adapter = createProviderStub({
      name: "test-service",
      label: "Test Service",
      isolatedEnv: {
        agentBinary: "test-service",
        env: {
          HOME: { kind: "isolatedDir" }
        }
      },
      async configure(_context, runOptions) {
        configureCalls += 1;
        const targetPath = configureCalls === 1
          ? baseMutationPath
          : isolatedMutationPath;
        runOptions?.observers?.onComplete?.(
          {
            manifestId: "test-service",
            kind: "transformFile",
            label: `Transform file ${targetPath}`,
            targetPath
          },
          {
            changed: true,
            effect: "write",
            detail: "write"
          }
        );
      }
    }) as any;
    adapter.buildConfigurePayload = buildConfigurePayload;
    container.registry.register(adapter);

    const program = createTestProgram();
    await expect(
      executeConfigure(program, container, "test-service", {})
    ).rejects.toThrow("restart failed");

    const content = JSON.parse(await fs.readFile(configPath, "utf8"));
    expect(content.configured_services["test-service"]).toEqual({
      files: [baseMutationPath, isolatedMutationPath, baseManagedPath]
    });
  });

  it("persists isolated managed files even when isolated config fails", async () => {
    const { container } = createContainer();
    const baseManagedPath = `${homeDir}/.openclaw/openclaw.json`;
    const baseMutationPath = `${homeDir}/.config/test-service/config.json`;
    const isolatedMutationPath =
      `${homeDir}/.local/share/poe-code/isolated/test-service/config.json`;
    let configureCalls = 0;
    const buildConfigurePayload = vi.fn(async () => ({
      options: {},
      files: [baseManagedPath]
    }));

    const adapter = createProviderStub({
      name: "test-service",
      label: "Test Service",
      isolatedEnv: {
        agentBinary: "test-service",
        env: {
          HOME: { kind: "isolatedDir" }
        }
      },
      async configure(_context, runOptions) {
        configureCalls += 1;
        const targetPath = configureCalls === 1
          ? baseMutationPath
          : isolatedMutationPath;
        runOptions?.observers?.onComplete?.(
          {
            manifestId: "test-service",
            kind: "transformFile",
            label: `Transform file ${targetPath}`,
            targetPath
          },
          {
            changed: true,
            effect: "write",
            detail: "write"
          }
        );
        if (configureCalls === 2) {
          throw new Error("isolated configure failed");
        }
      }
    }) as any;
    adapter.buildConfigurePayload = buildConfigurePayload;
    container.registry.register(adapter);

    const program = createTestProgram();
    await expect(
      executeConfigure(program, container, "test-service", {})
    ).rejects.toThrow("isolated configure failed");

    const content = JSON.parse(await fs.readFile(configPath, "utf8"));
    expect(content.configured_services["test-service"]).toEqual({
      files: [baseMutationPath, isolatedMutationPath, baseManagedPath]
    });
  });

  it("configures openclaw through the real provider path", async () => {
    const commandRunner = vi.fn(async (command: string, args: string[]) => {
      if (command === "which" && args[0] === "openclaw") {
        return {
          stdout: "/usr/local/bin/openclaw\n",
          stderr: "",
          exitCode: 0
        };
      }
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
    const httpClient: HttpClient = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        object: "list",
        data: [
          {
            id: "claude-sonnet-4.6",
            object: "model",
            created: 1700000000000,
            owned_by: "Anthropic",
            architecture: {
              input_modalities: ["text"],
              output_modalities: ["text"],
              modality: "text->text"
            },
            metadata: {
              display_name: "claude-sonnet-4.6"
            },
            pricing: null,
            context_window: {
              context_length: 200000,
              max_output_tokens: 8192
            },
            reasoning: null,
            supported_features: [],
            parameters: []
          }
        ]
      })
    }));
    const { container } = createContainer({
      commandRunner,
      httpClient
    });
    vi.spyOn(container.options, "resolveApiKey").mockResolvedValue("sk-openclaw");
    vi.spyOn(container.options, "resolveModel").mockResolvedValue(
      "claude-sonnet-4.6"
    );

    const program = createTestProgram();
    await executeConfigure(program, container, "openclaw", {});

    expect(commandRunner).toHaveBeenNthCalledWith(
      1,
      "which",
      ["openclaw"],
      undefined
    );
    expect(commandRunner).toHaveBeenNthCalledWith(2, "openclaw", [
      "config",
      "file"
    ], undefined);
    expect(commandRunner).toHaveBeenNthCalledWith(3, "openclaw", [
      "config",
      "validate",
      "--json"
    ], undefined);
    expect(commandRunner).toHaveBeenNthCalledWith(4, "openclaw", [
      "config",
      "set",
      "models.providers.poe",
      expect.any(String),
      "--strict-json"
    ], undefined);
    expect(commandRunner).toHaveBeenNthCalledWith(5, "openclaw", [
      "models",
      "set",
      "poe/claude-sonnet-4.6"
    ], undefined);
    expect(commandRunner).toHaveBeenNthCalledWith(6, "openclaw", [
      "config",
      "validate",
      "--json"
    ], undefined);

    const content = JSON.parse(await fs.readFile(configPath, "utf8"));
    expect(content.configured_services.openclaw).toEqual({
      files: [`${homeDir}/.openclaw/openclaw.json`]
    });
  });

  it("stores a normalized OpenClaw config path in configured service metadata when isolated config also runs", async () => {
    const commandRunner = vi.fn(async (command: string, args: string[]) => {
      if (command === "which" && args[0] === "openclaw") {
        return {
          stdout: "/usr/local/bin/openclaw\n",
          stderr: "",
          exitCode: 0
        };
      }
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
    const httpClient: HttpClient = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        object: "list",
        data: [
          {
            id: "claude-sonnet-4.6",
            object: "model",
            created: 1700000000000,
            owned_by: "Anthropic",
            architecture: {
              input_modalities: ["text"],
              output_modalities: ["text"],
              modality: "text->text"
            },
            metadata: {
              display_name: "claude-sonnet-4.6"
            },
            pricing: null,
            context_window: {
              context_length: 200000,
              max_output_tokens: 8192
            },
            reasoning: null,
            supported_features: [],
            parameters: []
          }
        ]
      })
    }));
    const { container } = createContainer({
      commandRunner,
      httpClient
    });
    vi.spyOn(container.options, "resolveApiKey").mockResolvedValue("sk-openclaw");
    vi.spyOn(container.options, "resolveModel").mockResolvedValue(
      "claude-sonnet-4.6"
    );
    let configureCalls = 0;
    const adapter = createProviderStub({
      name: "openclaw-isolated",
      label: "OpenClaw Isolated",
      summary: openClawProvider.summary,
      isolatedEnv: {
        agentBinary: "openclaw",
        configProbe: {
          kind: "isolatedFile",
          relativePath: ".openclaw/openclaw.json"
        },
        env: {
          HOME: { kind: "isolatedDir" }
        }
      },
      buildConfigurePayload: openClawProvider.buildConfigurePayload,
      async configure(_context, runOptions) {
        configureCalls += 1;
        if (configureCalls !== 2) {
          return;
        }
        runOptions?.observers?.onComplete?.(
          {
            manifestId: "openclaw-isolated",
            kind: "transformFile",
            label: "Transform isolated OpenClaw config",
            targetPath: `${homeDir}/.poe-code/openclaw-isolated/.openclaw/openclaw.json`
          },
          {
            changed: true,
            effect: "write",
            detail: "write"
          }
        );
      }
    });
    container.registry.register(adapter);

    const program = createTestProgram();
    await executeConfigure(program, container, "openclaw-isolated", {});

    const content = JSON.parse(await fs.readFile(configPath, "utf8"));
    expect(content.configured_services["openclaw-isolated"]).toEqual({
      files: [
        `${homeDir}/.openclaw/openclaw.json`,
        `${homeDir}/.poe-code/openclaw-isolated/.openclaw/openclaw.json`
      ]
    });
  });

  it("prints a VSCode post-configure hint for Claude Code after configure", async () => {
    const logs: string[] = [];
    const { container } = createContainer({
      logger: (message) => logs.push(message),
    });

    vi.spyOn(container.options, "resolveApiKey").mockResolvedValue("sk-test");
    vi.spyOn(container.options, "resolveModel").mockImplementation(
      async ({ defaultValue }) => defaultValue
    );

    const program = createTestProgram();
    await executeConfigure(program, container, "claude-code", {});

    expect(logs).toEqual([
      "configure claude-code",
      "Configured Claude Code.",
      "If using VSCode - Open the Disable Login Prompt setting and check the box. vscode://settings/claudeCode.disableLoginPrompt",
      "Problems? https://github.com/poe-platform/poe-code/issues"
    ]);
  });

});
