import { describe, it, expect, vi } from "vitest";
import { parse as parseYaml } from "yaml";
import { deriveWrapBinaryAliases } from "./binary-aliases.js";
import type { ProviderService } from "./service-registry.js";
import {
  collectSpawnLabels,
  normalizeColor,
  renderLabelDocument
} from "../tools/label-generator.js";
import { createPromptLibrary } from "./prompts.js";
import { DEFAULT_REASONING } from "./constants.js";
import { createLoggerFactory } from "./logger.js";
import { createMutationReporter } from "../services/mutation-events.js";
import { createCliContainer } from "./container.js";
import { listIsolatedServiceIds } from "./commands/shared.js";
import type { FileSystem } from "../utils/file-system.js";
import { createHomeFs, storeTestApiKey } from "../../tests/test-helpers.js";
import { createProviderStub } from "../../tests/provider-stub.js";
import { resolveConfigPath, resolveProjectConfigPath } from "@poe-code/poe-code-config";
import { createCliEnvironment, resolveSpawnLogDir } from "./environment.js";

const cwd = "/repo";
const homeDir = "/home/test";

function provider(name: string, agentBinary?: string): ProviderService {
  return {
    id: name,
    summary: name,
    name,
    label: name,
    isolatedEnv: agentBinary
      ? { agentBinary, configProbe: { kind: "isolatedDir" }, env: {} }
      : undefined,
    async configure() {},
    async remove() {
      return false;
    }
  };
}

// binary-aliases
describe("deriveWrapBinaryAliases", () => {
  it("derives poe-<agentBinary> for isolated providers", () => {
    const aliases = deriveWrapBinaryAliases([
      provider("claude-code", "claude"),
      provider("codex", "codex"),
      provider("opencode", "opencode"),
      provider("kimi")
    ]);

    expect(aliases).toEqual([
      { binName: "poe-claude", serviceName: "claude-code", agentBinary: "claude" },
      { binName: "poe-codex", serviceName: "codex", agentBinary: "codex" },
      { binName: "poe-opencode", serviceName: "opencode", agentBinary: "opencode" }
    ]);
  });

  it("rejects duplicate derived names", () => {
    expect(() => deriveWrapBinaryAliases([provider("a", "codex"), provider("b", "codex")])).toThrow(
      /Duplicate wrapper binary name/
    );
  });
});

// label-generator
describe("label generator", () => {
  it("collects spawn labels and normalizes colors", () => {
    const providers: ProviderService[] = [
      createProviderStub({
        name: "alpha",
        label: "Alpha",
        spawn: async () => undefined,
        branding: { colors: { light: "#abc123" } }
      }),
      createProviderStub({
        name: "beta",
        label: "Beta",
        branding: { colors: { light: "#ffffff" } }
      })
    ];

    const labels = collectSpawnLabels(providers);
    expect(labels).toEqual([
      {
        service: "alpha",
        displayName: "Alpha",
        label: "agent:alpha",
        color: "ABC123",
        description: "Alpha automation label"
      }
    ]);
  });

  it("renders markdown document with workflow JSON", () => {
    const markdown = renderLabelDocument([
      {
        service: "alpha",
        displayName: "Alpha",
        label: "agent:alpha",
        color: "ABC123",
        description: "Alpha automation label"
      }
    ]);
    expect(markdown).toContain("agent:alpha");
    expect(markdown).toContain('"color": "ABC123"');
    expect(markdown).toContain("| Alpha | `agent:alpha` | `#ABC123` |");
  });

  it("normalizes invalid color inputs", () => {
    expect(normalizeColor("")).toBe("000000");
    expect(normalizeColor("#12")).toBe("120000");
    expect(normalizeColor("g!#hijk")).toBe("000000");
  });
});

// prompts
describe("prompt library", () => {
  it("builds a model descriptor with a provider-defined label", () => {
    const library = createPromptLibrary();
    const descriptor = library.model({
      label: "Codex model",
      defaultValue: "b",
      choices: [
        { title: "Option A", value: "a" },
        { title: "Option B", value: "b" }
      ]
    });
    expect(descriptor.message).toBe("Codex model");
    expect(descriptor.initial).toBe(1);
  });

  it("builds a text model descriptor when no choices are provided", () => {
    const library = createPromptLibrary();
    const descriptor = library.model({
      label: "Codex model",
      defaultValue: "gpt-5.4-pro"
    });
    expect(descriptor).toEqual({
      name: "model",
      message: "Codex model",
      type: "text",
      initial: "gpt-5.4-pro"
    });
  });

  it("builds a provider base URL descriptor", () => {
    const library = createPromptLibrary();
    const descriptor = library.providerBaseUrl("Cloudflare AI Gateway");
    expect(descriptor.name).toBe("baseUrl");
    expect(descriptor.message).toBe("Cloudflare AI Gateway base URL");
    expect(descriptor.type).toBe("text");
  });

  it("builds a reasoning descriptor with a provider-defined label", () => {
    const library = createPromptLibrary();
    const descriptor = library.reasoningEffort({
      label: "Codex reasoning effort",
      defaultValue: DEFAULT_REASONING
    });
    expect(descriptor.message).toBe("Codex reasoning effort");
    expect(descriptor.initial).toBe(DEFAULT_REASONING);
  });
});

// verbose-flag
describe("--verbose flag logging behavior", () => {
  it("hides mutation completion logs by default", () => {
    const emitter = vi.fn();
    const factory = createLoggerFactory(emitter);
    const logger = factory.create({ verbose: false });
    const reporter = createMutationReporter(logger);

    reporter.onComplete(
      { label: "write config", targetPath: "/tmp/config.json" },
      { changed: true, effect: "write", detail: "updated" }
    );

    expect(emitter).toHaveBeenCalledTimes(0);
  });

  it("shows mutation completion logs when verbose is enabled", () => {
    const emitter = vi.fn();
    const factory = createLoggerFactory(emitter);
    const logger = factory.create({ verbose: true });
    const reporter = createMutationReporter(logger);

    reporter.onComplete(
      { label: "write config", targetPath: "/tmp/config.json" },
      { changed: true, effect: "write", detail: "updated" }
    );

    expect(emitter).toHaveBeenCalledTimes(1);
  });

  it("omits scope prefixes when verbose is disabled", () => {
    const emitter = vi.fn();
    const factory = createLoggerFactory(emitter);
    const logger = factory.create({
      verbose: false,
      scope: "configure:claude-code"
    });

    logger.info("Configured Claude Code.");

    expect(emitter).toHaveBeenCalledWith("Configured Claude Code.");
  });

  it("includes scope prefixes when verbose is enabled", () => {
    const emitter = vi.fn();
    const factory = createLoggerFactory(emitter);
    const logger = factory.create({
      verbose: true,
      scope: "configure:claude-code"
    });

    logger.info("Configured Claude Code.");

    expect(emitter).toHaveBeenCalledWith("[configure:claude-code] Configured Claude Code.");
  });
});

// isolated-services
describe("listIsolatedServiceIds", () => {
  let fs: FileSystem;

  beforeEach(() => {
    fs = createHomeFs(homeDir);
  });

  it("collects providers that declare an isolated environment", () => {
    const container = createCliContainer({
      fs,
      prompts: vi.fn(),
      env: { cwd, homeDir },
      logger: () => {}
    });

    expect(listIsolatedServiceIds(container)).toEqual([
      "claude-code",
      "claude",
      "codex",
      "gemini-cli",
      "gemini",
      "goose",
      "kimi",
      "kimi-cli",
      "opencode"
    ]);
  });

  it("includes additional registered isolated providers", () => {
    const container = createCliContainer({
      fs,
      prompts: vi.fn(),
      env: { cwd, homeDir },
      logger: () => {}
    });

    container.registry.register(
      createProviderStub({
        name: "custom-isolated",
        label: "Custom Isolated",
        isolatedEnv: {
          agentBinary: "custom",
          configProbe: { kind: "isolatedDir" },
          env: {}
        }
      })
    );

    expect(listIsolatedServiceIds(container)).toEqual([
      "claude-code",
      "claude",
      "codex",
      "gemini-cli",
      "gemini",
      "goose",
      "kimi",
      "kimi-cli",
      "opencode",
      "custom-isolated"
    ]);
  });
});

// poe-code-command-runner
describe("poe-code command runner", () => {
  it("dispatches `poe-code wrap` to the isolated agent binary", async () => {
    const fs = createHomeFs(homeDir);
    const baseRunner = vi.fn(async () => ({
      stdout: "OK\n",
      stderr: "",
      exitCode: 0
    }));
    const container = createCliContainer({
      fs,
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir, variables: {} },
      logger: () => {},
      commandRunner: baseRunner
    });

    await storeTestApiKey(fs, homeDir, "sk-test");

    const result = await container.commandRunner("poe-code", [
      "wrap",
      "claude-code",
      "-p",
      "Say hi"
    ]);

    expect(baseRunner).toHaveBeenCalledWith(
      "claude",
      expect.arrayContaining(["-p", "Say hi", "--settings"]),
      expect.objectContaining({
        env: expect.objectContaining({
          ANTHROPIC_CUSTOM_HEADERS: "Authorization: Bearer sk-test",
          ANTHROPIC_BASE_URL: "https://api.poe.com"
        })
      })
    );

    const callArgs = baseRunner.mock.calls[0][1] as string[];
    const settingsIdx = callArgs.indexOf("--settings");
    expect(settingsIdx).toBeGreaterThan(-1);
    const settingsJson = JSON.parse(callArgs[settingsIdx + 1]);
    expect(settingsJson).toEqual({
      env: {
        ANTHROPIC_BASE_URL: "https://api.poe.com"
      }
    });

    expect(result).toEqual({ stdout: "OK\n", stderr: "", exitCode: 0 });
  });

  it("routes Goose through its isolated home and config directories", async () => {
    const fs = createHomeFs(homeDir);
    const baseRunner = vi.fn(async () => ({
      stdout: "OK\n",
      stderr: "",
      exitCode: 0
    }));
    const container = createCliContainer({
      fs,
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir, variables: {} },
      logger: () => {},
      commandRunner: baseRunner,
      httpClient: vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({
          data: [
            { id: "claude-opus-4.7", context_window: { context_length: 983040 } },
            { id: "claude-sonnet-5", context_window: { context_length: 983040 } },
            { id: "gpt-5.3-codex", context_window: { context_length: 400000 } },
            { id: "gpt-5.4-pro", context_window: { context_length: 1050000 } },
            { id: "gemini-3.1-pro", context_window: { context_length: 1048576 } }
          ]
        })
      }))
    });

    await storeTestApiKey(fs, homeDir, "sk-test");

    const result = await container.commandRunner("poe-code", ["wrap", "goose", "run", "--help"]);

    expect(baseRunner).toHaveBeenCalledWith(
      "goose",
      ["run", "--help"],
      expect.objectContaining({
        env: expect.objectContaining({
          HOME: "/home/test/.poe-code/goose",
          XDG_CONFIG_HOME: "/home/test/.poe-code/goose/.config"
        })
      })
    );
    expect(
      (baseRunner.mock.calls[0]?.[2] as { env: Record<string, string> }).env.POE_CODE_API_KEY
    ).toBe(undefined);

    const secrets = parseYaml(
      await fs.readFile("/home/test/.poe-code/goose/.config/goose/secrets.yaml", "utf8")
    ) as Record<string, unknown>;
    expect(secrets).toEqual({
      CUSTOM_POE_API_KEY: "sk-test"
    });

    expect(result).toEqual({ stdout: "OK\n", stderr: "", exitCode: 0 });
  });
});

// environment
describe("CliEnvironment", () => {
  const cwd = "/workspace";
  const homeDir = "/home/user";

  it("computes a shared config path inside the poe-code folder", () => {
    const environment = createCliEnvironment({ cwd, homeDir });

    expect(environment.configPath).toBe(resolveConfigPath(homeDir));
  });

  it("computes a project config path inside the current working directory", () => {
    const environment = createCliEnvironment({ cwd, homeDir });

    expect(environment.projectConfigPath).toBe(resolveProjectConfigPath(cwd));
  });

  it("resolves paths relative to the user's home directory", () => {
    const environment = createCliEnvironment({ cwd, homeDir });

    expect(environment.resolveHomePath(".config", "codex", "config.toml")).toBe(
      "/home/user/.config/codex/config.toml"
    );
  });

  it("exposes environment variables with overrides", () => {
    const environment = createCliEnvironment({
      cwd,
      homeDir,
      variables: { SHELL: "/bin/zsh" }
    });

    expect(environment.getVariable("SHELL")).toBe("/bin/zsh");
    expect(environment.getVariable("UNKNOWN_VAR")).toBeUndefined();
  });

  it("ignores inherited environment variables", () => {
    const variables = Object.create({
      POE_API_KEY: "inherited-key",
      POE_BASE_URL: "https://inherited.example/v1"
    }) as Record<string, string | undefined>;
    variables.OWN_VALUE = "own";

    const environment = createCliEnvironment({ cwd, homeDir, variables });

    expect(environment.getVariable("POE_API_KEY")).toBeUndefined();
    expect(environment.getVariable("OWN_VALUE")).toBe("own");
    expect(environment.poeApiBaseUrl).toBe("https://api.poe.com/v1");
  });

  it("derives Poe base URLs from POE_BASE_URL with v1", () => {
    const environment = createCliEnvironment({
      cwd,
      homeDir,
      variables: { POE_BASE_URL: "https://proxy.example.com/v1" }
    });

    expect(environment.poeApiBaseUrl).toBe("https://proxy.example.com/v1");
    expect(environment.poeBaseUrl).toBe("https://proxy.example.com");
  });

  it("adds v1 when POE_BASE_URL is set to a host", () => {
    const environment = createCliEnvironment({
      cwd,
      homeDir,
      variables: { POE_BASE_URL: "https://proxy.example.com" }
    });

    expect(environment.poeApiBaseUrl).toBe("https://proxy.example.com/v1");
    expect(environment.poeBaseUrl).toBe("https://proxy.example.com");
  });

  it("computes the default spawn logs directory inside the poe-code folder", () => {
    expect(resolveSpawnLogDir(homeDir)).toBe("/home/user/.poe-code/spawn-logs/");
  });

  it("normalizes a trailing slash in home directory for spawn logs directory", () => {
    expect(resolveSpawnLogDir("/home/user/")).toBe("/home/user/.poe-code/spawn-logs/");
  });

  it("supports root home directory for spawn logs directory", () => {
    expect(resolveSpawnLogDir("/")).toBe("/.poe-code/spawn-logs/");
  });
});
