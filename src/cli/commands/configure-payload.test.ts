import { describe, it, expect, vi, beforeEach } from "vitest";
import { createConfigurePayload } from "./configure-payload.js";
import { createCliContainer } from "../container.js";
import { createHomeFs, createTestProgram } from "../../../tests/test-helpers.js";
import { createExecutionResources, buildProviderContext, type CommandFlags } from "./shared.js";
import type { FileSystem } from "../../utils/file-system.js";
import { createProviderStub } from "../../../tests/provider-stub.js";
import { resolveServicesConfigPath } from "@poe-code/poe-code-config";
import type { ModelChoice } from "../prompts.js";

const cwd = "/repo";
const homeDir = "/home/test";

const defaultFlags: CommandFlags = { dryRun: false, assumeYes: true, verbose: false };

function createContainer(fs: FileSystem) {
  return createCliContainer({
    fs,
    prompts: vi.fn().mockResolvedValue({}),
    env: { cwd, homeDir },
    logger: () => {}
  });
}

function createLoggingContainer(fs: FileSystem, lines: string[]) {
  return createCliContainer({
    fs,
    prompts: vi.fn().mockResolvedValue({}),
    env: { cwd, homeDir },
    logger: (line) => {
      lines.push(line);
    }
  });
}

describe("createConfigurePayload — ActiveProvider fields", () => {
  let fs: FileSystem;

  beforeEach(() => {
    fs = createHomeFs(homeDir);
    createTestProgram();
  });

  it("sets provider.id to the given providerId", async () => {
    const container = createContainer(fs);
    vi.spyOn(container.options, "resolveApiKey").mockResolvedValue("sk-test");

    const adapter = container.registry.require("claude-code");
    const resources = createExecutionResources(container, defaultFlags, "test");
    const context = buildProviderContext(container, adapter, resources);

    const payload = (await createConfigurePayload({
      container,
      flags: defaultFlags,
      options: {},
      context,
      adapter,
      logger: resources.logger,
      providerId: "poe"
    })) as Record<string, unknown>;

    expect((payload.provider as Record<string, unknown>).id).toBe("poe");
  });

  it("sets provider.credential to the resolved API key", async () => {
    const container = createContainer(fs);
    vi.spyOn(container.options, "resolveApiKey").mockResolvedValue("sk-resolved-key");

    const adapter = container.registry.require("claude-code");
    const resources = createExecutionResources(container, defaultFlags, "test");
    const context = buildProviderContext(container, adapter, resources);

    const payload = (await createConfigurePayload({
      container,
      flags: defaultFlags,
      options: {},
      context,
      adapter,
      logger: resources.logger,
      providerId: "poe"
    })) as Record<string, unknown>;

    expect((payload.provider as Record<string, unknown>).credential).toBe("sk-resolved-key");
  });

  it("sets provider.apiShape and baseUrl from the resolved API shape", async () => {
    const container = createContainer(fs);
    vi.spyOn(container.options, "resolveApiKey").mockResolvedValue("sk-test");

    const adapter = container.registry.require("claude-code");
    const resources = createExecutionResources(container, defaultFlags, "test");
    const context = buildProviderContext(container, adapter, resources);

    const payload = (await createConfigurePayload({
      container,
      flags: defaultFlags,
      options: {},
      context,
      adapter,
      logger: resources.logger,
      providerId: "poe"
    })) as Record<string, unknown>;

    expect((payload.provider as Record<string, unknown>).apiShape).toBe("anthropic-messages");
    expect((payload.provider as Record<string, unknown>).baseUrl).toBe(
      "https://api.poe.com/anthropic"
    );
  });

  it("prefers a stored per-shape baseUrl over the provider default", async () => {
    const container = createContainer(fs);
    vi.spyOn(container.options, "resolveApiKey").mockResolvedValue("sk-test");
    const servicesConfigPath = resolveServicesConfigPath(homeDir);
    await fs.mkdir(`${homeDir}/.config/poe-code`, { recursive: true });
    await fs.writeFile(
      servicesConfigPath,
      JSON.stringify(
        {
          providers: {
            poe: {
              shapeBaseUrls: {
                "anthropic-messages": "https://proxy.example.test/anthropic"
              }
            }
          }
        },
        null,
        2
      ) + "\n",
      "utf8"
    );

    const adapter = container.registry.require("claude-code");
    const resources = createExecutionResources(container, defaultFlags, "test");
    const context = buildProviderContext(container, adapter, resources);

    const payload = (await createConfigurePayload({
      container,
      flags: defaultFlags,
      options: {},
      context,
      adapter,
      logger: resources.logger,
      providerId: "poe"
    })) as Record<string, unknown>;

    expect((payload.provider as Record<string, unknown>).baseUrl).toBe(
      "https://proxy.example.test/anthropic"
    );
  });

  it("surfaces the effective base URLs so a dry run shows the requested override", async () => {
    const lines: string[] = [];
    const container = createLoggingContainer(fs, lines);
    vi.spyOn(container.options, "resolveApiKey").mockResolvedValue("sk-test");
    vi.spyOn(container.options, "resolveModel").mockImplementation(
      async ({ defaultValue }) => defaultValue
    );
    const dryRunFlags: CommandFlags = { dryRun: true, assumeYes: true, verbose: false };

    const adapter = container.registry.require("claude-code");
    const resources = createExecutionResources(container, dryRunFlags, "test");
    const context = buildProviderContext(container, adapter, resources);

    await createConfigurePayload({
      container,
      flags: dryRunFlags,
      options: { baseUrl: "https://example.invalid" },
      context,
      adapter,
      logger: resources.logger,
      providerId: "poe"
    });

    const output = lines.join("\n");
    expect(output).toContain("https://example.invalid");
    expect(output).not.toContain("https://api.poe.com");
  });

  it("omits provider auth resolution for providerless services", async () => {
    const container = createContainer(fs);
    const resolveApiKeySpy = vi.spyOn(container.options, "resolveApiKey");

    const adapter = createProviderStub({
      name: "providerless-tool",
      label: "Providerless Tool",
      requiresProvider: false
    });
    const resources = createExecutionResources(container, defaultFlags, "test");
    const context = buildProviderContext(container, adapter, resources);

    const payload = (await createConfigurePayload({
      container,
      flags: defaultFlags,
      options: {},
      context,
      adapter,
      logger: resources.logger,
      providerId: undefined
    })) as Record<string, unknown>;

    expect(resolveApiKeySpy).not.toHaveBeenCalled();
    expect(payload.provider).toBeUndefined();
    expect(payload.env).toBeDefined();
  });
});

describe("createConfigurePayload — model choices", () => {
  let fs: FileSystem;

  beforeEach(() => {
    fs = createHomeFs(homeDir);
    createTestProgram();
  });

  it("passes static model choices through unchanged", async () => {
    const container = createContainer(fs);
    vi.spyOn(container.options, "resolveApiKey").mockResolvedValue("sk-test");
    const staticChoices: ReadonlyArray<ModelChoice> = [
      { title: "Static A", value: "static-a" },
      { title: "Static B", value: "static-b" }
    ];
    const resolveModel = vi
      .spyOn(container.options, "resolveModel")
      .mockImplementation(async ({ choices, defaultValue }) => {
        expect(choices).toBe(staticChoices);
        return defaultValue;
      });

    const adapter = createProviderStub({
      name: "opencode",
      label: "Static Model Service",
      configurePrompts: {
        model: {
          label: "Static model",
          defaultValue: "static-a",
          choices: staticChoices
        }
      }
    });
    const resources = createExecutionResources(container, defaultFlags, "test");
    const context = buildProviderContext(container, adapter, resources);

    await createConfigurePayload({
      container,
      flags: defaultFlags,
      options: {},
      context,
      adapter,
      logger: resources.logger,
      providerId: "poe"
    });

    expect(resolveModel).toHaveBeenCalledOnce();
  });

  it("does not recover invalid stored model config during dry-run payload creation", async () => {
    await fs.mkdir(`${homeDir}/.poe-code`, { recursive: true });
    await fs.writeFile(`${homeDir}/.poe-code/config.json`, "{invalid json", "utf8");
    const container = createContainer(fs);
    vi.spyOn(container.options, "resolveApiKey").mockResolvedValue("sk-test");

    const adapter = createProviderStub({
      name: "opencode",
      label: "Static Model Service",
      configurePrompts: {
        model: {
          label: "Static model",
          defaultValue: "static-a",
          choices: [{ title: "Static A", value: "static-a" }]
        }
      }
    });
    const resources = createExecutionResources(container, { ...defaultFlags, dryRun: true }, "test");
    const context = buildProviderContext(container, adapter, resources);

    await expect(
      createConfigurePayload({
        container,
        flags: { ...defaultFlags, dryRun: true },
        options: {},
        context,
        adapter,
        logger: resources.logger,
        providerId: "poe"
      })
    ).rejects.toThrow(SyntaxError);
    await expect(fs.readFile(`${homeDir}/.poe-code/config.json`, "utf8")).resolves.toBe(
      "{invalid json"
    );
    await expect(fs.readdir(`${homeDir}/.poe-code`)).resolves.toEqual(["config.json"]);
  });

  it("uses async resolver output for model choices", async () => {
    const container = createContainer(fs);
    vi.spyOn(container.options, "resolveApiKey").mockResolvedValue("sk-test");
    const resolvedChoices: ReadonlyArray<ModelChoice> = [
      { title: "Resolved A", value: "resolved-a" },
      { title: "Resolved B", value: "resolved-b" }
    ];
    const choicesResolver = vi.fn().mockResolvedValue(resolvedChoices);
    const resolveModel = vi
      .spyOn(container.options, "resolveModel")
      .mockImplementation(async ({ choices, defaultValue }) => {
        expect(choices).toBe(resolvedChoices);
        return defaultValue;
      });

    const adapter = createProviderStub({
      name: "opencode",
      label: "Dynamic Model Service",
      configurePrompts: {
        model: {
          label: "Dynamic model",
          defaultValue: "resolved-a",
          choices: choicesResolver
        }
      }
    });
    const resources = createExecutionResources(container, defaultFlags, "test");
    const context = buildProviderContext(container, adapter, resources);

    await createConfigurePayload({
      container,
      flags: defaultFlags,
      options: {},
      context,
      adapter,
      logger: resources.logger,
      providerId: "poe"
    });

    expect(resolveModel).toHaveBeenCalledOnce();
    expect(choicesResolver).toHaveBeenCalledWith({
      httpClient: container.httpClient,
      provider: expect.objectContaining({
        id: "poe",
        apiShape: "openai-chat-completions",
        credential: "sk-test"
      }),
      env: container.env
    });
  });

  it("uses async resolver output for providers with freeform model input", async () => {
    const container = createContainer(fs);
    vi.spyOn(container.providerRegistry, "resolveCredential").mockResolvedValue("cf-token");
    const resolvedChoices: ReadonlyArray<ModelChoice> = [
      { title: "Gemini A", value: "gemini-a" },
      { title: "Gemini B", value: "gemini-b" }
    ];
    const choicesResolver = vi.fn().mockResolvedValue(resolvedChoices);
    const resolveModel = vi
      .spyOn(container.options, "resolveModel")
      .mockImplementation(async ({ choices }) => choices?.[0]?.value ?? "missing");

    const adapter = createProviderStub({
      name: "gemini-cli",
      label: "Gemini CLI",
      configurePrompts: {
        model: {
          label: "Gemini model",
          defaultValue: "gemini-a",
          choices: choicesResolver
        }
      }
    });
    const resources = createExecutionResources(container, defaultFlags, "test");
    const context = buildProviderContext(container, adapter, resources);

    const payload = (await createConfigurePayload({
      container,
      flags: defaultFlags,
      options: { baseUrl: "https://gateway.example.com" },
      context,
      adapter,
      logger: resources.logger,
      providerId: "cloudflare"
    })) as Record<string, unknown>;

    expect(payload.model).toBe("gemini-a");
    expect(resolveModel).toHaveBeenCalledWith(
      expect.objectContaining({
        choices: resolvedChoices
      })
    );
    expect(choicesResolver).toHaveBeenCalledWith({
      httpClient: container.httpClient,
      provider: expect.objectContaining({
        id: "cloudflare",
        apiShape: "google-generations",
        baseUrl: "https://gateway.example.com/google-ai-studio",
        credential: "cf-token"
      }),
      env: container.env
    });
  });

  it("continues with the default model choice when an async resolver throws", async () => {
    const logs: string[] = [];
    const container = createCliContainer({
      fs,
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir },
      logger: (message) => logs.push(message)
    });
    vi.spyOn(container.options, "resolveApiKey").mockResolvedValue("sk-test");
    const choicesResolver = vi.fn().mockRejectedValue(new Error("network unavailable"));
    const resolveModel = vi
      .spyOn(container.options, "resolveModel")
      .mockImplementation(async ({ choices, defaultValue }) => {
        expect(choices).toEqual([{ title: "fallback-model", value: "fallback-model" }]);
        return defaultValue;
      });

    const adapter = createProviderStub({
      name: "opencode",
      label: "Throwing Model Service",
      configurePrompts: {
        model: {
          label: "Throwing model",
          defaultValue: "fallback-model",
          choices: choicesResolver
        }
      }
    });
    const flags: CommandFlags = { ...defaultFlags, verbose: true };
    const resources = createExecutionResources(container, flags, "test");
    const context = buildProviderContext(container, adapter, resources);

    const payload = (await createConfigurePayload({
      container,
      flags,
      options: {},
      context,
      adapter,
      logger: resources.logger,
      providerId: "poe"
    })) as Record<string, unknown>;

    expect(payload.model).toBe("fallback-model");
    expect(resolveModel).toHaveBeenCalledOnce();
    expect(logs).toContain(
      "[test] Failed to resolve model choices for opencode: network unavailable. Using fallback-model."
    );
  });

  it("ignores stored config models when falling back from a failed async resolver", async () => {
    const container = createContainer(fs);
    await fs.mkdir(`${homeDir}/.poe-code`, { recursive: true });
    await fs.writeFile(
      container.env.configPath,
      JSON.stringify({ models: { opencode: "stored-model" } }, null, 2) + "\n",
      "utf8"
    );
    vi.spyOn(container.options, "resolveApiKey").mockResolvedValue("sk-test");
    const choicesResolver = vi.fn().mockRejectedValue(new Error("network unavailable"));

    const adapter = createProviderStub({
      name: "opencode",
      label: "Throwing Model Service",
      configurePrompts: {
        model: {
          label: "Throwing model",
          defaultValue: "fallback-model",
          choices: choicesResolver
        }
      }
    });
    const resources = createExecutionResources(container, defaultFlags, "test");
    const context = buildProviderContext(container, adapter, resources);

    const payload = (await createConfigurePayload({
      container,
      flags: defaultFlags,
      options: {},
      context,
      adapter,
      logger: resources.logger,
      providerId: "poe"
    })) as Record<string, unknown>;

    expect(payload.model).toBe("fallback-model");
  });

  it("resolves a claude model alias to its full catalog id", async () => {
    const container = createContainer(fs);
    vi.spyOn(container.options, "resolveApiKey").mockResolvedValue("sk-test");

    const adapter = container.registry.require("claude-code");
    const resources = createExecutionResources(container, defaultFlags, "test");
    const context = buildProviderContext(container, adapter, resources);

    const payload = (await createConfigurePayload({
      container,
      flags: defaultFlags,
      options: { model: "sonnet" },
      context,
      adapter,
      logger: resources.logger,
      providerId: "poe"
    })) as Record<string, unknown>;

    expect(payload.model).toBe("anthropic/claude-sonnet-4.6");
  });

  it("rejects a claude model that is absent from the declared catalog", async () => {
    const container = createContainer(fs);
    vi.spyOn(container.options, "resolveApiKey").mockResolvedValue("sk-test");

    const adapter = container.registry.require("claude-code");
    const resources = createExecutionResources(container, defaultFlags, "test");
    const context = buildProviderContext(container, adapter, resources);

    await expect(
      createConfigurePayload({
        container,
        flags: defaultFlags,
        options: { model: "does-not-exist-xyz" },
        context,
        adapter,
        logger: resources.logger,
        providerId: "poe"
      })
    ).rejects.toThrow(/Unknown model "does-not-exist-xyz"/);
  });

  it("keeps explicit models unchecked for dynamic catalog services", async () => {
    const container = createContainer(fs);
    vi.spyOn(container.options, "resolveApiKey").mockResolvedValue("sk-test");
    const choicesResolver = vi
      .fn()
      .mockResolvedValue([{ title: "Resolved A", value: "resolved-a" }]);

    const adapter = createProviderStub({
      name: "opencode",
      label: "Dynamic Model Service",
      configurePrompts: {
        model: {
          label: "Dynamic model",
          defaultValue: "resolved-a",
          choices: choicesResolver
        }
      }
    });
    const resources = createExecutionResources(container, defaultFlags, "test");
    const context = buildProviderContext(container, adapter, resources);

    const payload = (await createConfigurePayload({
      container,
      flags: defaultFlags,
      options: { model: "model-only-on-the-server" },
      context,
      adapter,
      logger: resources.logger,
      providerId: "poe"
    })) as Record<string, unknown>;

    expect(payload.model).toBe("model-only-on-the-server");
  });

  it("applies an explicit reasoning effort to the payload", async () => {
    const container = createContainer(fs);
    vi.spyOn(container.options, "resolveApiKey").mockResolvedValue("sk-test");

    const adapter = container.registry.require("claude-code");
    const resources = createExecutionResources(container, defaultFlags, "test");
    const context = buildProviderContext(container, adapter, resources);

    const payload = (await createConfigurePayload({
      container,
      flags: defaultFlags,
      options: { model: "sonnet", reasoningEffort: "low" },
      context,
      adapter,
      logger: resources.logger,
      providerId: "poe"
    })) as Record<string, unknown>;

    expect(payload.reasoningEffort).toBe("low");
  });

  it("rejects a reasoning effort the selected model does not support", async () => {
    const container = createContainer(fs);
    vi.spyOn(container.options, "resolveApiKey").mockResolvedValue("sk-test");

    const adapter = container.registry.require("claude-code");
    const resources = createExecutionResources(container, defaultFlags, "test");
    const context = buildProviderContext(container, adapter, resources);

    await expect(
      createConfigurePayload({
        container,
        flags: defaultFlags,
        options: { model: "sonnet", reasoningEffort: "xhigh" },
        context,
        adapter,
        logger: resources.logger,
        providerId: "poe"
      })
    ).rejects.toThrow(/Unknown reasoning effort "xhigh"/);
  });

  it("accepts a reasoning effort only the selected model supports", async () => {
    const container = createContainer(fs);
    vi.spyOn(container.options, "resolveApiKey").mockResolvedValue("sk-test");

    const adapter = container.registry.require("claude-code");
    const resources = createExecutionResources(container, defaultFlags, "test");
    const context = buildProviderContext(container, adapter, resources);

    const payload = (await createConfigurePayload({
      container,
      flags: defaultFlags,
      options: { model: "opus", reasoningEffort: "xhigh" },
      context,
      adapter,
      logger: resources.logger,
      providerId: "poe"
    })) as Record<string, unknown>;

    expect(payload.reasoningEffort).toBe("xhigh");
  });

  it("rejects a reasoning effort for an agent that does not support it", async () => {
    const container = createContainer(fs);
    vi.spyOn(container.options, "resolveApiKey").mockResolvedValue("sk-test");

    const adapter = createProviderStub({
      name: "opencode",
      label: "No Effort Service",
      configurePrompts: {
        model: {
          label: "No effort model",
          defaultValue: "model-a"
        }
      }
    });
    const resources = createExecutionResources(container, defaultFlags, "test");
    const context = buildProviderContext(container, adapter, resources);

    await expect(
      createConfigurePayload({
        container,
        flags: defaultFlags,
        options: { reasoningEffort: "low" },
        context,
        adapter,
        logger: resources.logger,
        providerId: "poe"
      })
    ).rejects.toThrow(/No Effort Service does not support --reasoning-effort/);
  });

  it("rejects a model for an agent that does not support one", async () => {
    const container = createContainer(fs);
    vi.spyOn(container.options, "resolveApiKey").mockResolvedValue("sk-test");

    const adapter = createProviderStub({
      name: "cursor",
      label: "No Model Service"
    });
    const resources = createExecutionResources(container, defaultFlags, "test");
    const context = buildProviderContext(container, adapter, resources);

    await expect(
      createConfigurePayload({
        container,
        flags: defaultFlags,
        options: { model: "anthropic/claude-opus-4.7" },
        context,
        adapter,
        logger: resources.logger
      })
    ).rejects.toThrow(/No Model Service does not support --model/);
  });

  it("allows an absent model for an agent that does not support one", async () => {
    const container = createContainer(fs);

    const adapter = createProviderStub({
      name: "cursor",
      label: "No Model Service"
    });
    const resources = createExecutionResources(container, defaultFlags, "test");
    const context = buildProviderContext(container, adapter, resources);

    const payload = (await createConfigurePayload({
      container,
      flags: defaultFlags,
      options: {},
      context,
      adapter,
      logger: resources.logger
    })) as Record<string, unknown>;

    expect(payload).not.toHaveProperty("model");
  });

  it("leaves the payload without reasoning effort when the flag is absent", async () => {
    const container = createContainer(fs);
    vi.spyOn(container.options, "resolveApiKey").mockResolvedValue("sk-test");

    const adapter = container.registry.require("claude-code");
    const resources = createExecutionResources(container, defaultFlags, "test");
    const context = buildProviderContext(container, adapter, resources);

    const payload = (await createConfigurePayload({
      container,
      flags: defaultFlags,
      options: { model: "sonnet" },
      context,
      adapter,
      logger: resources.logger,
      providerId: "poe"
    })) as Record<string, unknown>;

    expect(payload).not.toHaveProperty("reasoningEffort");
  });

  it("calls an async model choices resolver once per configure run", async () => {
    const container = createContainer(fs);
    vi.spyOn(container.options, "resolveApiKey").mockResolvedValue("sk-test");
    const choicesResolver = vi
      .fn()
      .mockResolvedValue([{ title: "Resolved Once", value: "resolved-once" }]);
    vi.spyOn(container.options, "resolveModel").mockImplementation(
      async ({ choices }) => choices?.[0]?.value ?? "missing"
    );

    const adapter = createProviderStub({
      name: "opencode",
      label: "Cached Model Service",
      configurePrompts: {
        model: {
          label: "Cached model",
          defaultValue: "resolved-once",
          choices: choicesResolver
        }
      }
    });
    const resources = createExecutionResources(container, defaultFlags, "test");
    const context = buildProviderContext(container, adapter, resources);

    await createConfigurePayload({
      container,
      flags: defaultFlags,
      options: {},
      context,
      adapter,
      logger: resources.logger,
      providerId: "poe"
    });

    expect(choicesResolver).toHaveBeenCalledOnce();
  });
});
