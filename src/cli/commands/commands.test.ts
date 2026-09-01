import { describe, it, expect, vi, beforeEach, afterEach, onTestFinished } from "vitest";
import { Volume, createFsFromVolume } from "memfs";
import { parse as parseYaml } from "yaml";
import { Command } from "commander";
import { resolveConfigPath } from "@poe-code/poe-code-config/core";
import { saveConfiguredService } from "../../services/config.js";
import { executeConfigure, resolveServiceArgument } from "./configure.js";
import { registerInstallCommand } from "./install.js";
import { registerLogoutCommand } from "./logout.js";
import { registerUnconfigureCommand } from "./unconfigure.js";
import { registerTestCommand } from "./test.js";
import { createProgram } from "../program.js";
import { createCliContainer } from "../container.js";
import { createSecretStore } from "auth-store";
import { createCommandExpectationCheck } from "../../utils/command-checks.js";
import { createHomeFs, createTestProgram, storeTestApiKey } from "../../../tests/test-helpers.js";
import { createProviderStub } from "../../../tests/provider-stub.js";
import { SilentError, ValidationError } from "../errors.js";
import type { FileSystem } from "../utils/file-system.js";
import type { ProviderService } from "../service-registry.js";
import type { CommandRunner } from "../../utils/command-checks.js";
import type { LoggerFn } from "../types.js";
import type { HttpClient } from "../http.js";
import type { MutationDetails, MutationOutcome } from "@poe-code/config-mutations";
import packageJson from "../../../package.json" with { type: "json" };

const cwd = "/repo";
const homeDir = "/home/test";
const configPath = resolveConfigPath(homeDir);

function createMemFs(): FileSystem {
  const vol = new Volume();
  vol.mkdirSync(homeDir, { recursive: true });
  vol.mkdirSync(cwd, { recursive: true });
  return createFsFromVolume(vol).promises as unknown as FileSystem;
}

function setStdinTTY(value: boolean): () => void {
  const original = Object.getOwnPropertyDescriptor(process.stdin, "isTTY");
  Object.defineProperty(process.stdin, "isTTY", { configurable: true, value });
  return () => {
    if (original === undefined) {
      delete (process.stdin as { isTTY?: boolean }).isTTY;
      return;
    }
    Object.defineProperty(process.stdin, "isTTY", original);
  };
}

// ─── configure command ──────────────────────────────────────────────────────

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
    vi.spyOn(container.providerRegistry, "isLoggedIn").mockImplementation(
      async (id) => id === "poe"
    );
    return { container, prompts, commandRunner };
  }

  it("does not invoke install when configuring a service", async () => {
    const { container } = createContainer();

    vi.spyOn(container.options, "resolveApiKey").mockResolvedValue("sk-test");
    vi.spyOn(container.options, "resolveModel").mockResolvedValue("test-model");
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
        homeDir + "/.local/share/opencode/auth.json"
      ],
      provider: "poe",
      apiShape: "openai-chat-completions",
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

  it.each(["goose", "kimi"])("does not expose supplied credentials while previewing %s configuration", async (service) => {
    const logs: string[] = [];
    const { container } = createContainer({ logger: (message) => logs.push(message) });
    vi.spyOn(container.options, "resolveModel").mockResolvedValue("test-model");
    const program = createTestProgram(["node", "cli", "--dry-run", "--yes"]);

    await executeConfigure(program, container, service, {
      provider: "poe",
      apiKey: "preview-secret",
    });

    expect(logs.join("\n")).not.toContain("preview-secret");
    expect(logs.join("\n")).toContain("<redacted>");
  });

  it("does not fetch Goose model metadata while previewing configuration", async () => {
    const httpClient = vi.fn();
    const logs: string[] = [];
    const { container } = createContainer({ httpClient, logger: (message) => logs.push(message) });
    const program = createTestProgram(["node", "cli", "--dry-run", "--yes"]);

    await executeConfigure(program, container, "goose", {
      provider: "poe",
      apiKey: "preview-secret",
    });

    expect(httpClient).not.toHaveBeenCalled();
    expect(logs.join("\n")).not.toContain("preview-secret");
    expect(logs.join("\n")).toContain("<redacted>");
  });

  it("does not fetch Gemini model choices while previewing configuration", async () => {
    const httpClient = vi.fn();
    const { container } = createContainer({ httpClient });
    const program = createTestProgram(["node", "cli", "--dry-run", "--yes"]);

    await executeConfigure(program, container, "gemini-cli", {
      provider: "cloudflare",
      apiKey: "preview-secret",
      baseUrl: "https://gateway.example.test"
    });

    expect(httpClient).not.toHaveBeenCalled();
  });

  function stubConfigurePrompts(
    container: ReturnType<typeof createContainer>["container"],
    service: string,
    configurePrompts: unknown
  ): void {
    const provider = container.registry.require(service) as any;
    const original = provider.configurePrompts;
    onTestFinished(() => {
      provider.configurePrompts = original;
    });
    provider.configurePrompts = configurePrompts;
  }

  it("uses provider-defined reasoning prompt metadata for configure flows", async () => {
    const { container } = createContainer();
    stubConfigurePrompts(container, "codex", {
      reasoningEffort: {
        label: "Custom reasoning label",
        levels: ["extra"]
      }
    });

    const resolveReasoning = vi
      .spyOn(container.options, "resolveReasoning")
      .mockImplementation(async (input) => {
        expect(input.label).toBe("Custom reasoning label");
        expect(input.levels).toEqual(["extra"]);
        return input.value;
      });
    vi.spyOn(container.options, "resolveApiKey").mockResolvedValue("sk-test");

    const program = createTestProgram();
    await executeConfigure(program, container, "codex", { reasoningEffort: "extra" });
    expect(resolveReasoning).toHaveBeenCalled();
  });

  it("configures goose and stores its managed files", async () => {
    const httpClient = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        data: [
          { id: "claude-opus-4.7", context_window: { context_length: 983040 } },
          { id: "claude-sonnet-4.6", context_window: { context_length: 983040 } },
          { id: "gpt-5.3-codex", context_window: { context_length: 400000 } },
          { id: "gpt-5.4-pro", context_window: { context_length: 1050000 } },
          { id: "gemini-3.1-pro", context_window: { context_length: 1048576 } }
        ]
      })
    })) satisfies HttpClient;
    const { container } = createContainer({ httpClient });
    vi.spyOn(container.options, "resolveApiKey").mockResolvedValue("sk-goose");
    vi.spyOn(container.options, "resolveModel").mockResolvedValue("openai/gpt-5.4-pro");

    const program = createTestProgram();
    await executeConfigure(program, container, "goose", {});

    const config = parseYaml(
      await fs.readFile(`${homeDir}/.config/goose/config.yaml`, "utf8")
    ) as Record<string, unknown>;
    expect(config.GOOSE_PROVIDER).toBe("custom_poe");
    expect(config.GOOSE_MODEL).toBeUndefined();

    const provider = JSON.parse(
      await fs.readFile(`${homeDir}/.config/goose/custom_providers/custom_poe.json`, "utf8")
    ) as Record<string, unknown>;
    expect(provider.name).toBe("custom_poe");
    expect(provider.api_key_env).toBe("CUSTOM_POE_API_KEY");
    expect(provider.models).toBeUndefined();
  });

  it("prompts for an agent when core.defaultAgent is configured without --yes", async () => {
    const { container, prompts } = createContainer();
    await fs.mkdir(`${homeDir}/.poe-code`, { recursive: true });
    await fs.writeFile(
      configPath,
      `${JSON.stringify({ core: { defaultAgent: "claude-code" } }, null, 2)}\n`,
      { encoding: "utf8" }
    );
    prompts.mockImplementation(async (descriptor) => ({ [descriptor.name]: "codex" }));

    const program = createTestProgram();

    await expect(
      resolveServiceArgument(program, container, undefined, { action: "configure" })
    ).resolves.toBe("codex");
    expect(prompts).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "serviceSelection",
        message: "Pick a tool to configure:"
      })
    );
  });

  it("prefers an explicit agent over core.defaultAgent", async () => {
    const { container, prompts } = createContainer();
    await fs.mkdir(`${homeDir}/.poe-code`, { recursive: true });
    await fs.writeFile(
      configPath,
      `${JSON.stringify({ core: { defaultAgent: "claude-code" } }, null, 2)}\n`,
      { encoding: "utf8" }
    );

    const program = createTestProgram();

    await expect(
      resolveServiceArgument(program, container, "codex", { action: "configure" })
    ).resolves.toBe("codex");
    expect(prompts).not.toHaveBeenCalled();
  });

  it("uses core.defaultAgent with --yes", async () => {
    const { container, prompts } = createContainer();
    await fs.mkdir(`${homeDir}/.poe-code`, { recursive: true });
    await fs.writeFile(
      configPath,
      `${JSON.stringify({ core: { defaultAgent: "claude-code" } }, null, 2)}\n`,
      { encoding: "utf8" }
    );

    const program = createTestProgram(["node", "cli", "--yes"]);

    await expect(
      resolveServiceArgument(program, container, undefined, { action: "configure" })
    ).resolves.toBe("claude-code");
    expect(prompts).not.toHaveBeenCalled();
  });

  it("falls back to the hardcoded default agent with --yes when core.defaultAgent is unset", async () => {
    const { container, prompts } = createContainer();
    const program = createTestProgram(["node", "cli", "--yes"]);

    await expect(
      resolveServiceArgument(program, container, undefined, { action: "configure" })
    ).resolves.toBe("claude-code");
    expect(prompts).not.toHaveBeenCalled();
  });

  it("throws a ValidationError for an invalid core.defaultAgent with --yes", async () => {
    const { container, prompts } = createContainer();
    await fs.mkdir(`${homeDir}/.poe-code`, { recursive: true });
    await fs.writeFile(
      configPath,
      `${JSON.stringify({ core: { defaultAgent: "foo" } }, null, 2)}\n`,
      { encoding: "utf8" }
    );

    const invokeSpy = vi.spyOn(container.registry, "invoke");
    const program = createTestProgram(["node", "cli", "--yes"]);

    await expect(
      resolveServiceArgument(program, container, undefined, { action: "configure" })
    ).rejects.toBeInstanceOf(ValidationError);
    expect(prompts).not.toHaveBeenCalled();
    expect(invokeSpy).not.toHaveBeenCalled();
  });

  it("drops the model portion of core.defaultAgent for configure with --yes", async () => {
    const { container, prompts } = createContainer();
    await fs.mkdir(`${homeDir}/.poe-code`, { recursive: true });
    await fs.writeFile(
      configPath,
      `${JSON.stringify(
        { core: { defaultAgent: "claude-code:anthropic/claude-sonnet-4.6" } },
        null,
        2
      )}\n`,
      { encoding: "utf8" }
    );

    const program = createTestProgram(["node", "cli", "--yes"]);

    await expect(
      resolveServiceArgument(program, container, undefined, { action: "configure" })
    ).resolves.toBe("claude-code");
    expect(prompts).not.toHaveBeenCalled();
  });
});
// ─── install command ─────────────────────────────────────────────────────────

describe("install command", () => {
  function createBaseProgram(): Command {
    const program = new Command();
    program.exitOverride();
    program.name("poe-code").option("-y, --yes").option("--dry-run");
    return program;
  }

  it("does not list spawn-only Pi in install help", () => {
    const container = createCliContainer({
      fs: createMemFs(),
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir },
      logger: () => {}
    });
    const program = createBaseProgram();
    registerInstallCommand(program, container);

    const help = program.commands.find((command) => command.name() === "install")?.helpInformation() ?? "";
    expect(help).not.toContain("pi");
    expect(container.registry.get("pi")).toBeUndefined();
  });

  it("installs a registered provider", async () => {
    const fs = createMemFs();
    const logs: string[] = [];
    const container = createCliContainer({
      fs,
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir },
      logger: (message) => {
        logs.push(message);
      }
    });

    const callOrder: string[] = [];
    const adapter: ProviderService = createProviderStub({
      name: "test-service",
      label: "Test Service",
      async install() {
        callOrder.push("install");
      }
    });

    container.registry.register(adapter);
    const program = createBaseProgram();
    registerInstallCommand(program, container);

    await program.parseAsync(["node", "cli", "install", "test-service"]);

    expect(callOrder).toEqual(["install"]);
    expect(logs.some((line) => line.includes("Installed Test Service"))).toBe(true);
  });

  it("resolves the install alias", async () => {
    const fs = createMemFs();
    const container = createCliContainer({
      fs,
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir },
      logger: () => {}
    });

    const install = vi.fn(async () => {});
    const adapter: ProviderService = createProviderStub({
      name: "test-service",
      label: "Test Service",
      install
    });

    container.registry.register(adapter);
    const program = createBaseProgram();
    registerInstallCommand(program, container);

    await program.parseAsync(["node", "cli", "i", "test-service"]);

    expect(install).toHaveBeenCalledOnce();
  });

  it("uses core.defaultAgent for install with --yes and drops the model portion", async () => {
    const fs = createMemFs();
    await fs.mkdir(`${homeDir}/.poe-code`, { recursive: true });
    await fs.writeFile(
      configPath,
      `${JSON.stringify({ core: { defaultAgent: "codex:openai/gpt-5.4" } }, null, 2)}\n`,
      { encoding: "utf8" }
    );
    const prompts = vi.fn().mockResolvedValue({});
    const container = createCliContainer({
      fs,
      prompts,
      env: { cwd, homeDir },
      logger: () => {}
    });

    const install = vi.fn(async () => {});
    container.registry.require("codex").install = install;

    const program = createBaseProgram();
    registerInstallCommand(program, container);

    await program.parseAsync(["node", "cli", "--yes", "install"]);

    expect(install).toHaveBeenCalledOnce();
    expect(prompts).not.toHaveBeenCalled();
  });

  it("does not recover malformed config while previewing install without an agent", async () => {
    const fs = createMemFs();
    const malformedConfig = "{ invalid json\n";
    await fs.mkdir(`${homeDir}/.poe-code`, { recursive: true });
    await fs.writeFile(configPath, malformedConfig, { encoding: "utf8" });
    const container = createCliContainer({
      fs,
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir },
      logger: () => {}
    });

    const program = createBaseProgram();
    registerInstallCommand(program, container);

    await expect(
      program.parseAsync(["node", "cli", "--dry-run", "--yes", "install"])
    ).rejects.toThrow();

    await expect(fs.readFile(configPath, "utf8")).resolves.toBe(malformedConfig);
    await expect(fs.readdir(`${homeDir}/.poe-code`)).resolves.toEqual(["config.json"]);
  });
});

// ─── logout command ──────────────────────────────────────────────────────────

function readStoredApiKey(fs: FileSystem): Promise<string | null> {
  const authFs = {
    readFile: (filePath: string, encoding: BufferEncoding) => fs.readFile(filePath, encoding),
    writeFile: (
      filePath: string,
      data: string | NodeJS.ArrayBufferView,
      opts?: { encoding?: BufferEncoding }
    ) => fs.writeFile(filePath, data, opts),
    mkdir: (directoryPath: string, opts?: { recursive?: boolean }) =>
      fs.mkdir(directoryPath, opts).then(() => undefined),
    lstat: (filePath: string) => fs.lstat(filePath),
    unlink: (filePath: string) => fs.unlink(filePath),
    chmod: (filePath: string, mode: number) =>
      fs.chmod ? fs.chmod(filePath, mode) : Promise.resolve()
  };
  const { store } = createSecretStore({
    backendEnvVar: "POE_AUTH_BACKEND",
    fileStore: {
      fs: authFs,
      salt: "poe-code:encrypted-file-auth-store:v1",
      defaultDirectory: ".poe-code",
      defaultFileName: "credentials.enc",
      getHomeDirectory: () => homeDir
    }
  });
  return store.get();
}

describe("logout command", () => {
  function createBaseProgram(): Command {
    const program = new Command();
    program
      .name("poe-code")
      .option("-y, --yes")
      .option("--dry-run")
      .option("--verbose")
      .exitOverride();
    return program;
  }

  beforeEach(() => {
    vi.stubEnv("POE_API_KEY", "");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("deletes config file when no services are configured", async () => {
    const fs = createMemFs();
    const logs: string[] = [];

    await fs.mkdir(`${homeDir}/.poe-code`, { recursive: true });
    await fs.writeFile(configPath, JSON.stringify({ apiKey: "test-key" }), { encoding: "utf8" });

    const container = createCliContainer({
      fs,
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir },
      logger: (message) => {
        logs.push(message);
      }
    });

    const program = createBaseProgram();
    registerUnconfigureCommand(program, container);
    registerLogoutCommand(program, container);

    await program.parseAsync(["node", "cli", "--yes", "logout"]);

    await expect(fs.readFile(configPath, "utf8")).rejects.toThrow();
    expect(logs.some((line) => line.includes("Logged out."))).toBe(true);
  });

  it("refuses to log out without --yes in non-interactive mode and keeps every config", async () => {
    const fs = createMemFs();
    const logs: string[] = [];

    const container = createCliContainer({
      fs,
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir },
      logger: (message) => {
        logs.push(message);
      }
    });

    container.registry.register(
      createProviderStub({
        name: "test-service",
        label: "Test Service",
        async unconfigure() {
          return true;
        }
      })
    );

    await fs.mkdir(`${homeDir}/.poe-code`, { recursive: true });
    await fs.writeFile(
      configPath,
      JSON.stringify({
        apiKey: "test-key",
        configured_services: { "test-service": { files: ["/some/file.json"] } }
      }),
      { encoding: "utf8" }
    );

    const program = createBaseProgram();
    registerUnconfigureCommand(program, container);
    registerLogoutCommand(program, container);

    const restore = setStdinTTY(false);
    try {
      await expect(program.parseAsync(["node", "cli", "logout"])).rejects.toThrow(
        "logout requires --yes when running without an interactive TTY."
      );
    } finally {
      restore();
    }

    await expect(fs.readFile(configPath, "utf8")).resolves.toContain("test-service");
    expect(logs.join("\n")).toContain("Removes configuration for ALL configured agents");
    expect(logs.join("\n")).toContain("test-service");
  });

  it("unconfigures all configured services then deletes config", async () => {
    const fs = createMemFs();
    const logs: string[] = [];
    const unconfigureSpy = vi.fn();

    const container = createCliContainer({
      fs,
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir },
      logger: (message) => {
        logs.push(message);
      }
    });

    const adapter: ProviderService = createProviderStub({
      name: "test-service",
      label: "Test Service",
      async unconfigure(context) {
        unconfigureSpy(context.options);
        return true;
      }
    });

    container.registry.register(adapter);

    await fs.mkdir(`${homeDir}/.poe-code`, { recursive: true });
    await fs.writeFile(
      configPath,
      JSON.stringify({
        apiKey: "test-key",
        configured_services: {
          "test-service": { files: ["/some/file.json"] }
        }
      }),
      { encoding: "utf8" }
    );

    const program = createBaseProgram();
    registerUnconfigureCommand(program, container);
    registerLogoutCommand(program, container);

    await program.parseAsync(["node", "cli", "--yes", "logout"]);

    expect(unconfigureSpy).toHaveBeenCalledTimes(1);
    await expect(fs.readFile(configPath, "utf8")).rejects.toThrow();
    expect(logs.some((line) => line.includes("Logged out."))).toBe(true);
  });

  it("deletes stored provider credentials before an unconfigure failure", async () => {
    const fs = createMemFs();
    const container = createCliContainer({
      fs,
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir },
      logger: vi.fn()
    });
    const adapter: ProviderService = createProviderStub({
      name: "failing-service",
      label: "Failing Service",
      async unconfigure() {
        throw new Error("cleanup failed");
      }
    });

    container.registry.register(adapter);
    await container.writeApiKey("sk-poe-LogoutFailureSecret1234567890abcdef");
    await fs.mkdir(`${homeDir}/.poe-code`, { recursive: true });
    await fs.writeFile(
      configPath,
      JSON.stringify({ configured_services: { "failing-service": { files: [] } } }),
      { encoding: "utf8" }
    );

    const program = createBaseProgram();
    registerUnconfigureCommand(program, container);
    registerLogoutCommand(program, container);

    await expect(program.parseAsync(["node", "cli", "--yes", "logout"])).rejects.toThrow("cleanup failed");
    await expect(container.providerRegistry.isLoggedIn("poe")).resolves.toBe(false);
  });

  it("skips deletion during dry run", async () => {
    const fs = createMemFs();
    const logs: string[] = [];

    await fs.mkdir(`${homeDir}/.poe-code`, { recursive: true });
    await fs.writeFile(configPath, JSON.stringify({ apiKey: "test-key" }), { encoding: "utf8" });

    const container = createCliContainer({
      fs,
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir },
      logger: (message) => {
        logs.push(message);
      }
    });

    const program = createBaseProgram();
    registerUnconfigureCommand(program, container);
    registerLogoutCommand(program, container);

    const optsSpy = vi.spyOn(program, "optsWithGlobals");
    optsSpy.mockReturnValue({ yes: false, dryRun: true } as any);

    await program.parseAsync(["node", "cli", "--dry-run", "logout"]);

    const raw = await fs.readFile(configPath, "utf8");
    expect(JSON.parse(raw)).toEqual(expect.objectContaining({ apiKey: "test-key" }));
    expect(logs.some((line) => line.includes("Dry run:"))).toBe(true);
  });

  it("reports already logged out during dry run when no stored state exists", async () => {
    const fs = createMemFs();
    const logs: string[] = [];
    const container = createCliContainer({
      fs,
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir, variables: { POE_API_KEY: undefined } },
      logger: (message) => {
        logs.push(message);
      }
    });
    const program = createBaseProgram();
    registerUnconfigureCommand(program, container);
    registerLogoutCommand(program, container);

    await program.parseAsync(["node", "cli", "--dry-run", "logout"]);

    expect(logs.join("\n")).toContain("Already logged out.");
    expect(logs.join("\n")).not.toContain("would delete config");
  });

  it("does not recover malformed config while previewing logout", async () => {
    const fs = createMemFs();
    const malformedConfig = "{ invalid json\n";
    await fs.mkdir(`${homeDir}/.poe-code`, { recursive: true });
    await fs.writeFile(configPath, malformedConfig, { encoding: "utf8" });
    const container = createCliContainer({
      fs,
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir },
      logger: () => {}
    });
    const program = createBaseProgram();
    registerUnconfigureCommand(program, container);
    registerLogoutCommand(program, container);

    await expect(program.parseAsync(["node", "cli", "--dry-run", "logout"])).rejects.toThrow();

    await expect(fs.readFile(configPath, "utf8")).resolves.toBe(malformedConfig);
    await expect(fs.readdir(`${homeDir}/.poe-code`)).resolves.toEqual(["config.json"]);
  });

  it("deletes stored API key during logout", async () => {
    const fs = createMemFs();
    const logs: string[] = [];

    const container = createCliContainer({
      fs,
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir },
      logger: (message) => {
        logs.push(message);
      }
    });

    await container.writeApiKey("sk-poe-TestKeyForLogoutDeletion1234567890abcdefg");

    const program = createBaseProgram();
    registerUnconfigureCommand(program, container);
    registerLogoutCommand(program, container);

    await program.parseAsync(["node", "cli", "--yes", "logout"]);

    const storedKey = await readStoredApiKey(fs);
    expect(storedKey).toBeNull();
    expect(logs.some((line) => line.includes("Logged out."))).toBe(true);
    expect(logs.some((line) => line.includes("Already logged out."))).toBe(false);
  });

  it("deletes non-Poe provider credentials and provider configuration during logout", async () => {
    const fs = createMemFs();
    const logs: string[] = [];

    const container = createCliContainer({
      fs,
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir },
      logger: (message) => {
        logs.push(message);
      }
    });

    await container.providerRegistry.login("anthropic", { apiKey: "anthropic-secret" });
    await container.providerRegistry.login("cloudflare", { apiKey: "cloudflare-secret" });
    await fs.mkdir(`${homeDir}/.config/poe-code`, { recursive: true });
    await fs.writeFile(
      container.env.servicesConfigPath,
      JSON.stringify({
        providers: {
          cloudflare: {
            shapeBaseUrls: { "anthropic-messages": "https://gateway.example.test/anthropic" }
          }
        }
      }),
      { encoding: "utf8" }
    );

    const program = createBaseProgram();
    registerUnconfigureCommand(program, container);
    registerLogoutCommand(program, container);

    await program.parseAsync(["node", "cli", "--yes", "logout"]);

    await expect(container.providerRegistry.isLoggedIn("anthropic")).resolves.toBe(false);
    await expect(container.providerRegistry.isLoggedIn("cloudflare")).resolves.toBe(false);
    await expect(fs.readFile(container.env.servicesConfigPath, "utf8")).rejects.toThrow();
    expect(logs.some((line) => line.includes("Logged out."))).toBe(true);
  });

  it("handles missing config file gracefully", async () => {
    const fs = createMemFs();
    const logs: string[] = [];

    const container = createCliContainer({
      fs,
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir },
      logger: (message) => {
        logs.push(message);
      }
    });

    const program = createBaseProgram();
    registerUnconfigureCommand(program, container);
    registerLogoutCommand(program, container);

    await program.parseAsync(["node", "cli", "--yes", "logout"]);

    expect(logs.some((line) => line.includes("Already logged out."))).toBe(true);
  });

  it("warns when POE_API_KEY keeps the session authenticated after logout", async () => {
    const fs = createMemFs();
    const logs: string[] = [];
    const container = createCliContainer({
      fs,
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir, variables: { POE_API_KEY: "environment-key" } },
      logger: (message) => logs.push(message)
    });

    const program = createBaseProgram();
    registerUnconfigureCommand(program, container);
    registerLogoutCommand(program, container);

    await program.parseAsync(["node", "cli", "--yes", "logout"]);

    expect(logs.some((line) => line.includes("POE_API_KEY"))).toBe(true);
    expect(logs.some((line) => line.includes("Already logged out."))).toBe(false);
  });

  function registerLogoutAgents(container: ReturnType<typeof createCliContainer>): void {
    container.registry.register(
      createProviderStub({
        name: "test-a",
        label: "Test A",
        async unconfigure() {
          return true;
        }
      })
    );
    container.registry.register(
      createProviderStub({
        name: "test-b",
        label: "Test B",
        async unconfigure() {
          return true;
        }
      })
    );
  }

  async function writeTwoConfiguredAgents(fs: FileSystem): Promise<void> {
    await fs.mkdir(`${homeDir}/.poe-code`, { recursive: true });
    await fs.writeFile(
      configPath,
      JSON.stringify({
        apiKey: "test-key",
        configured_services: {
          "test-a": { files: ["/a/config.json"] },
          "test-b": { files: ["/b/config.json"] }
        }
      }),
      { encoding: "utf8" }
    );
  }

  it("previews every agent as a row in one logout panel", async () => {
    const fs = createMemFs();
    const logs: string[] = [];
    const container = createCliContainer({
      fs,
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir },
      logger: (message) => logs.push(message)
    });
    registerLogoutAgents(container);
    await writeTwoConfiguredAgents(fs);

    const program = createBaseProgram();
    registerUnconfigureCommand(program, container);
    registerLogoutCommand(program, container);

    await program.parseAsync(["node", "cli", "--dry-run", "logout"]);

    expect(logs.filter((line) => line.startsWith("unconfigure "))).toEqual([]);
    expect(logs.filter((line) => line === "logout")).toHaveLength(1);
    expect(logs.some((line) => line.includes("Test A configuration: /a/config.json"))).toBe(true);
    expect(logs.some((line) => line.includes("Test B configuration: /b/config.json"))).toBe(true);
    expect(logs.filter((line) => line.includes("Problems?"))).toHaveLength(1);
  });

  it("reports every unconfigured agent as a row in one logout panel", async () => {
    const fs = createMemFs();
    const logs: string[] = [];
    const container = createCliContainer({
      fs,
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir },
      logger: (message) => logs.push(message)
    });
    registerLogoutAgents(container);
    await writeTwoConfiguredAgents(fs);

    const program = createBaseProgram();
    registerUnconfigureCommand(program, container);
    registerLogoutCommand(program, container);

    await program.parseAsync(["node", "cli", "--yes", "logout"]);

    expect(logs.filter((line) => line.startsWith("unconfigure "))).toEqual([]);
    expect(logs.filter((line) => line === "logout")).toHaveLength(1);
    expect(logs.some((line) => line.includes("Removed Test A configuration."))).toBe(true);
    expect(logs.some((line) => line.includes("Removed Test B configuration."))).toBe(true);
    expect(logs.filter((line) => line.includes("Problems?"))).toHaveLength(1);
  });
});

// ─── skill command ───────────────────────────────────────────────────────────

function stripAnsi(str: string): string {
  return str.replace(/\x1B\[[0-9;]*m/g, "");
}

describe("skill command", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("shows help text and lists subcommands", async () => {
    const fs = createMemFs();
    const prompts = vi.fn().mockResolvedValue({});
    let helpOutput = "";

    const program = createProgram({
      fs,
      prompts,
      env: { cwd, homeDir },
      logger: () => {},
      suppressCommanderOutput: true
    });

    const outputConfig = {
      writeOut: (str: string) => {
        helpOutput += str;
      },
      writeErr: (str: string) => {
        helpOutput += str;
      }
    };
    program.configureOutput(outputConfig);
    for (const cmd of program.commands) {
      cmd.configureOutput(outputConfig);
    }

    try {
      await program.parseAsync(["node", "cli", "skill", "--help"]);
    } catch {
      // Commander exits after displaying help text.
    }

    const plain = stripAnsi(helpOutput);
    expect(plain).toContain("Usage:");
    expect(plain).toContain("poe-code skill");
    expect(plain).toContain("Commands:");
    expect(plain).toContain("configure [options] [agent]");
    expect(plain).toContain("unconfigure [options] [agent]");
    expect(plain).toContain("Install skill directories");
  });

  it("accepts the plural 'skills' alias that --skill/--skills teach", async () => {
    const fs = createMemFs();
    const program = createProgram({
      fs,
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir },
      logger: () => {},
      suppressCommanderOutput: true
    });

    await expect(
      program.parseAsync(["node", "cli", "skills", "unconfigure", "unknown"])
    ).rejects.toThrow(/^Unknown agent "unknown"\. Agents supporting skill: /);
  });
});

// ─── test command (isolated) ─────────────────────────────────────────────────

describe("test command (isolated)", () => {
  beforeEach(() => {
    const stdout = vi.spyOn(process.stdout, "write").mockReturnValue(true);
    onTestFinished(() => stdout.mockRestore());
  });

  function createBaseProgram(): Command {
    const program = new Command();
    program.exitOverride();
    program.name("poe-code").option("-y, --yes").option("--dry-run");
    return program;
  }

  it("runs checks with isolated env variables", async () => {
    const fs = createMemFs();
    await storeTestApiKey(fs, homeDir, "sk-test");

    const commandRunner = vi.fn(async (_command, _args, options) => {
      expect(options?.env?.DEMO_HOME).toBe(`${homeDir}/.poe-code/demo-service`);
      return { stdout: "OK\n", stderr: "", exitCode: 0 };
    });

    const container = createCliContainer({
      fs,
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir, variables: {} },
      logger: () => {},
      commandRunner
    });

    container.registry.register(
      createProviderStub({
        name: "demo-service",
        label: "Demo Service",
        isolatedEnv: {
          agentBinary: "demo",
          configProbe: { kind: "isolatedFile", relativePath: "probe.txt" },
          env: { DEMO_HOME: { kind: "isolatedDir" } }
        },
        async configure(context) {
          const mapped =
            context.pathMapper?.mapTargetDirectory({ targetDirectory: "~/.demo" }) ??
            `${homeDir}/.poe-code/demo-service`;
          await context.fs.mkdir(mapped, { recursive: true });
          await context.fs.writeFile(`${mapped}/probe.txt`, "ok", {
            encoding: "utf8"
          });
        },
        async test(context) {
          await context.runCheck(
            createCommandExpectationCheck({
              id: "demo-check",
              command: "demo",
              args: ["--version"],
              expectedOutput: "OK"
            })
          );
        }
      })
    );

    const program = createBaseProgram();
    registerTestCommand(program, container);

    await program.parseAsync(["node", "cli", "test", "demo-service", "--isolated"]);
  });

  it("does not start OAuth while previewing Poe-backed isolated tests", async () => {
    const fs = createMemFs();
    await fs.mkdir(`${homeDir}/.poe-code`, { recursive: true });
    await fs.writeFile(
      configPath,
      JSON.stringify({ configured_services: { opencode: { provider: "poe", files: [] } } }),
      "utf8"
    );
    const logs: string[] = [];
    const container = createCliContainer({
      fs,
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir },
      logger: (message) => logs.push(message)
    });
    const program = createBaseProgram();
    const resolveApiKey = vi.spyOn(container.options, "resolveApiKey");
    registerTestCommand(program, container);

    await program.parseAsync(["node", "cli", "--dry-run", "--yes", "test", "opencode", "--isolated"]);

    expect(logs.join("\n")).toContain("Dry run");
    expect(resolveApiKey).not.toHaveBeenCalled();
  });

  it.each(["goose", "kimi"])("does not expose credentials while previewing isolated %s tests", async (service) => {
    const fs = createMemFs();
    await fs.mkdir(`${homeDir}/.poe-code`, { recursive: true });
    await fs.writeFile(
      configPath,
      JSON.stringify({ configured_services: { [service]: { provider: "poe", files: [] } } }),
      "utf8"
    );
    const logs: string[] = [];
    const container = createCliContainer({
      fs,
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir, variables: { POE_API_KEY: "test-preview-secret" } },
      logger: (message) => logs.push(message)
    });
    const program = createBaseProgram();
    registerTestCommand(program, container);

    await program.parseAsync(["node", "cli", "--dry-run", "--yes", "test", service, "--isolated"]);

    expect(logs.join("\n")).not.toContain("test-preview-secret");
  });
});

// ─── test command ─────────────────────────────────────────────────────────────

function createTestContainer(logs: string[] = []) {
  const fs = createMemFs();
  return createCliContainer({
    fs,
    prompts: vi.fn().mockResolvedValue({}),
    env: { cwd, homeDir },
    commandRunner: vi.fn().mockResolvedValue({
      stdout: "STDIN_OK\n",
      stderr: "",
      exitCode: 0
    }),
    logger: (message) => {
      logs.push(message);
    }
  });
}

describe("test command", () => {
  beforeEach(() => {
    const stdout = vi.spyOn(process.stdout, "write").mockReturnValue(true);
    onTestFinished(() => stdout.mockRestore());
  });

  function createBaseProgram(): Command {
    const program = new Command();
    program.exitOverride();
    program.name("poe-code").option("-y, --yes").option("--dry-run");
    return program;
  }

  it("runs the provider test routine and logs success", async () => {
    const logs: string[] = [];
    const container = createTestContainer(logs);
    const testFn = vi.fn();
    const adapter = createProviderStub({
      name: "demo-service",
      label: "Demo Service",
      async test(context) {
        expect(context.logger).toBeDefined();
        testFn();
      }
    });
    container.registry.register(adapter);

    const program = createBaseProgram();
    registerTestCommand(program, container);

    await program.parseAsync(["node", "cli", "test", "demo-service"]);

    expect(testFn).toHaveBeenCalled();
    expect(logs.some((line) => line.includes("Tested Demo Service"))).toBe(true);
  });

  it("does not recover malformed config while previewing a default test", async () => {
    const malformedConfig = "{ invalid json\n";
    const container = createTestContainer();
    await container.fs.mkdir(`${homeDir}/.poe-code`, { recursive: true });
    await container.fs.writeFile(configPath, malformedConfig, { encoding: "utf8" });
    const program = createBaseProgram();
    registerTestCommand(program, container);

    await expect(
      program.parseAsync(["node", "cli", "--dry-run", "--yes", "test"])
    ).rejects.toThrow();

    await expect(container.fs.readFile(configPath, "utf8")).resolves.toBe(malformedConfig);
    await expect(container.fs.readdir(`${homeDir}/.poe-code`)).resolves.toEqual(["config.json"]);
  });

  it("does not list spawn-only Pi in test help", () => {
    const container = createTestContainer();
    const program = createBaseProgram();
    registerTestCommand(program, container);

    const help = program.commands.find((command) => command.name() === "test")?.helpInformation() ?? "";
    expect(help).not.toContain("pi");
    expect(container.registry.get("pi")).toBeUndefined();
  });

  it("fails when the provider does not support the test command", async () => {
    const container = createTestContainer();
    container.registry.register(
      createProviderStub({
        name: "demo-service",
        label: "Demo Service"
      })
    );

    const program = createBaseProgram();
    registerTestCommand(program, container);

    await expect(program.parseAsync(["node", "cli", "test", "demo-service"])).rejects.toThrow(
      /does not support test/i
    );
  });

  it("propagates provider test failures", async () => {
    const container = createTestContainer();
    container.registry.register(
      createProviderStub({
        name: "demo-service",
        label: "Demo Service",
        async test() {
          throw new Error("health check failed");
        }
      })
    );

    const program = createBaseProgram();
    registerTestCommand(program, container);

    await expect(program.parseAsync(["node", "cli", "test", "demo-service"])).rejects.toThrow(
      /health check failed/
    );
  });

  it("passes --model to provider context", async () => {
    const container = createTestContainer();
    let receivedModel: string | undefined;
    container.registry.register(
      createProviderStub({
        name: "demo-service",
        label: "Demo Service",
        async test(context) {
          receivedModel = context.model;
        }
      })
    );

    const program = createBaseProgram();
    registerTestCommand(program, container);

    await program.parseAsync(["node", "cli", "test", "demo-service", "--model", "claude-opus-4-6"]);

    expect(receivedModel).toBe("claude-opus-4-6");
  });

  it("passes hook bridge options to provider tests", async () => {
    const container = createTestContainer();
    let receivedHooks: unknown;
    container.registry.register(
      createProviderStub({
        name: "demo-service",
        label: "Demo Service",
        async test(context) {
          receivedHooks = context.hooks;
        }
      })
    );

    const program = createBaseProgram();
    registerTestCommand(program, container);

    await program.parseAsync([
      "node",
      "cli",
      "test",
      "demo-service",
      "--hooks-from",
      "claude-code",
      "--hooks-strategy",
      "transform",
      "--hooks-scope",
      "user"
    ]);

    expect(receivedHooks).toEqual({ from: "claude-code", strategy: "transform", scope: "user" });
  });

  it("requires --hooks-from when --hooks-scope is provided to tests", async () => {
    const container = createTestContainer();
    container.registry.register(
      createProviderStub({
        name: "demo-service",
        label: "Demo Service",
        async test() {}
      })
    );

    const program = createBaseProgram();
    registerTestCommand(program, container);
    const testCommand = program.commands.find((command) => command.name() === "test");
    testCommand?.configureOutput({ writeErr: () => {} });

    await expect(
      program.parseAsync(["node", "cli", "test", "demo-service", "--hooks-scope", "project"])
    ).rejects.toThrow("--hooks-from");
  });

  it("model is undefined when --model is not provided", async () => {
    const container = createTestContainer();
    let receivedModel: string | undefined = "sentinel";
    container.registry.register(
      createProviderStub({
        name: "demo-service",
        label: "Demo Service",
        async test(context) {
          receivedModel = context.model;
        }
      })
    );

    const program = createBaseProgram();
    registerTestCommand(program, container);

    await program.parseAsync(["node", "cli", "test", "demo-service"]);

    expect(receivedModel).toBeUndefined();
  });

  it("resolves provider-backed isolated env for --isolated tests", async () => {
    const commandRunner = vi.fn().mockResolvedValue({
      stdout: "CLAUDE_CODE_OK\n",
      stderr: "",
      exitCode: 0
    });
    const container = createCliContainer({
      fs: createMemFs(),
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir, variables: { POE_API_KEY: "sk-env" } },
      commandRunner,
      logger: () => {}
    });

    const program = createBaseProgram();
    registerTestCommand(program, container);

    await program.parseAsync(["node", "cli", "test", "claude-code", "--isolated"]);

    expect(commandRunner).toHaveBeenCalledWith(
      "claude",
      expect.any(Array),
      expect.objectContaining({
        env: expect.objectContaining({
          ANTHROPIC_API_KEY: "sk-env",
          ANTHROPIC_BASE_URL: "https://api.poe.com"
        })
      })
    );
  });

  it("resolves provider-backed runtime env for configured tests", async () => {
    const commandRunner = vi.fn().mockResolvedValue({
      stdout: "CLAUDE_CODE_OK\n",
      stderr: "",
      exitCode: 0
    });
    const container = createCliContainer({
      fs: createMemFs(),
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir, variables: { POE_API_KEY: "sk-env" } },
      commandRunner,
      logger: () => {}
    });

    const program = createBaseProgram();
    registerTestCommand(program, container);

    await program.parseAsync(["node", "cli", "test", "claude-code"]);

    expect(commandRunner).toHaveBeenCalledWith(
      "claude",
      expect.any(Array),
      expect.objectContaining({
        env: expect.objectContaining({
          ANTHROPIC_API_KEY: "sk-env",
          ANTHROPIC_BASE_URL: "https://api.poe.com"
        })
      })
    );
  });

  it("uses core.defaultAgent for test with --yes and drops the model portion", async () => {
    const fs = createMemFs();
    await fs.mkdir(`${homeDir}/.poe-code`, { recursive: true });
    await fs.writeFile(
      configPath,
      `${JSON.stringify(
        { core: { defaultAgent: "claude-code:anthropic/claude-sonnet-4.6" } },
        null,
        2
      )}\n`,
      { encoding: "utf8" }
    );
    const prompts = vi.fn().mockResolvedValue({});
    const container = createCliContainer({
      fs,
      prompts,
      env: { cwd, homeDir },
      commandRunner: vi.fn().mockResolvedValue({
        stdout: "STDIN_OK\n",
        stderr: "",
        exitCode: 0
      }),
      logger: () => {}
    });

    const testFn = vi.fn(async () => {});
    container.registry.require("claude-code").test = testFn;

    const program = createBaseProgram();
    registerTestCommand(program, container);

    await program.parseAsync(["node", "cli", "--yes", "test"]);

    expect(testFn).toHaveBeenCalledOnce();
    expect(prompts).not.toHaveBeenCalled();
  });
});

// ─── unconfigure command ──────────────────────────────────────────────────────

describe("unconfigure command", () => {
  function createBaseProgram(): Command {
    const program = new Command();
    program
      .name("poe-code")
      .option("-y, --yes")
      .option("--dry-run")
      .option("--verbose")
      .exitOverride();
    return program;
  }

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("invokes provider unconfigure and reports the result", async () => {
    const fs = createMemFs();
    const logs: string[] = [];
    const container = createCliContainer({
      fs,
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir },
      logger: (message) => {
        logs.push(message);
      }
    });

    const unconfigureSpy = vi.fn();

    const adapter: ProviderService = createProviderStub({
      name: "test-service",
      label: "Test Service",
      async unconfigure(context) {
        unconfigureSpy(context.options);
        return true;
      }
    });

    container.registry.register(adapter);
    await saveConfiguredService({
      fs,
      filePath: configPath,
      service: "test-service",
      metadata: { provider: "none", files: [] }
    });

    const program = createBaseProgram();
    registerUnconfigureCommand(program, container);

    await program.parseAsync(["node", "cli", "--yes", "unconfigure", "test-service"]);

    expect(unconfigureSpy).toHaveBeenCalledTimes(1);
    expect(logs.some((line) => line.includes("Removed Test Service configuration."))).toBe(true);
  });

  it("refuses to unconfigure without --yes in non-interactive mode", async () => {
    const fs = createMemFs();
    const logs: string[] = [];
    const container = createCliContainer({
      fs,
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir },
      logger: (message) => {
        logs.push(message);
      }
    });

    const unconfigureSpy = vi.fn();
    container.registry.register(
      createProviderStub({
        name: "test-service",
        label: "Test Service",
        async unconfigure() {
          unconfigureSpy();
          return true;
        }
      })
    );
    await saveConfiguredService({
      fs,
      filePath: configPath,
      service: "test-service",
      metadata: { provider: "none", files: [] }
    });

    const program = createBaseProgram();
    registerUnconfigureCommand(program, container);

    const restore = setStdinTTY(false);
    try {
      await expect(program.parseAsync(["node", "cli", "unconfigure", "test-service"])).rejects.toThrow(
        "unconfigure test-service requires --yes when running without an interactive TTY."
      );
    } finally {
      restore();
    }

    expect(unconfigureSpy).not.toHaveBeenCalled();
    expect(logs.join("\n")).toContain("Removes Test Service configuration");
  });

  it("uses provider metadata for unconfigure messages", async () => {
    const fs = createMemFs();
    const logs: string[] = [];
    const container = createCliContainer({
      fs,
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir },
      logger: (message) => {
        logs.push(message);
      }
    });

    const adapter = {
      ...createProviderStub({
        name: "test-service",
        label: "Test Service",
        async unconfigure() {
          return true;
        }
      }),
      configurationLabel: "Test Service CLI"
    } as ProviderService & { configurationLabel: string };

    container.registry.register(adapter);
    await saveConfiguredService({
      fs,
      filePath: configPath,
      service: "test-service",
      metadata: { provider: "none", files: [] }
    });

    const program = createBaseProgram();
    registerUnconfigureCommand(program, container);

    await program.parseAsync(["node", "cli", "--yes", "unconfigure", "test-service"]);

    expect(logs.join("\n")).toContain("Removed Test Service CLI configuration.");
    expect(logs.join("\n")).not.toContain("Removed Test Service configuration.");
  });

  it("does not remove untracked Claude Code user settings", async () => {
    const fs = createMemFs();
    const settingsPath = `${homeDir}/.claude/settings.json`;
    const original = JSON.stringify({
      env: {
        ANTHROPIC_API_KEY: "user-own-key",
        ANTHROPIC_BASE_URL: "https://user.example.test",
        USER_SETTING: "keep"
      },
      theme: "keep"
    });
    await fs.mkdir(`${homeDir}/.claude`, { recursive: true });
    await fs.writeFile(settingsPath, original, { encoding: "utf8" });
    const container = createCliContainer({
      fs,
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir },
      logger: () => {}
    });
    const program = createBaseProgram();
    registerUnconfigureCommand(program, container);

    await program.parseAsync(["node", "cli", "--yes", "unconfigure", "claude-code"]);

    await expect(fs.readFile(settingsPath, "utf8")).resolves.toBe(original);
  });

  it("reports no configuration during dry run when service metadata is absent", async () => {
    const fs = createMemFs();
    const logs: string[] = [];
    const container = createCliContainer({
      fs,
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir },
      logger: (message) => {
        logs.push(message);
      }
    });
    const program = createBaseProgram();
    registerUnconfigureCommand(program, container);

    await program.parseAsync(["node", "cli", "--dry-run", "unconfigure", "codex"]);

    expect(logs.join("\n")).toContain("No Codex configuration found.");
    expect(logs.join("\n")).not.toContain("would remove Codex configuration");
  });

  it("does not recover malformed config while previewing unconfigure", async () => {
    const fs = createMemFs();
    const malformedConfig = "{ invalid json\n";
    await fs.mkdir(`${homeDir}/.poe-code`, { recursive: true });
    await fs.writeFile(configPath, malformedConfig, { encoding: "utf8" });
    const container = createCliContainer({
      fs,
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir },
      logger: () => {}
    });
    const program = createBaseProgram();
    registerUnconfigureCommand(program, container);

    await expect(
      program.parseAsync(["node", "cli", "--dry-run", "unconfigure", "codex"])
    ).rejects.toThrow();

    await expect(fs.readFile(configPath, "utf8")).resolves.toBe(malformedConfig);
    await expect(fs.readdir(`${homeDir}/.poe-code`)).resolves.toEqual(["config.json"]);
  });

  it("preserves global and metadata state when isolated unconfigure commit fails", async () => {
    const fs = createMemFs();
    const container = createCliContainer({
      fs,
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir },
      logger: () => {}
    });
    await executeConfigure(createTestProgram(["node", "cli", "--yes"]), container, "codex", {
      provider: "cloudflare",
      apiKey: "retained-isolated-secret",
      baseUrl: "https://gateway.example.test",
      reasoningEffort: "high"
    });
    const originalGlobal = await fs.readFile(`${homeDir}/.codex/config.toml`, "utf8");
    const originalMetadata = await fs.readFile(configPath, "utf8");
    const unlink = fs.unlink.bind(fs);
    vi.spyOn(fs, "unlink").mockImplementation(async (filePath) => {
      if (filePath === `${homeDir}/.poe-code/codex/config.toml`) {
        throw new Error("isolated deletion failed");
      }
      return unlink(filePath);
    });
    const program = createBaseProgram();
    registerUnconfigureCommand(program, container);

    await expect(program.parseAsync(["node", "cli", "--yes", "unconfigure", "codex"])).rejects.toThrow(
      "isolated deletion failed"
    );

    await expect(fs.readFile(`${homeDir}/.codex/config.toml`, "utf8")).resolves.toBe(originalGlobal);
    await expect(fs.readFile(`${homeDir}/.poe-code/codex/config.toml`, "utf8")).resolves.toContain(
      "retained-isolated-secret"
    );
    await expect(fs.readFile(configPath, "utf8")).resolves.toBe(originalMetadata);
  });

  it("logs mutation outcomes when provider reports them", async () => {
    const fs = createMemFs();
    const logs: string[] = [];
    const container = createCliContainer({
      fs,
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir },
      logger: (message) => {
        logs.push(message);
      }
    });

    const details: MutationDetails = {
      manifestId: "test-service",
      kind: "transformFile",
      label: "Transform file /home/test/.config/opencode/config.json",
      targetPath: "/home/test/.config/opencode/config.json"
    };
    const outcome: MutationOutcome = {
      changed: true,
      effect: "delete",
      detail: "delete"
    };

    const adapter: ProviderService = createProviderStub({
      name: "test-service",
      label: "Test Service",
      async unconfigure(_context, runOptions) {
        runOptions?.observers?.onComplete?.(details, outcome);
        return true;
      }
    });

    container.registry.register(adapter);
    await saveConfiguredService({
      fs,
      filePath: configPath,
      service: "test-service",
      metadata: { provider: "none", files: [] }
    });

    const program = createBaseProgram();
    registerUnconfigureCommand(program, container);

    await program.parseAsync(["node", "cli", "--verbose", "--yes", "unconfigure", "test-service"]);

    expect(
      logs.some((line) =>
        line.includes("Transform file /home/test/.config/opencode/config.json: delete")
      )
    ).toBe(true);
  });
});

// ─── version command ──────────────────────────────────────────────────────────

async function parseWithVersionExit(
  program: ReturnType<typeof createProgram>,
  args: string[]
): Promise<void> {
  try {
    await program.parseAsync(args);
  } catch (error) {
    if (error instanceof SilentError) {
      return;
    }
    throw error;
  }
}

describe("version command", () => {
  let fs: FileSystem;
  let logs: string[];
  let prompts: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fs = createMemFs();
    logs = [];
    prompts = vi.fn();
  });

  it("displays current version", async () => {
    const httpClient: HttpClient = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ "dist-tags": { latest: "1.0.0" } })
    }));

    const program = createProgram({
      fs,
      prompts,
      env: { cwd, homeDir },
      httpClient,
      logger: (message) => {
        logs.push(message);
      }
    });

    await parseWithVersionExit(program, ["node", "cli", "--version"]);

    expect(logs.some((log) => log.includes("poe-code"))).toBe(true);
    expect(logs.some((log) => log.includes(packageJson.version))).toBe(true);
  });

  it("never nags this dev build about published releases", async () => {
    // This program reports package.json's 0.0.0-dev version, so it must not reach the
    // registry or suggest an upgrade. The nag itself is covered against real semver
    // versions in version-command.test.ts.
    const httpClient: HttpClient = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ "dist-tags": { latest: "99.0.0" } })
    }));

    const program = createProgram({
      fs,
      prompts,
      env: { cwd, homeDir },
      httpClient,
      logger: (message) => {
        logs.push(message);
      }
    });

    await parseWithVersionExit(program, ["node", "cli", "--version"]);

    expect(logs.some((log) => log.includes("99.0.0"))).toBe(false);
    expect(logs.some((log) => log.includes("poe-code@latest"))).toBe(false);
    expect(httpClient).not.toHaveBeenCalled();
  });

  it("does not show update message when version is current", async () => {
    const httpClient: HttpClient = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ "dist-tags": { latest: "0.0.0-dev" } })
    }));

    const program = createProgram({
      fs,
      prompts,
      env: { cwd, homeDir },
      httpClient,
      logger: (message) => {
        logs.push(message);
      }
    });

    await parseWithVersionExit(program, ["node", "cli", "--version"]);

    expect(logs.some((log) => log.includes("npm install -g poe-code@latest"))).toBe(false);
  });

  it("shows local build indicator for dev version", async () => {
    const httpClient: HttpClient = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ "dist-tags": { latest: "1.0.0" } })
    }));

    const program = createProgram({
      fs,
      prompts,
      env: { cwd, homeDir },
      httpClient,
      logger: (message) => {
        logs.push(message);
      }
    });

    await parseWithVersionExit(program, ["node", "cli", "--version"]);

    expect(logs.some((log) => log.includes("local build"))).toBe(true);
  });

  it("handles update check failure gracefully", async () => {
    const httpClient: HttpClient = vi.fn(async () => {
      throw new Error("Network error");
    });

    const program = createProgram({
      fs,
      prompts,
      env: { cwd, homeDir },
      httpClient,
      logger: (message) => {
        logs.push(message);
      }
    });

    await parseWithVersionExit(program, ["node", "cli", "--version"]);

    expect(logs.some((log) => log.includes("poe-code"))).toBe(true);
    expect(logs.some((log) => log.includes("Network error"))).toBe(false);
  });

  it("does not check for updates while previewing version output", async () => {
    const httpClient: HttpClient = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ "dist-tags": { latest: "99.0.0" } })
    }));

    const program = createProgram({
      fs,
      prompts,
      env: { cwd, homeDir },
      httpClient,
      logger: (message) => {
        logs.push(message);
      }
    });

    await parseWithVersionExit(program, ["node", "cli", "--dry-run", "--version"]);

    expect(httpClient).not.toHaveBeenCalled();
    expect(logs.some((log) => log.includes(packageJson.version))).toBe(true);
  });
});
