import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { Command } from "commander";
import {
  createOverlayFileSystem,
  executeConfigure,
  registerConfigureCommand,
  resolveServiceArgument
} from "./configure.js";
import { executeUnconfigure } from "./unconfigure.js";
import { createCliContainer } from "../container.js";
import { createHomeFs, createTestProgram } from "../../../tests/test-helpers.js";
import { loadConfiguredServices } from "../../services/config.js";
import { resolveConfigPath } from "@poe-code/poe-code-config/core";
import { claudeCodeAgent } from "@poe-code/agent-defs";
import { createProviderStub } from "../../../tests/provider-stub.js";
import type { AuthProvider } from "@poe-code/providers";
import type { CommandRunner } from "../../utils/command-checks.js";
import type { FileSystem } from "../../utils/file-system.js";
import type { PromptFn } from "../types.js";
import { ValidationError } from "../errors.js";
import { PROVIDER_NAME } from "../constants.js";
import { registerProviderCommand } from "./provider.js";
import { ensureIsolatedConfigForService } from "./ensure-isolated-config.js";
import { parseToml } from "@poe-code/config-mutations/testing";

const cwd = "/repo";
const homeDir = "/home/test";
const configPath = resolveConfigPath(homeDir);
const fixtureDir = path.join(import.meta.dirname, "__fixtures__");

function createContainer(
  fs: FileSystem,
  envVars: Record<string, string | undefined> = {},
  prompts: PromptFn = vi.fn().mockResolvedValue({}),
  commandRunner?: CommandRunner
) {
  return createCliContainer({
    fs,
    prompts,
    env: { cwd, homeDir, variables: envVars },
    logger: () => {},
    commandRunner
  });
}

function createBaseProgram(): Command {
  const program = new Command();
  program.exitOverride();
  program.configureOutput({ writeErr: vi.fn() });
  program.name("poe-code").option("-y, --yes").option("--dry-run");
  return program;
}

function createFakeProvider(id: string, label: string): AuthProvider {
  return {
    id,
    label,
    summary: undefined,
    baseUrl: "https://fake.example.com",
    auth: {
      kind: "api-key",
      envVar: `${id.toUpperCase()}_API_KEY`,
      storageKey: `provider:${id}`,
      prompt: { title: `${label} API key` }
    },
    apiShapes: [
      {
        id: "anthropic-messages",
        defaultBaseUrl: `https://api.${id}.example.com/anthropic`
      },
      {
        id: "openai-responses",
        defaultBaseUrl: `https://api.${id}.example.com/responses`
      }
    ]
  };
}

function createOpenAiProvider(): AuthProvider {
  return {
    id: "openai",
    label: "OpenAI",
    summary: undefined,
    baseUrl: "https://api.openai.com",
    auth: {
      kind: "api-key",
      envVar: "OPENAI_API_KEY",
      storageKey: "provider:openai",
      prompt: { title: "OpenAI API key" }
    },
    apiShapes: [
      {
        id: "openai-responses",
        defaultBaseUrl: "https://api.openai.com/v1"
      },
      {
        id: "openai-chat-completions",
        defaultBaseUrl: "https://api.openai.com/v1"
      }
    ]
  };
}

async function captureError(run: () => Promise<unknown>): Promise<string> {
  try {
    await run();
  } catch (error) {
    return String(error);
  }
  throw new Error("Expected command to fail.");
}

function includeFakeProvider(
  container: ReturnType<typeof createContainer>,
  fakeProvider: AuthProvider
): void {
  const originalGet = container.providerRegistry.get.bind(container.providerRegistry);
  vi.spyOn(container.providerRegistry, "get").mockImplementation((id) =>
    id === fakeProvider.id ? fakeProvider : originalGet(id)
  );
}

function useOnlyPoeCandidate(container: ReturnType<typeof createContainer>): void {
  const poe = container.providerRegistry.get("poe");
  if (!poe) {
    throw new Error("Expected Poe provider to be registered.");
  }
  vi.spyOn(container.providerRegistry, "forAgent").mockReturnValue([poe]);
}

function mockOptions(container: ReturnType<typeof createContainer>) {
  vi.spyOn(container.providerRegistry, "resolveCredential").mockImplementation(
    async (_id, options) => options?.apiKey ?? "sk-test"
  );
  vi.spyOn(container.options, "resolveApiKey").mockResolvedValue("sk-test");
  vi.spyOn(container.options, "resolveModel").mockImplementation(
    async ({ defaultValue }) => defaultValue
  );
  vi.spyOn(container.options, "resolveReasoning").mockImplementation(async ({ value }) => value);
}

function stubInvoke(container: ReturnType<typeof createContainer>) {
  const fakeEntry = createProviderStub({ name: "claude-code", label: "Claude Code" });
  vi.spyOn(container.registry, "invoke").mockImplementation(async (_n, _op, runner) => {
    return runner(fakeEntry);
  });
}

function stubInvokeAndCaptureProvider(container: ReturnType<typeof createContainer>) {
  let provider: Record<string, unknown> | undefined;
  const fakeEntry = createProviderStub({
    name: "claude-code",
    label: "Claude Code",
    configure: async ({ options }) => {
      provider = (options as Record<string, unknown>).provider as Record<string, unknown>;
    }
  });
  vi.spyOn(container.registry, "invoke").mockImplementation(async (_n, _op, runner) => {
    return runner(fakeEntry);
  });
  return {
    provider: () => provider
  };
}

function withRenameOverride(fs: FileSystem, rename: FileSystem["rename"]): FileSystem {
  return new Proxy(fs, {
    get(target, property, receiver) {
      if (property === "rename") {
        return rename;
      }
      const value = Reflect.get(target, property, receiver) as unknown;
      return typeof value === "function" ? value.bind(target) : value;
    }
  }) as FileSystem;
}

function withWriteFileOverride(fs: FileSystem, writeFile: FileSystem["writeFile"]): FileSystem {
  return new Proxy(fs, {
    get(target, property, receiver) {
      if (property === "writeFile") {
        return writeFile;
      }
      const value = Reflect.get(target, property, receiver) as unknown;
      return typeof value === "function" ? value.bind(target) : value;
    }
  }) as FileSystem;
}

function createTestFsError(code: string, filePath: string): NodeJS.ErrnoException {
  const error = new Error(`${code}: test failure, '${filePath}'`) as NodeJS.ErrnoException;
  error.code = code;
  return error;
}

async function withObjectPrototypeCode<T>(code: string, callback: () => Promise<T>): Promise<T> {
  const descriptor = Object.getOwnPropertyDescriptor(Object.prototype, "code");
  Object.defineProperty(Object.prototype, "code", {
    configurable: true,
    value: code,
    writable: true
  });

  try {
    return await callback();
  } finally {
    if (descriptor) {
      Object.defineProperty(Object.prototype, "code", descriptor);
    } else {
      delete (Object.prototype as { code?: unknown }).code;
    }
  }
}

describe("configure provider resolution", () => {
  let fs: FileSystem;

  beforeEach(() => {
    fs = createHomeFs(homeDir);
  });

  it("rejects Pi as spawn-only rather than unknown", async () => {
    const container = createContainer(fs);

    for (const run of [executeConfigure, executeUnconfigure]) {
      await expect(run(createTestProgram(), container, "pi", {})).rejects.toThrow(
        'Agent "pi" does not support configure. pi supports: spawn.'
      );
    }
  });

  it("does not offer Pi in configure, install, or test selection", async () => {
    for (const action of ["configure", "install", "test"] as const) {
      let offeredValues: string[] = [];
      const prompts = vi.fn(async (descriptor) => {
        offeredValues = (descriptor.choices ?? []).map((choice) => choice.value);
        return { [descriptor.name]: "codex" };
      });
      const container = createContainer(fs, {}, prompts);

      await expect(
        resolveServiceArgument(createBaseProgram(), container, undefined, { action })
      ).resolves.toBe("codex");

      expect(offeredValues).not.toContain("pi");
    }
  });

  it("auto-selects the single logged-in provider", async () => {
    const container = createContainer(fs);
    mockOptions(container);
    const forAgentSpy = vi.spyOn(container.providerRegistry, "forAgent");
    vi.spyOn(container.providerRegistry, "isLoggedIn").mockImplementation(
      async (id) => id === "poe"
    );
    stubInvoke(container);

    await executeConfigure(createTestProgram(), container, "claude-code", {});

    expect(forAgentSpy).toHaveBeenCalledWith(claudeCodeAgent);
    const services = await loadConfiguredServices({ fs, filePath: configPath });
    expect(services["claude-code"]?.provider).toBe(PROVIDER_NAME);
  });

  it("rejects an unknown --provider as a user error listing the valid providers", async () => {
    const container = createContainer(fs);
    mockOptions(container);
    stubInvoke(container);

    const error = await executeConfigure(createTestProgram(), container, "claude-code", {
      provider: "bogus"
    }).then(
      () => undefined,
      (thrown: unknown) => thrown
    );

    expect(error).toBeInstanceOf(ValidationError);
    expect((error as ValidationError).isUserError).toBe(true);
    const expected = container.providerRegistry
      .list()
      .map((provider) => provider.id)
      .join(", ");
    expect((error as ValidationError).message).toBe(
      `Unknown provider "bogus". Expected: ${expected}.`
    );
  });

  it("treats POE_API_KEY as logged-in Poe provider with --yes", async () => {
    const container = createContainer(fs, { POE_API_KEY: "sk-env" });
    mockOptions(container);
    stubInvoke(container);

    await executeConfigure(createTestProgram(["node", "cli", "--yes"]), container, "codex", {});

    const services = await loadConfiguredServices({ fs, filePath: configPath });
    expect(services.codex?.provider).toBe(PROVIDER_NAME);
  });

  it.each([
    ["root", ["node", "cli", "--yes", "configure", "codex"]],
    ["command-local", ["node", "cli", "configure", "codex", "--yes"]]
  ])("honors %s --yes while configuring defaults", async (_label, argv) => {
    const prompts = vi.fn().mockRejectedValue(new Error("prompt should not be called"));
    const container = createContainer(fs, { POE_API_KEY: "sk-env" }, prompts);
    vi.spyOn(container.providerRegistry, "resolveCredential").mockImplementation(
      async (_id, options) => options?.apiKey ?? "sk-test"
    );
    vi.spyOn(container.options, "resolveApiKey").mockResolvedValue("sk-test");
    const resolveModelSpy = vi.spyOn(container.options, "resolveModel").mockImplementation(
      async ({ defaultValue }) => defaultValue
    );
    vi.spyOn(container.options, "resolveReasoning").mockImplementation(async ({ value }) => value);
    stubInvoke(container);

    const program = createBaseProgram();
    registerConfigureCommand(program, container);
    await program.parseAsync(argv);

    expect(resolveModelSpy).not.toHaveBeenCalled();
    expect(prompts).not.toHaveBeenCalled();
  });

  it("does not prompt for Codex reasoning effort without --yes", async () => {
    const prompts = vi.fn().mockRejectedValue(new Error("prompt should not be called"));
    const container = createContainer(fs, { POE_API_KEY: "sk-env" }, prompts);
    vi.spyOn(container.providerRegistry, "resolveCredential").mockImplementation(
      async (_id, options) => options?.apiKey ?? "sk-test"
    );
    vi.spyOn(container.options, "resolveApiKey").mockResolvedValue("sk-test");
    vi.spyOn(container.options, "resolveModel").mockImplementation(
      async ({ defaultValue }) => defaultValue
    );
    stubInvoke(container);

    const program = createBaseProgram();
    registerConfigureCommand(program, container);
    await program.parseAsync(["node", "cli", "configure", "codex"]);

    expect(prompts).not.toHaveBeenCalled();
  });

  it("keeps claude-code on Poe with --yes when only POE_API_KEY is set", async () => {
    const container = createContainer(fs, { POE_API_KEY: "sk-env" });
    mockOptions(container);

    await executeConfigure(
      createTestProgram(["node", "cli", "--yes"]),
      container,
      "claude-code",
      {}
    );

    const settings = JSON.parse(await fs.readFile(`${homeDir}/.claude/settings.json`, "utf8"));
    expect(settings.env.ANTHROPIC_BASE_URL).toBe("https://api.poe.com");
    expect(settings.env.ANTHROPIC_API_KEY).toBe("sk-test");
    expect(settings.env.ANTHROPIC_CUSTOM_HEADERS).toBeUndefined();

    const services = await loadConfiguredServices({ fs, filePath: configPath });
    expect(services["claude-code"]?.provider).toBe(PROVIDER_NAME);
  });

  it("configures claude-code against Anthropic after provider login", async () => {
    const container = createContainer(fs);
    const providerProgram = createTestProgram(["node", "cli", "--yes"]);
    registerProviderCommand(providerProgram, container);

    await providerProgram.parseAsync([
      "node",
      "cli",
      "--yes",
      "provider",
      "login",
      "anthropic",
      "--api-key",
      "sk-ant-test"
    ]);

    await executeConfigure(createTestProgram(["node", "cli", "--yes"]), container, "claude-code", {
      provider: "anthropic"
    });

    const settings = JSON.parse(await fs.readFile(`${homeDir}/.claude/settings.json`, "utf8"));
    expect(settings.env.ANTHROPIC_BASE_URL).toBe("https://api.anthropic.com");

    const services = await loadConfiguredServices({ fs, filePath: configPath });
    expect(services["claude-code"]).toMatchObject({
      provider: "anthropic",
      apiShape: "anthropic-messages"
    });
  });

  it("auto-selects Anthropic when Anthropic is the only logged-in compatible provider", async () => {
    const container = createContainer(fs);
    const providerProgram = createTestProgram(["node", "cli", "--yes"]);
    registerProviderCommand(providerProgram, container);

    await providerProgram.parseAsync([
      "node",
      "cli",
      "--yes",
      "provider",
      "login",
      "anthropic",
      "--api-key",
      "sk-ant-test"
    ]);

    await executeConfigure(
      createTestProgram(["node", "cli", "--yes"]),
      container,
      "claude-code",
      {}
    );

    const settings = JSON.parse(await fs.readFile(`${homeDir}/.claude/settings.json`, "utf8"));
    expect(settings.env.ANTHROPIC_BASE_URL).toBe("https://api.anthropic.com");

    const services = await loadConfiguredServices({ fs, filePath: configPath });
    expect(services["claude-code"]).toMatchObject({
      provider: "anthropic",
      apiShape: "anthropic-messages"
    });
  });

  it("configures Anthropic with an explicit API key without using Poe key validation", async () => {
    const container = createContainer(fs);

    await executeConfigure(createTestProgram(["node", "cli", "--yes"]), container, "claude-code", {
      provider: "anthropic",
      apiKey: "sk-ant-test"
    });

    const settings = JSON.parse(await fs.readFile(`${homeDir}/.claude/settings.json`, "utf8"));
    expect(settings.env.ANTHROPIC_BASE_URL).toBe("https://api.anthropic.com");

    const services = await loadConfiguredServices({ fs, filePath: configPath });
    expect(services["claude-code"]).toMatchObject({
      provider: "anthropic",
      apiShape: "anthropic-messages"
    });
  });

  it("rejects Cloudflare configure when no base URL is provided", async () => {
    const container = createContainer(fs, { CF_AIG_TOKEN: "sk-cloudflare-test" });

    await expect(
      executeConfigure(createTestProgram(["node", "cli", "--yes"]), container, "claude-code", {
        provider: "cloudflare"
      })
    ).rejects.toThrow(/Provider "cloudflare" requires a base URL for API shape "anthropic-messages"./);
  });

  it("does not prompt for Cloudflare provider setup while configuring an agent", async () => {
    const prompts = vi.fn().mockResolvedValue({});
    const container = createContainer(fs, { CF_AIG_TOKEN: "sk-cloudflare-env" }, prompts);

    await expect(
      executeConfigure(createTestProgram(), container, "codex", {
        provider: "cloudflare"
      })
    ).rejects.toThrow(/Provider "cloudflare" requires a base URL for API shape "openai-responses"./);

    expect(prompts).not.toHaveBeenCalledWith(
      expect.objectContaining({ name: "baseUrl" })
    );
  });

  it("rejects Cloudflare configure when the provided base URL is not a URL", async () => {
    const container = createContainer(fs);

    await expect(
      executeConfigure(createTestProgram(["node", "cli", "--yes"]), container, "codex", {
        provider: "cloudflare",
        apiKey: "sk-cloudflare-test",
        baseUrl: "not-a-url"
      })
    ).rejects.toThrow('Provider "cloudflare" base URL must be an http(s) URL.');
  });

  it("configures Codex against Cloudflare without requiring a model", async () => {
    const container = createContainer(fs);

    await executeConfigure(createTestProgram(["node", "cli", "--yes"]), container, "codex", {
      provider: "cloudflare",
      apiKey: "sk-cloudflare-test",
      baseUrl:
        "https://gateway.ai.cloudflare.com/v1/fdb283a7279a7b4d1f3577dbb2089ff2/poe-ai-gateway/"
    });

    const document = parseToml(await fs.readFile(`${homeDir}/.codex/config.toml`, "utf8"));
    expect(document.model_provider).toBe("cloudflare");
    expect(document.model).toBeUndefined();
  });

  it("configures claude-code against Cloudflare with an explicit matching base URL", async () => {
    const container = createContainer(fs);

    await executeConfigure(createTestProgram(["node", "cli", "--yes"]), container, "claude-code", {
      provider: "cloudflare",
      apiKey: "sk-cloudflare-test",
      baseUrl:
        "https://gateway.ai.cloudflare.com/v1/fdb283a7279a7b4d1f3577dbb2089ff2/poe-ai-gateway/"
    });

    const settings = JSON.parse(await fs.readFile(`${homeDir}/.claude/settings.json`, "utf8"));
    expect(settings.env.ANTHROPIC_BASE_URL).toBe(
      "https://gateway.ai.cloudflare.com/v1/fdb283a7279a7b4d1f3577dbb2089ff2/poe-ai-gateway/anthropic"
    );
    expect(settings.env.ANTHROPIC_CUSTOM_HEADERS).toBe(
      "Authorization: Bearer sk-cloudflare-test"
    );
    expect(settings.env.ANTHROPIC_API_KEY).toBeUndefined();
    expect(settings.apiKeyHelper).toBeUndefined();

    const services = await loadConfiguredServices({ fs, filePath: configPath });
    expect(services["claude-code"]).toMatchObject({
      provider: "cloudflare",
      apiShape: "anthropic-messages"
    });
  });

  it("configures codex against Cloudflare with an explicit matching base URL", async () => {
    const container = createContainer(fs);

    await executeConfigure(createTestProgram(["node", "cli", "--yes"]), container, "codex", {
      provider: "cloudflare",
      apiKey: "sk-cloudflare-test",
      baseUrl:
        "https://gateway.ai.cloudflare.com/v1/fdb283a7279a7b4d1f3577dbb2089ff2/poe-ai-gateway/"
    });

    const document = parseToml(await fs.readFile(`${homeDir}/.codex/config.toml`, "utf8"));
    expect(document.model_provider).toBe("cloudflare");
    const providers = document.model_providers as Record<string, Record<string, unknown>>;
    expect(providers.cloudflare?.base_url).toBe(
      "https://gateway.ai.cloudflare.com/v1/fdb283a7279a7b4d1f3577dbb2089ff2/poe-ai-gateway/openai"
    );

    const services = await loadConfiguredServices({ fs, filePath: configPath });
    expect(services.codex).toMatchObject({
      provider: "cloudflare",
      apiShape: "openai-responses"
    });
  });

  it("prompts for an explicit OpenAI provider API key even with --yes", async () => {
    const commandRunner = vi.fn(async () => ({ stdout: "", stderr: "", exitCode: 0 }));
    const prompts = vi.fn().mockImplementation(async (descriptor) => {
      if (descriptor.name === "apiKey") {
        return { apiKey: "sk-openai-test" };
      }
      throw new Error(`Unexpected prompt: ${descriptor.name}`);
    });
    const container = createContainer(fs, {}, prompts, commandRunner);

    await executeConfigure(createTestProgram(["node", "cli", "--yes"]), container, "codex", {
      provider: "openai"
    });

    expect(prompts).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "apiKey",
        message: "OpenAI API key",
        type: "password"
      })
    );
    const document = parseToml(await fs.readFile(`${homeDir}/.codex/config.toml`, "utf8"));
    expect(document.model_provider).toBe("openai");
    expect(document.forced_login_method).toBe("api");
    expect(document.model).toBeUndefined();
    expect(document.model_providers).toBeUndefined();
    expect(commandRunner).toHaveBeenCalledWith(
      "codex",
      ["login", "--with-api-key"],
      expect.objectContaining({
        env: { CODEX_HOME: `${homeDir}/.codex` },
        stdin: "sk-openai-test"
      })
    );
    expect(commandRunner).toHaveBeenCalledWith(
      "codex",
      ["login", "--with-api-key"],
      expect.objectContaining({
        env: { CODEX_HOME: `${homeDir}/.poe-code/codex` },
        stdin: "sk-openai-test"
      })
    );
  });

  it("does not prompt for or write a default Codex model when none is supplied", async () => {
    const commandRunner = vi.fn(async () => ({ stdout: "", stderr: "", exitCode: 0 }));
    const prompts = vi.fn().mockRejectedValue(new Error("prompt should not be called"));
    const container = createContainer(
      fs,
      { OPENAI_API_KEY: "sk-openai-env" },
      prompts,
      commandRunner
    );
    const resolveModelSpy = vi.spyOn(container.options, "resolveModel");

    await executeConfigure(createTestProgram(["node", "cli", "--yes"]), container, "codex", {
      provider: "openai"
    });

    expect(resolveModelSpy).not.toHaveBeenCalled();
    expect(prompts).not.toHaveBeenCalled();
    const rawConfig = await fs.readFile(`${homeDir}/.codex/config.toml`, "utf8");
    expect(rawConfig).toMatchInlineSnapshot(`
      "model_provider = "openai"
      forced_login_method = "api"
      "
    `);
    const document = parseToml(rawConfig);
    expect(document.model_provider).toBe("openai");
    expect(document.forced_login_method).toBe("api");
    expect(document.model).toBeUndefined();
    expect(document.model_reasoning_effort).toBeUndefined();
    expect(document.model_providers).toBeUndefined();
    expect(document.profiles).toBeUndefined();
    expect(commandRunner).toHaveBeenCalledWith(
      "codex",
      ["login", "--with-api-key"],
      expect.objectContaining({ stdin: "sk-openai-env" })
    );
    expect(commandRunner.mock.calls.flatMap((call) => call[1])).not.toContain("sk-openai-env");
  });

  it("writes explicit Codex reasoning effort when supplied", async () => {
    const commandRunner = vi.fn(async () => ({ stdout: "", stderr: "", exitCode: 0 }));
    const prompts = vi.fn().mockRejectedValue(new Error("prompt should not be called"));
    const container = createContainer(
      fs,
      { OPENAI_API_KEY: "sk-openai-env" },
      prompts,
      commandRunner
    );

    await executeConfigure(createTestProgram(["node", "cli", "--yes"]), container, "codex", {
      provider: "openai",
      reasoningEffort: "high"
    });

    expect(prompts).not.toHaveBeenCalled();
    const document = parseToml(await fs.readFile(`${homeDir}/.codex/config.toml`, "utf8"));
    expect(document.model_reasoning_effort).toBe("high");
    expect(document.profiles).toBeUndefined();
  });

  it("does not persist global codex configuration when isolated setup fails", async () => {
    const container = createContainer(fs);
    await fs.mkdir(`${homeDir}/.poe-code`, { recursive: true });
    await fs.writeFile(`${homeDir}/.poe-code/codex`, "block isolated directory", {
      encoding: "utf8"
    });

    await expect(
      executeConfigure(createTestProgram(["node", "cli", "--yes"]), container, "codex", {
        provider: "cloudflare",
        apiKey: "partial-secret",
        baseUrl: "https://gateway.example.test"
      })
    ).rejects.toThrow();

    await expect(fs.readFile(`${homeDir}/.codex/config.toml`, "utf8")).rejects.toThrow();
    expect(await loadConfiguredServices({ fs, filePath: configPath })).not.toHaveProperty("codex");
    await expect(container.providerRegistry.resolveCredential("cloudflare")).rejects.toThrow();
  });

  it("stores explicit credentials when isolated configuration needs future repair", async () => {
    const container = createContainer(fs);

    await executeConfigure(createTestProgram(["node", "cli", "--yes"]), container, "codex", {
      provider: "cloudflare",
      apiKey: "sk-cloudflare-test",
      baseUrl: "https://gateway.example.test"
    });

    await expect(container.providerRegistry.resolveCredential("cloudflare")).resolves.toBe("sk-cloudflare-test");
  });

  it("stores isolated explicit credentials when no transactional credential store is available", async () => {
    const container = createContainer(fs);
    vi.spyOn(container, "createPreviewProviderStore").mockReturnValue(undefined);
    const loginSpy = vi.spyOn(container.providerRegistry, "login").mockResolvedValue();

    await executeConfigure(createTestProgram(["node", "cli", "--yes"]), container, "codex", {
      provider: "cloudflare",
      apiKey: "sk-cloudflare-test",
      baseUrl: "https://gateway.example.test"
    });

    expect(loginSpy).toHaveBeenCalledWith("cloudflare", { apiKey: "sk-cloudflare-test" });
  });

  it("repairs isolated configuration configured with an explicit provider credential", async () => {
    const container = createContainer(fs);

    await executeConfigure(createTestProgram(["node", "cli", "--yes"]), container, "codex", {
      provider: "cloudflare",
      apiKey: "sk-cloudflare-test",
      baseUrl: "https://gateway.example.test"
    });
    await fs.unlink(`${homeDir}/.poe-code/codex/config.toml`);

    await ensureIsolatedConfigForService({
      container,
      adapter: container.registry.require("codex"),
      service: "codex",
      flags: { dryRun: false, assumeYes: true, verbose: false }
    });

    const document = parseToml(await fs.readFile(`${homeDir}/.poe-code/codex/config.toml`, "utf8"));
    expect(document.model).toBeUndefined();
  });

  it("configures chat-completions agents against Cloudflare with a /compat base URL", async () => {
    const container = createContainer(fs);

    await executeConfigure(createTestProgram(["node", "cli", "--yes"]), container, "kimi", {
      provider: "cloudflare",
      apiKey: "sk-cloudflare-test",
      baseUrl:
        "https://gateway.ai.cloudflare.com/v1/fdb283a7279a7b4d1f3577dbb2089ff2/poe-ai-gateway/"
    });

    const document = parseToml(await fs.readFile(`${homeDir}/.kimi/config.toml`, "utf8"));
    const providers = document.providers as Record<string, Record<string, unknown>>;
    expect(providers[PROVIDER_NAME]?.base_url).toBe(
      "https://gateway.ai.cloudflare.com/v1/fdb283a7279a7b4d1f3577dbb2089ff2/poe-ai-gateway/compat"
    );

    const services = await loadConfiguredServices({ fs, filePath: configPath });
    expect(services.kimi).toMatchObject({
      provider: "cloudflare",
      apiShape: "openai-chat-completions"
    });
  });

  it("strips a trailing /compat from Cloudflare base URLs before appending the shape path", async () => {
    const container = createContainer(fs);

    await executeConfigure(createTestProgram(["node", "cli", "--yes"]), container, "codex", {
      provider: "cloudflare",
      apiKey: "sk-cloudflare-test",
      baseUrl:
        "https://gateway.ai.cloudflare.com/v1/fdb283a7279a7b4d1f3577dbb2089ff2/poe-ai-gateway/compat"
    });

    const document = parseToml(await fs.readFile(`${homeDir}/.codex/config.toml`, "utf8"));
    const providers = document.model_providers as Record<string, Record<string, unknown>>;
    expect(providers.cloudflare?.base_url).toBe(
      "https://gateway.ai.cloudflare.com/v1/fdb283a7279a7b4d1f3577dbb2089ff2/poe-ai-gateway/openai"
    );
  });

  it("uses the Cloudflare base URL environment variable when no base URL flag is provided", async () => {
    const container = createContainer(fs, {
      CF_AIG_BASE_URL:
        "https://gateway.ai.cloudflare.com/v1/fdb283a7279a7b4d1f3577dbb2089ff2/poe-ai-gateway/",
      CF_AIG_TOKEN: "sk-cloudflare-test"
    });

    await executeConfigure(createTestProgram(["node", "cli", "--yes"]), container, "codex", {
      provider: "cloudflare",
    });

    const document = parseToml(await fs.readFile(`${homeDir}/.codex/config.toml`, "utf8"));
    const providers = document.model_providers as Record<string, Record<string, unknown>>;
    expect(providers.cloudflare?.base_url).toBe(
      "https://gateway.ai.cloudflare.com/v1/fdb283a7279a7b4d1f3577dbb2089ff2/poe-ai-gateway/openai"
    );
  });

  it("keeps claude-code on Poe with --yes when POE_API_KEY is set but CF_AIG_TOKEN is unset", async () => {
    const container = createContainer(fs, { POE_API_KEY: "sk-env" });
    mockOptions(container);

    await executeConfigure(
      createTestProgram(["node", "cli", "--yes"]),
      container,
      "claude-code",
      {}
    );

    const settings = JSON.parse(await fs.readFile(`${homeDir}/.claude/settings.json`, "utf8"));
    expect(settings.env.ANTHROPIC_BASE_URL).toBe("https://api.poe.com");

    const services = await loadConfiguredServices({ fs, filePath: configPath });
    expect(services["claude-code"]?.provider).toBe(PROVIDER_NAME);
  });

  it("requires --provider with --yes when Poe and Cloudflare env credentials are both set", async () => {
    const container = createContainer(fs, {
      POE_API_KEY: "sk-poe-env",
      CF_AIG_TOKEN: "sk-cloudflare-env"
    });

    await expect(
      executeConfigure(createTestProgram(["node", "cli", "--yes"]), container, "claude-code", {})
    ).rejects.toThrow(/--provider/);
  });

  it("prompts when >1 eligible providers are logged in", async () => {
    const fakeAnthropicProvider = createFakeProvider("anthropic", "Anthropic");
    const promptsMock = vi.fn().mockResolvedValue({ serviceSelection: "anthropic" });
    const container = createCliContainer({
      fs,
      prompts: promptsMock,
      env: { cwd, homeDir, variables: {} },
      logger: () => {}
    });
    includeFakeProvider(container, fakeAnthropicProvider);
    mockOptions(container);
    vi.spyOn(container.providerRegistry, "forAgent").mockReturnValue([
      ...container.providerRegistry.forAgent(claudeCodeAgent),
      fakeAnthropicProvider
    ]);
    vi.spyOn(container.providerRegistry, "isLoggedIn").mockResolvedValue(true);
    stubInvoke(container);

    await executeConfigure(createTestProgram(), container, "claude-code", {});

    const services = await loadConfiguredServices({ fs, filePath: configPath });
    expect(services["claude-code"]?.provider).toBe("anthropic");
    expect(promptsMock).toHaveBeenCalledWith(expect.objectContaining({ name: "serviceSelection" }));
  });

  it("triggers login when the only candidate is not logged in", async () => {
    const container = createContainer(fs);
    mockOptions(container);
    useOnlyPoeCandidate(container);
    vi.spyOn(container.providerRegistry, "isLoggedIn").mockResolvedValue(false);
    const loginSpy = vi.spyOn(container.providerRegistry, "login").mockResolvedValue();
    stubInvoke(container);

    await executeConfigure(createTestProgram(), container, "claude-code", {
      apiKey: "sk-fresh"
    });

    expect(loginSpy).toHaveBeenCalledWith("poe", { apiKey: "sk-fresh" }, expect.any(Object));
    const services = await loadConfiguredServices({ fs, filePath: configPath });
    expect(services["claude-code"]?.provider).toBe(PROVIDER_NAME);
  });

  it("uses the OAuth-capable Poe resolver when the only candidate is not logged in", async () => {
    const container = createContainer(fs);
    const resolveApiKeySpy = vi
      .spyOn(container.options, "resolveApiKey")
      .mockResolvedValue("sk-oauth");
    vi.spyOn(container.options, "resolveModel").mockImplementation(
      async ({ defaultValue }) => defaultValue
    );
    useOnlyPoeCandidate(container);
    vi.spyOn(container.providerRegistry, "isLoggedIn").mockResolvedValue(false);
    stubInvoke(container);

    await executeConfigure(createTestProgram(), container, "claude-code", {});

    expect(resolveApiKeySpy).toHaveBeenCalledWith(
      expect.objectContaining({
        allowStored: false,
        value: undefined
      })
    );
  });

  it("prompts to pick a provider then triggers login when none logged in", async () => {
    const fakeAnthropicProvider = createFakeProvider("anthropic", "Anthropic");
    const promptsMock = vi.fn().mockResolvedValue({ serviceSelection: "anthropic" });
    const container = createCliContainer({
      fs,
      prompts: promptsMock,
      env: { cwd, homeDir, variables: {} },
      logger: () => {}
    });
    includeFakeProvider(container, fakeAnthropicProvider);
    mockOptions(container);
    vi.spyOn(container.providerRegistry, "forAgent").mockReturnValue([
      ...container.providerRegistry.forAgent(claudeCodeAgent),
      fakeAnthropicProvider
    ]);
    vi.spyOn(container.providerRegistry, "isLoggedIn").mockResolvedValue(false);
    const loginSpy = vi.spyOn(container.providerRegistry, "login").mockResolvedValue();
    stubInvoke(container);

    await executeConfigure(createTestProgram(), container, "claude-code", {});

    expect(promptsMock).toHaveBeenCalledWith(expect.objectContaining({ name: "serviceSelection" }));
    expect(loginSpy).toHaveBeenCalledWith("anthropic", { apiKey: undefined }, expect.any(Object));
    const services = await loadConfiguredServices({ fs, filePath: configPath });
    expect(services["claude-code"]?.provider).toBe("anthropic");
  });

  it("errors with --yes when no provider is logged in", async () => {
    const container = createContainer(fs);
    mockOptions(container);
    vi.spyOn(container.providerRegistry, "isLoggedIn").mockResolvedValue(false);
    stubInvoke(container);

    await expect(
      executeConfigure(createTestProgram(["node", "cli", "--yes"]), container, "claude-code", {})
    ).rejects.toThrow(/No logged-in providers/);
  });

  it("uses an explicit api key for --provider without storing provider login", async () => {
    const fakeAnthropicProvider = createFakeProvider("anthropic", "Anthropic");
    const container = createContainer(fs);
    includeFakeProvider(container, fakeAnthropicProvider);
    mockOptions(container);
    vi.spyOn(container.providerRegistry, "forAgent").mockReturnValue([
      ...container.providerRegistry.forAgent(claudeCodeAgent),
      fakeAnthropicProvider
    ]);
    vi.spyOn(container.providerRegistry, "isLoggedIn").mockResolvedValue(false);
    const loginSpy = vi.spyOn(container.providerRegistry, "login").mockResolvedValue();
    stubInvoke(container);

    await executeConfigure(createTestProgram(), container, "claude-code", {
      provider: "anthropic",
      apiKey: "sk-fresh"
    });

    expect(loginSpy).not.toHaveBeenCalled();
  });

  it("dry-run succeeds without any logged-in provider", async () => {
    const container = createContainer(fs);
    mockOptions(container);
    vi.spyOn(container.providerRegistry, "isLoggedIn").mockResolvedValue(false);
    stubInvoke(container);

    await expect(
      executeConfigure(
        createTestProgram(["node", "cli", "--dry-run", "--yes"]),
        container,
        "claude-code",
        {}
      )
    ).resolves.not.toThrow();
  });

  it("does not acquire or validate Poe credentials in an explicit dry-run preview", async () => {
    const container = createContainer(fs);
    useOnlyPoeCandidate(container);
    const resolveApiKey = vi.spyOn(container.options, "resolveApiKey");
    stubInvoke(container);

    await executeConfigure(
      createTestProgram(["node", "cli", "--dry-run", "--yes"]),
      container,
      "claude-code",
      { provider: "poe", apiKey: "secret-key" }
    );

    expect(resolveApiKey).not.toHaveBeenCalled();
  });

  it.each([
    ["--api-key", { provider: "poe", apiKey: "" }, "--api-key cannot be empty."],
    ["whitespace-only --api-key", { provider: "poe", apiKey: "  " }, "--api-key cannot be empty."],
    ["--model", { provider: "poe", model: "" }, "--model cannot be empty."],
    ["whitespace-only --model", { provider: "poe", model: " \t " }, "--model cannot be empty."]
  ])("rejects an empty %s instead of previewing a configure", async (_name, options, message) => {
    const container = createContainer(fs);
    useOnlyPoeCandidate(container);
    const invoke = vi.spyOn(container.registry, "invoke");

    await expect(
      executeConfigure(
        createTestProgram(["node", "cli", "--dry-run", "--yes"]),
        container,
        "claude-code",
        options
      )
    ).rejects.toThrow(message);
    expect(invoke).not.toHaveBeenCalled();
  });

  it("does not recover malformed config while selecting a default agent in dry-run mode", async () => {
    const malformedConfig = "{ invalid json\n";
    await fs.mkdir(path.dirname(configPath), { recursive: true });
    await fs.writeFile(configPath, malformedConfig, { encoding: "utf8" });
    const container = createContainer(fs);
    const program = createBaseProgram();
    registerConfigureCommand(program, container);

    await expect(
      program.parseAsync([
        "node",
        "cli",
        "--dry-run",
        "--yes",
        "configure",
        "--provider",
        "poe",
        "--api-key",
        "probe-key",
        "--model",
        "test-model"
      ])
    ).rejects.toThrow();

    await expect(fs.readFile(configPath, "utf8")).resolves.toBe(malformedConfig);
    await expect(fs.readdir(path.dirname(configPath))).resolves.toEqual(["config.json"]);
  });

  it("honors the --provider flag", async () => {
    const fakeAnthropicProvider = createFakeProvider("anthropic", "Anthropic");
    const container = createContainer(fs);
    includeFakeProvider(container, fakeAnthropicProvider);
    mockOptions(container);
    vi.spyOn(container.providerRegistry, "isLoggedIn").mockResolvedValue(true);
    stubInvoke(container);

    await executeConfigure(createTestProgram(), container, "claude-code", {
      provider: "anthropic"
    });

    const services = await loadConfiguredServices({ fs, filePath: configPath });
    expect(services["claude-code"]?.provider).toBe("anthropic");
  });

  it("honors the POE_CODE_PROVIDER env var", async () => {
    const fakeAnthropicProvider = createFakeProvider("anthropic", "Anthropic");
    const container = createContainer(fs, { POE_CODE_PROVIDER: "anthropic" });
    includeFakeProvider(container, fakeAnthropicProvider);
    mockOptions(container);
    vi.spyOn(container.providerRegistry, "isLoggedIn").mockResolvedValue(true);
    stubInvoke(container);

    await executeConfigure(createTestProgram(), container, "claude-code", {});

    const services = await loadConfiguredServices({ fs, filePath: configPath });
    expect(services["claude-code"]?.provider).toBe("anthropic");
  });

  it("--flag takes precedence over POE_CODE_PROVIDER env var", async () => {
    const container = createContainer(fs, { POE_CODE_PROVIDER: "anthropic" });
    mockOptions(container);
    vi.spyOn(container.providerRegistry, "isLoggedIn").mockResolvedValue(true);
    stubInvoke(container);

    await executeConfigure(createTestProgram(), container, "claude-code", {
      provider: "poe"
    });

    const services = await loadConfiguredServices({ fs, filePath: configPath });
    expect(services["claude-code"]?.provider).toBe(PROVIDER_NAME);
  });

  it("errors when --yes is given with >1 eligible providers and no flag or env", async () => {
    const fakeAnthropicProvider = createFakeProvider("anthropic", "Anthropic");
    const container = createContainer(fs);
    mockOptions(container);
    vi.spyOn(container.providerRegistry, "forAgent").mockReturnValue([
      ...container.providerRegistry.forAgent(claudeCodeAgent),
      fakeAnthropicProvider
    ]);
    vi.spyOn(container.providerRegistry, "isLoggedIn").mockResolvedValue(true);
    stubInvoke(container);

    await expect(
      executeConfigure(createTestProgram(["node", "cli", "--yes"]), container, "claude-code", {})
    ).rejects.toThrow(/--provider/);
  });

  it("snapshots the explicit incompatible provider error", async () => {
    const openaiProvider = createOpenAiProvider();
    const container = createContainer(fs);
    includeFakeProvider(container, openaiProvider);
    mockOptions(container);

    const message = await captureError(() =>
      executeConfigure(createTestProgram(["node", "cli", "--yes"]), container, "claude-code", {
        provider: "openai",
        apiKey: "sk-openai-test"
      })
    );

    expect(message).toMatchInlineSnapshot(`
      "Error: Provider "openai" cannot configure claude-code.
      claude-code requires one of: messages.
      openai provides: responses, chat-completions."
    `);
  });

  it("snapshots the non-interactive provider ambiguity error", async () => {
    const container = createContainer(fs);
    const poeProvider = container.providerRegistry.get("poe");
    const anthropicProvider = container.providerRegistry.get("anthropic");
    if (!poeProvider || !anthropicProvider) {
      throw new Error("Expected Poe and Anthropic providers to be registered.");
    }
    vi.spyOn(container.providerRegistry, "forAgent").mockReturnValue([
      poeProvider,
      anthropicProvider
    ]);
    vi.spyOn(container.providerRegistry, "isLoggedIn").mockImplementation(
      async (id) => id === "poe" || id === "anthropic"
    );
    stubInvoke(container);

    const message = await captureError(() =>
      executeConfigure(createTestProgram(["node", "cli", "--yes"]), container, "claude-code", {})
    );

    expect(message).toMatchInlineSnapshot(`
      "Error: claude-code can be configured with multiple providers.
      Pass --provider.

      Compatible providers:
        poe
        anthropic"
    `);
  });

  it("persists the resolved provider in services.json", async () => {
    const container = createContainer(fs);
    mockOptions(container);
    vi.spyOn(container.providerRegistry, "isLoggedIn").mockImplementation(
      async (id) => id === "poe"
    );
    stubInvoke(container);

    await executeConfigure(createTestProgram(), container, "claude-code", {});

    const saved = JSON.parse(await fs.readFile(configPath, "utf8"));
    expect(saved.configured_services["claude-code"]).toMatchObject({
      provider: "poe",
      apiShape: "anthropic-messages"
    });
  });

  it("uses the stored login shape base URL when configuring an agent", async () => {
    const container = createContainer(fs);
    mockOptions(container);
    const capture = stubInvokeAndCaptureProvider(container);
    const providerProgram = createTestProgram(["node", "cli", "--yes"]);
    registerProviderCommand(providerProgram, container);

    await providerProgram.parseAsync([
      "node",
      "cli",
      "--yes",
      "provider",
      "login",
      "poe",
      "--shape-base-url",
      "anthropic-messages=https://example/anth"
    ]);

    await executeConfigure(createTestProgram(["node", "cli", "--yes"]), container, "claude-code", {
      provider: "poe"
    });

    expect(capture.provider()?.baseUrl).toBe("https://example/anth");
  });

  it("uses explicit --base-url before a stored shape base URL", async () => {
    const container = createContainer(fs);
    mockOptions(container);
    vi.spyOn(container.providerRegistry, "isLoggedIn").mockResolvedValue(true);
    const capture = stubInvokeAndCaptureProvider(container);
    const providerProgram = createTestProgram(["node", "cli", "--yes"]);
    registerProviderCommand(providerProgram, container);

    await providerProgram.parseAsync([
      "node",
      "cli",
      "--yes",
      "provider",
      "login",
      "poe",
      "--shape-base-url",
      "anthropic-messages=https://stored.example/anth"
    ]);

    const program = createBaseProgram();
    registerConfigureCommand(program, container);
    await program.parseAsync([
      "node",
      "cli",
      "--yes",
      "configure",
      "claude-code",
      "--provider",
      "poe",
      "--base-url",
      "https://explicit.example/anth"
    ]);

    expect(capture.provider()?.baseUrl).toBe("https://explicit.example/anth");
  });

  it("normalizes explicit Poe --base-url through the resolved API shape path", async () => {
    const container = createContainer(fs);
    mockOptions(container);
    vi.spyOn(container.providerRegistry, "isLoggedIn").mockResolvedValue(true);
    const capture = stubInvokeAndCaptureProvider(container);

    const program = createBaseProgram();
    registerConfigureCommand(program, container);
    await program.parseAsync([
      "node",
      "cli",
      "--yes",
      "configure",
      "claude-code",
      "--provider",
      "poe",
      "--base-url",
      "https://proxy.example/v1"
    ]);

    expect(capture.provider()).toMatchObject({
      baseUrl: "https://proxy.example/anthropic",
      agentBaseUrl: "https://proxy.example"
    });
  });

  it("applies explicit --base-url to the agent base URL", async () => {
    const container = createContainer(fs);
    mockOptions(container);
    vi.spyOn(container.providerRegistry, "isLoggedIn").mockResolvedValue(true);
    const capture = stubInvokeAndCaptureProvider(container);

    const program = createBaseProgram();
    registerConfigureCommand(program, container);
    await program.parseAsync([
      "node",
      "cli",
      "--yes",
      "configure",
      "claude-code",
      "--provider",
      "poe",
      "--base-url",
      "https://example.invalid"
    ]);

    expect(capture.provider()?.agentBaseUrl).toBe("https://example.invalid");
  });

  it("applies explicit --shape-base-url to the agent base URL for the resolved shape", async () => {
    const container = createContainer(fs);
    mockOptions(container);
    vi.spyOn(container.providerRegistry, "isLoggedIn").mockResolvedValue(true);
    const capture = stubInvokeAndCaptureProvider(container);

    const program = createBaseProgram();
    registerConfigureCommand(program, container);
    await program.parseAsync([
      "node",
      "cli",
      "--yes",
      "configure",
      "claude-code",
      "--provider",
      "poe",
      "--base-url",
      "https://generic.example/anth",
      "--shape-base-url",
      "anthropic-messages=https://shape.example/anth"
    ]);

    expect(capture.provider()?.agentBaseUrl).toBe("https://shape.example/anth");
  });

  it("prefers an explicit --base-url over POE_BASE_URL for the agent base URL", async () => {
    const container = createContainer(fs, {
      POE_API_KEY: "sk-env",
      POE_BASE_URL: "https://env.example/v1"
    });
    mockOptions(container);
    const capture = stubInvokeAndCaptureProvider(container);

    await executeConfigure(createTestProgram(["node", "cli", "--yes"]), container, "claude-code", {
      provider: "poe",
      baseUrl: "https://flag.example"
    });

    expect(capture.provider()?.agentBaseUrl).toBe("https://flag.example");
  });

  it("uses explicit --shape-base-url before --base-url for the resolved shape", async () => {
    const container = createContainer(fs);
    mockOptions(container);
    vi.spyOn(container.providerRegistry, "isLoggedIn").mockResolvedValue(true);
    const capture = stubInvokeAndCaptureProvider(container);

    const program = createBaseProgram();
    registerConfigureCommand(program, container);
    await program.parseAsync([
      "node",
      "cli",
      "--yes",
      "configure",
      "claude-code",
      "--provider",
      "poe",
      "--base-url",
      "https://generic.example/anth",
      "--shape-base-url",
      "anthropic-messages=https://shape.example/anth"
    ]);

    expect(capture.provider()?.baseUrl).toBe("https://shape.example/anth");
  });

  it("derives Poe provider URLs from POE_BASE_URL", async () => {
    const container = createContainer(fs, {
      POE_API_KEY: "sk-env",
      POE_BASE_URL: "https://env.example/v1"
    });
    mockOptions(container);
    const capture = stubInvokeAndCaptureProvider(container);

    await executeConfigure(createTestProgram(["node", "cli", "--yes"]), container, "claude-code", {
      provider: "poe"
    });

    expect(capture.provider()).toMatchObject({
      baseUrl: "https://env.example/anthropic",
      agentBaseUrl: "https://env.example"
    });
  });

  it("derives Poe OpenAI URLs from POE_BASE_URL", async () => {
    const container = createContainer(fs, {
      POE_API_KEY: "sk-env",
      POE_BASE_URL: "https://env.example/v1"
    });
    mockOptions(container);
    const capture = stubInvokeAndCaptureProvider(container);

    await executeConfigure(createTestProgram(["node", "cli", "--yes"]), container, "codex", {
      provider: "poe"
    });

    expect(capture.provider()).toMatchObject({
      baseUrl: "https://env.example/v1",
      agentBaseUrl: "https://env.example"
    });
  });

  it("derives Poe OpenAI URLs from the provider default root", async () => {
    const container = createContainer(fs, { POE_API_KEY: "sk-env" });
    mockOptions(container);
    const capture = stubInvokeAndCaptureProvider(container);

    await executeConfigure(createTestProgram(["node", "cli", "--yes"]), container, "codex", {
      provider: "poe"
    });

    expect(capture.provider()).toMatchObject({
      baseUrl: "https://api.poe.com/v1",
      agentBaseUrl: "https://api.poe.com"
    });
  });

  it("rejects unknown configure --shape-base-url shape ids before writing", async () => {
    const container = createContainer(fs);
    mockOptions(container);
    vi.spyOn(container.providerRegistry, "isLoggedIn").mockResolvedValue(true);
    const invokeSpy = vi.spyOn(container.registry, "invoke");

    const program = createBaseProgram();
    registerConfigureCommand(program, container);

    await expect(
      program.parseAsync([
        "node",
        "cli",
        "--yes",
        "configure",
        "claude-code",
        "--provider",
        "poe",
        "--shape-base-url",
        "missing-shape=https://example/missing"
      ])
    ).rejects.toThrow(/Unknown API shape "missing-shape" for provider "poe"/);
    expect(invokeSpy).not.toHaveBeenCalled();
  });

  it("configures claude-code with the Poe key as ANTHROPIC_API_KEY", async () => {
    const container = createContainer(fs, { POE_API_KEY: "sk-test" });
    mockOptions(container);

    await executeConfigure(
      createTestProgram(["node", "cli", "--yes"]),
      container,
      "claude-code",
      {}
    );

    const actual = await fs.readFile(`${homeDir}/.claude/settings.json`, "utf8");
    const expected = await readFile(
      path.join(fixtureDir, "plan14-pre-phase4-claude-settings.json"),
      "utf8"
    );
    expect(actual).toBe(expected);
  });

  it("--skip-if-configured exits before writes when configure would only create a backup", async () => {
    const container = createContainer(fs, { POE_API_KEY: "sk-env" });
    mockOptions(container);

    await executeConfigure(createTestProgram(["node", "cli", "--yes"]), container, "codex", {
      provider: "poe"
    });

    const configFile = `${homeDir}/.codex/config.toml`;
    const before = await fs.readFile(configFile, "utf8");
    const writeSpy = vi.spyOn(fs, "writeFile");

    await executeConfigure(createTestProgram(["node", "cli", "--yes"]), container, "codex", {
      provider: "poe",
      skipIfConfigured: true
    });

    expect(writeSpy).not.toHaveBeenCalled();
    await expect(fs.readFile(configFile, "utf8")).resolves.toBe(before);
  });

  it("--skip-if-configured keeps an existing config whose model differs from the default", async () => {
    const container = createContainer(fs, { POE_API_KEY: "sk-env" });
    mockOptions(container);
    vi.spyOn(container.options, "resolveModel").mockImplementation(
      async ({ value, defaultValue }) => value ?? defaultValue
    );

    await executeConfigure(createTestProgram(["node", "cli", "--yes"]), container, "claude-code", {
      provider: "poe",
    });

    const settingsFile = `${homeDir}/.claude/settings.json`;
    const before = await fs.readFile(settingsFile, "utf8");
    const writeSpy = vi.spyOn(fs, "writeFile");
    const resolveModelSpy = vi.spyOn(container.options, "resolveModel");

    await executeConfigure(createTestProgram(["node", "cli", "--yes"]), container, "claude-code", {
      provider: "poe",
      skipIfConfigured: true
    });

    expect(writeSpy).not.toHaveBeenCalled();
    expect(resolveModelSpy).not.toHaveBeenCalled();
    await expect(fs.readFile(settingsFile, "utf8")).resolves.toBe(before);
  });

  it("--skip-if-configured --dry-run reports a skip instead of a default model rewrite", async () => {
    const lines: string[] = [];
    const container = createCliContainer({
      fs,
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir, variables: { POE_API_KEY: "sk-env" } },
      logger: (line) => {
        lines.push(line);
      }
    });
    mockOptions(container);
    vi.spyOn(container.options, "resolveModel").mockImplementation(
      async ({ value, defaultValue }) => value ?? defaultValue
    );

    await executeConfigure(createTestProgram(["node", "cli", "--yes"]), container, "claude-code", {
      provider: "poe",
    });

    lines.length = 0;

    await executeConfigure(
      createTestProgram(["node", "cli", "--yes", "--dry-run"]),
      container,
      "claude-code",
      { provider: "poe", skipIfConfigured: true }
    );

    const output = lines.join("\n");
    expect(output).toContain("already configured");
    expect(output).not.toContain("would configure");
  });

  it("explains that cursor writes no agent config files instead of only reporting success", async () => {
    const lines: string[] = [];
    const container = createCliContainer({
      fs,
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir, variables: {} },
      logger: (line) => {
        lines.push(line);
      }
    });
    mockOptions(container);

    await executeConfigure(
      createTestProgram(["node", "cli", "--yes", "--dry-run"]),
      container,
      "cursor",
      {}
    );

    const output = lines.join("\n");
    expect(output).toContain("cursor-agent login");
    expect(output).toContain("no configuration files");
  });

  it("keeps overlay symlinks staged until commit", async () => {
    const linkPath = `${homeDir}/links/current`;
    const targetPath = `${homeDir}/target`;
    const transaction = createOverlayFileSystem(fs);

    await fs.mkdir(path.dirname(linkPath), { recursive: true });
    await fs.writeFile(targetPath, "target", { encoding: "utf8" });
    await transaction.fs.symlink("../target", linkPath);

    await expect(fs.lstat(linkPath)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(transaction.fs.readlink(linkPath)).resolves.toBe("../target");
    await expect(transaction.hasMaterialChange()).resolves.toBe(true);

    await transaction.commit();

    expect((await fs.lstat(linkPath)).isSymbolicLink()).toBe(true);
    await expect(fs.readlink(linkPath)).resolves.toBe("../target");
  });

  it("replaces symlinked overlay targets without writing through them", async () => {
    const outsidePath = "/outside/config.toml";
    const configFile = `${homeDir}/.poe-code/config.toml`;
    const transaction = createOverlayFileSystem(fs);

    await fs.mkdir(path.dirname(outsidePath), { recursive: true });
    await fs.mkdir(path.dirname(configFile), { recursive: true });
    await fs.writeFile(outsidePath, "outside", { encoding: "utf8" });
    await fs.symlink(outsidePath, configFile);

    await transaction.fs.writeFile(configFile, "inside", { encoding: "utf8" });
    await transaction.commit();

    await expect(fs.readFile(outsidePath, "utf8")).resolves.toBe("outside");
    expect((await fs.lstat(configFile)).isSymbolicLink()).toBe(false);
    await expect(fs.readFile(configFile, "utf8")).resolves.toBe("inside");
  });

  it("removes partial overlay temps when base file writes fail", async () => {
    const configFile = `${homeDir}/.poe-code/config.toml`;
    const partialTemps: string[] = [];
    await fs.mkdir(path.dirname(configFile), { recursive: true });
    await fs.writeFile(configFile, "original", { encoding: "utf8" });
    const failingFs = withWriteFileOverride(fs, async (filePath, data, options) => {
      const filePathText = String(filePath);
      if (filePathText.startsWith(`${configFile}.overlay-tmp-${process.pid}-`)) {
        partialTemps.push(filePathText);
        await fs.writeFile(filePath, "partial", options);
        throw new Error("overlay write failed");
      }
      await fs.writeFile(filePath, data, options);
    });
    const transaction = createOverlayFileSystem(failingFs);

    await transaction.fs.writeFile(configFile, "inside", { encoding: "utf8" });

    await withObjectPrototypeCode("EEXIST", async () => {
      await expect(transaction.commit()).rejects.toThrow("overlay write failed");
    });

    expect(partialTemps.length).toBeGreaterThan(0);
    await expect(fs.readFile(configFile, "utf8")).resolves.toBe("original");
    for (const partialTemp of partialTemps) {
      await expect(fs.lstat(partialTemp)).rejects.toMatchObject({ code: "ENOENT" });
    }
  });

  it("restores original symlinks and removes staged temps when overlay commit fails", async () => {
    const outsidePath = "/outside/config.toml";
    const configFile = `${homeDir}/.poe-code/config.toml`;
    const laterFile = `${homeDir}/.poe-code/later.toml`;
    const failedRenames: string[] = [];
    const failingFs = withRenameOverride(fs, async (from, to) => {
      if (to === laterFile) {
        failedRenames.push(from);
        throw createTestFsError("EIO", to);
      }
      await fs.rename(from, to);
    });
    const transaction = createOverlayFileSystem(failingFs);

    await fs.mkdir(path.dirname(outsidePath), { recursive: true });
    await fs.mkdir(path.dirname(configFile), { recursive: true });
    await fs.writeFile(outsidePath, "outside", { encoding: "utf8" });
    await fs.symlink(outsidePath, configFile);

    await transaction.fs.writeFile(configFile, "inside", { encoding: "utf8" });
    await transaction.fs.writeFile(laterFile, "later", { encoding: "utf8" });

    await expect(transaction.commit()).rejects.toThrow("EIO");

    expect((await fs.lstat(configFile)).isSymbolicLink()).toBe(true);
    await expect(fs.readlink(configFile)).resolves.toBe(outsidePath);
    await expect(fs.readFile(outsidePath, "utf8")).resolves.toBe("outside");
    await expect(fs.lstat(laterFile)).rejects.toMatchObject({ code: "ENOENT" });
    for (const failedRename of failedRenames) {
      await expect(fs.lstat(failedRename)).rejects.toMatchObject({ code: "ENOENT" });
    }
  });

  it("does not treat inherited lstat codes as missing overlay base entries", async () => {
    const configFile = `${homeDir}/.poe-code/config.toml`;
    const lstatError = new Error("overlay lstat denied");
    await fs.mkdir(path.dirname(configFile), { recursive: true });
    await fs.writeFile(configFile, "original", { encoding: "utf8" });
    const failingFs = new Proxy(fs, {
      get(target, property, receiver) {
        if (property === "lstat") {
          return async (filePath: string) => {
            if (filePath === configFile) {
              throw lstatError;
            }
            return target.lstat(filePath);
          };
        }
        const value = Reflect.get(target, property, receiver) as unknown;
        return typeof value === "function" ? value.bind(target) : value;
      }
    }) as FileSystem;
    const transaction = createOverlayFileSystem(failingFs);

    await transaction.fs.writeFile(configFile, "inside", { encoding: "utf8" });

    await withObjectPrototypeCode("ENOENT", async () => {
      await expect(transaction.hasMaterialChange()).rejects.toBe(lstatError);
    });
  });
});
