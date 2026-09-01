import { describe, it, expect, vi } from "vitest";
import {
  collectSpawnLabels,
  normalizeColor,
  renderLabelDocument
} from "../tools/label-generator.js";
import { createPromptLibrary } from "./prompts.js";
import { createLoggerFactory } from "./logger.js";
import { createMutationReporter } from "../services/mutation-events.js";
import { createCliContainer } from "./container.js";
import { listIsolatedServiceIds } from "./commands/shared.js";
import type { FileSystem } from "../utils/file-system.js";
import { createHomeFs } from "../../tests/test-helpers.js";
import { createProviderStub } from "../../tests/provider-stub.js";
import { resolveConfigPath, resolveProjectConfigPath } from "@poe-code/poe-code-config/core";
import { createCliEnvironment, resolveSpawnLogDir } from "./environment.js";
import type { ProviderService } from "./service-registry.js";

const cwd = "/repo";
const homeDir = "/home/test";

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

  it("includes scope prefixes on diagnostics when verbose is enabled", () => {
    const emitter = vi.fn();
    const factory = createLoggerFactory(emitter);
    const logger = factory.create({
      verbose: true,
      scope: "configure:claude-code"
    });

    logger.info("Configured Claude Code.");
    logger.verbose("Wrote settings.json.");

    expect(emitter).toHaveBeenCalledWith("Configured Claude Code.");
    expect(emitter).toHaveBeenCalledWith("[configure:claude-code] Wrote settings.json.");
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
