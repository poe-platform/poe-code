import { describe, it, expect, beforeEach, vi } from "vitest";
import { Volume, createFsFromVolume } from "memfs";
import path from "node:path";
import { resolveConfigPath } from "@poe-code/poe-code-config";
import type { FileSystem } from "../utils/file-system.js";
import {
  coreConfigScope,
  knownConfigScopes,
  loadConfig,
  saveConfig,
  loadConfiguredServices,
  saveConfiguredService,
  unconfigureService
} from "./config.js";
import { createPoeClient } from "./llm-client.js";
import type { HttpClient } from "../cli/http.js";
import {
  DEFAULT_CLAUDE_CODE_MODEL,
  DEFAULT_CODEX_MODEL
} from "../cli/constants.js";
import {
  MixedStrategy,
  SmartStrategy,
  FixedStrategy,
  RoundRobinStrategy,
  ModelStrategyFactory,
  AVAILABLE_MODELS,
  type ModelContext,
  type StrategyConfig,
} from "./model-strategy.js";
import {
  runServiceInstall,
  type InstallContext,
  type ServiceInstallDefinition
} from "./service-install.js";
import type { CommandCheck } from "../utils/command-checks.js";
import {
  checkForUpdate,
  type VersionCheckResult
} from "./version.js";

// ── config ────────────────────────────────────────────────────────────────────

function createMemFs(): FileSystem {
  const vol = new Volume();
  return createFsFromVolume(vol).promises as unknown as FileSystem;
}

describe("config store", () => {
  const configPath = resolveConfigPath("/home/user");
  const projectConfigPath = "/home/user/workspace/.poe-code/config.json";
  let fs: FileSystem;

  beforeEach(async () => {
    fs = createMemFs();
    await fs.mkdir(path.dirname(configPath), { recursive: true });
  });

  it("declares core.defaultAgent in the core config scope", () => {
    expect(coreConfigScope.schema.defaultAgent).toEqual({
      type: "string",
      default: "",
      env: "POE_DEFAULT_AGENT",
      doc: "Agent (or agent:model) used as the non-interactive --yes default when no --agent flag is provided"
    });
  });

  it("registers the codeReview config scope", () => {
    expect(knownConfigScopes.map((scope) => scope.scope)).toContain("codeReview");
  });

  it("returns stored api key when file is valid json", async () => {
    await saveConfig({
      fs,
      filePath: configPath,
      apiKey: "test-key"
    });

    const apiKey = await loadConfig({
      fs,
      filePath: configPath
    });

    expect(apiKey).toBe("test-key");
  });

  it("preserves configured services when updating the api key", async () => {
    const initial = {
      core: {
        apiKey: "initial"
      },
      configured_services: {
        codex: {
          files: ["/home/user/.codex/config.toml"]
        }
      }
    };
    await fs.writeFile(configPath, JSON.stringify(initial, null, 2), {
      encoding: "utf8"
    });

    await saveConfig({
      fs,
      filePath: configPath,
      apiKey: "updated"
    });

    const updated = JSON.parse(await fs.readFile(configPath, "utf8"));
    expect(updated.core.apiKey).toBe("updated");
    expect(updated.configured_services).toEqual(initial.configured_services);
  });

  it("migrates top-level apiKey into the core scope", async () => {
    await fs.writeFile(configPath, `${JSON.stringify({ apiKey: "legacy-key" }, null, 2)}\n`, {
      encoding: "utf8"
    });

    await expect(
      loadConfig({
        fs,
        filePath: configPath
      })
    ).resolves.toBe("legacy-key");

    const migrated = JSON.parse(await fs.readFile(configPath, "utf8"));
    expect(migrated).toEqual({
      core: {
        apiKey: "legacy-key"
      }
    });
  });

  it("stores configured service metadata and returns it on load", async () => {
    await saveConfiguredService({
      fs,
      filePath: configPath,
      service: "opencode",
      metadata: {
        files: [
          "/home/user/.config/opencode/config.json",
          "/home/user/.local/share/opencode/auth.json"
        ],
        provider: "poe"
      }
    });

    const services = await loadConfiguredServices({
      fs,
      filePath: configPath
    });

    expect(services).toEqual({
      opencode: {
        provider: "poe",
        apiShape: "openai-chat-completions",
        files: [
          "/home/user/.config/opencode/config.json",
          "/home/user/.local/share/opencode/auth.json"
        ]
      }
    });
  });

  it("removes configured service metadata", async () => {
    await saveConfiguredService({
      fs,
      filePath: configPath,
      service: "claude-code",
      metadata: {
        files: ["/home/user/.claude/settings.json"],
        provider: "poe"
      }
    });

    await unconfigureService({
      fs,
      filePath: configPath,
      service: "claude-code"
    });

    const services = await loadConfiguredServices({
      fs,
      filePath: configPath
    });
    expect(services).toEqual({});
  });

  it("migrates legacy credentials.json to config.json on first read", async () => {
    const legacyPath = path.join(path.dirname(configPath), "credentials.json");
    const data = {
      configured_services: {
        codex: { files: ["/home/user/.codex/config.toml"] }
      }
    };
    await fs.writeFile(legacyPath, JSON.stringify(data, null, 2), {
      encoding: "utf8"
    });

    const services = await loadConfiguredServices({
      fs,
      filePath: configPath
    });

    expect(services).toEqual({
      codex: {
        provider: "poe",
        apiShape: "openai-responses",
        files: ["/home/user/.codex/config.toml"]
      }
    });

    await expect(fs.readFile(configPath, "utf8")).resolves.toBeDefined();
    await expect(fs.readFile(legacyPath, "utf8")).rejects.toThrow();
  });

  it("does not partially commit legacy credentials when the atomic config replacement fails", async () => {
    const legacyPath = path.join(path.dirname(configPath), "credentials.json");
    const base = fs;
    await base.writeFile(legacyPath, JSON.stringify({
      apiKey: "legacy-key",
      configured_services: { codex: { files: ["/home/user/.codex/config.toml"] } }
    }), { encoding: "utf8" });
    const failingFs = {
      ...base,
      async rename(oldPath: string, newPath: string) {
        if (newPath === configPath) {
          throw new Error("core write offline");
        }
        await base.rename(oldPath, newPath);
      }
    };

    await expect(loadConfig({ fs: failingFs, filePath: configPath })).rejects.toThrow("core write offline");
    await expect(base.readFile(configPath, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
    await expect(base.readFile(legacyPath, "utf8")).resolves.toContain("legacy-key");
  });

  it("preserves prototype-named configured services during legacy credentials migration", async () => {
    const legacyPath = path.join(path.dirname(configPath), "credentials.json");
    await fs.writeFile(
      legacyPath,
      '{"apiKey":"legacy-key","configured_services":{"__proto__":{"files":["/home/user/.custom/config"]}}}',
      { encoding: "utf8" }
    );

    await expect(loadConfig({ fs, filePath: configPath })).resolves.toBe("legacy-key");
    const services = await loadConfiguredServices({ fs, filePath: configPath });

    expect(Object.hasOwn(services, "__proto__")).toBe(true);
    expect(services.__proto__).toMatchObject({ files: ["/home/user/.custom/config"] });
  });

  it("rejects a symlinked legacy credentials file before importing external secrets", async () => {
    const legacyPath = path.join(path.dirname(configPath), "credentials.json");
    await fs.mkdir("/outside", { recursive: true });
    await fs.writeFile("/outside/credentials.json", JSON.stringify({ apiKey: "external-key" }), {
      encoding: "utf8"
    });
    await fs.symlink("/outside/credentials.json", legacyPath);

    await expect(loadConfig({ fs, filePath: configPath })).rejects.toThrow(
      "Refusing legacy credentials access through symbolic link"
    );
    await expect(fs.readFile(configPath, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
    await expect(fs.readFile("/outside/credentials.json", "utf8")).resolves.toContain("external-key");
  });

  it("preserves malformed legacy credentials during a config read", async () => {
    const legacyPath = path.join(path.dirname(configPath), "credentials.json");
    await fs.writeFile(legacyPath, "{ malformed-secret", { encoding: "utf8" });

    await expect(loadConfig({ fs, filePath: configPath })).resolves.toBeNull();
    await expect(fs.readFile(legacyPath, "utf8")).resolves.toBe("{ malformed-secret");
    await expect(fs.readdir(path.dirname(configPath))).resolves.not.toContainEqual(
      expect.stringMatching(/^credentials\.json\.invalid-/)
    );
  });

  it("backs up and resets invalid json content", async () => {
    await fs.writeFile(configPath, "test\n", { encoding: "utf8" });

    const apiKey = await loadConfig({
      fs,
      filePath: configPath
    });

    expect(apiKey).toBeNull();

    const configDir = path.dirname(configPath);
    const entries = await fs.readdir(configDir);
    const backupName = entries.find((entry) => entry.startsWith("config.json.invalid-"));
    expect(backupName).toBeDefined();

    const backupPath = path.join(configDir, backupName as string);
    const backupContent = await fs.readFile(backupPath, "utf8");
    expect(backupContent).toBe("test\n");

    const rewritten = await fs.readFile(configPath, "utf8");
    expect(JSON.parse(rewritten)).toEqual({});
  });

  it("prefers the project api key over the global one on load", async () => {
    await fs.writeFile(
      configPath,
      `${JSON.stringify({ core: { apiKey: "global-key" } }, null, 2)}\n`,
      { encoding: "utf8" }
    );
    await fs.mkdir(path.dirname(projectConfigPath), { recursive: true });
    await fs.writeFile(
      projectConfigPath,
      `${JSON.stringify({ core: { apiKey: "project-key" } }, null, 2)}\n`,
      { encoding: "utf8" }
    );

    await expect(
      loadConfig({
        fs,
        filePath: configPath,
        projectFilePath: projectConfigPath
      })
    ).resolves.toBe("project-key");
  });

  it("tags service entries missing provider with 'poe' on load and rewrites the file", async () => {
    const initial = {
      configured_services: {
        "claude-code": { files: ["/home/user/.claude/settings.json"] },
        codex: { files: ["/home/user/.codex/config.toml"] }
      }
    };
    await fs.writeFile(configPath, JSON.stringify(initial, null, 2), { encoding: "utf8" });

    const services = await loadConfiguredServices({ fs, filePath: configPath });

    expect(services).toEqual({
      "claude-code": {
        provider: "poe",
        apiShape: "anthropic-messages",
        files: ["/home/user/.claude/settings.json"]
      },
      codex: {
        provider: "poe",
        apiShape: "openai-responses",
        files: ["/home/user/.codex/config.toml"]
      }
    });
    const saved = JSON.parse(await fs.readFile(configPath, "utf8"));
    expect(saved.configured_services["claude-code"].provider).toBe("poe");
    expect(saved.configured_services["claude-code"].apiShape).toBe("anthropic-messages");
    expect(saved.configured_services.codex.provider).toBe("poe");
    expect(saved.configured_services.codex.apiShape).toBe("openai-responses");
  });

  it("leaves provider fields unchanged when already set and migrates missing apiShape", async () => {
    const initial = {
      configured_services: {
        "claude-code": { files: ["/home/user/.claude/settings.json"], provider: "anthropic" },
        codex: { files: ["/home/user/.codex/config.toml"], provider: "poe" }
      }
    };
    await fs.writeFile(configPath, JSON.stringify(initial, null, 2), { encoding: "utf8" });
    const services = await loadConfiguredServices({ fs, filePath: configPath });

    expect(services).toEqual({
      "claude-code": {
        provider: "anthropic",
        apiShape: "anthropic-messages",
        files: ["/home/user/.claude/settings.json"]
      },
      codex: {
        provider: "poe",
        apiShape: "openai-responses",
        files: ["/home/user/.codex/config.toml"]
      }
    });
    const saved = JSON.parse(await fs.readFile(configPath, "utf8"));
    expect(saved.configured_services["claude-code"].provider).toBe("anthropic");
    expect(saved.configured_services["claude-code"].apiShape).toBe("anthropic-messages");
    expect(saved.configured_services.codex.apiShape).toBe("openai-responses");
  });

  it("merges configured services from global and project config", async () => {
    await fs.writeFile(
      configPath,
      `${JSON.stringify(
        {
          configured_services: {
            codex: { files: ["/home/user/.codex/config.toml"] }
          }
        },
        null,
        2
      )}\n`,
      { encoding: "utf8" }
    );
    await fs.mkdir(path.dirname(projectConfigPath), { recursive: true });
    await fs.writeFile(
      projectConfigPath,
      `${JSON.stringify(
        {
          configured_services: {
            claude: { files: ["/home/user/.claude/settings.json"] }
          }
        },
        null,
        2
      )}\n`,
      { encoding: "utf8" }
    );

    await expect(
      loadConfiguredServices({
        fs,
        filePath: configPath,
        projectFilePath: projectConfigPath
      })
    ).resolves.toEqual({
      codex: {
        provider: "poe",
        apiShape: "openai-responses",
        files: ["/home/user/.codex/config.toml"]
      },
      claude: {
        provider: "poe",
        apiShape: "anthropic-messages",
        files: ["/home/user/.claude/settings.json"]
      }
    });
  });

  it("writes configured service updates to the global config only", async () => {
    await fs.mkdir(path.dirname(projectConfigPath), { recursive: true });
    await fs.writeFile(
      projectConfigPath,
      `${JSON.stringify(
        {
          configured_services: {
            codex: { files: ["/home/user/.codex/config.toml"] }
          }
        },
        null,
        2
      )}\n`,
      { encoding: "utf8" }
    );

    await saveConfiguredService({
      fs,
      filePath: configPath,
      projectFilePath: projectConfigPath,
      service: "claude-code",
      metadata: {
        files: ["/home/user/.claude/settings.json"],
        provider: "poe"
      }
    });

    expect(JSON.parse(await fs.readFile(configPath, "utf8"))).toEqual({
      configured_services: {
        "claude-code": {
          apiShape: "anthropic-messages",
          files: ["/home/user/.claude/settings.json"],
          provider: "poe"
        }
      }
    });
    expect(JSON.parse(await fs.readFile(projectConfigPath, "utf8"))).toEqual({
      configured_services: {
        codex: {
          files: ["/home/user/.codex/config.toml"]
        }
      }
    });
  });
});

// ── llm-client ────────────────────────────────────────────────────────────────

const baseUrl = "https://api.poe.com/v1";

function createHttpClientMock(response: unknown): HttpClient {
  return vi.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => response
  }));
}

describe("createPoeClient", () => {
  it("sends extra_body for text params", async () => {
    const httpClient = createHttpClientMock({
      choices: [{ message: { content: "hi" } }]
    });

    const client = createPoeClient({
      apiKey: "secret",
      baseUrl,
      httpClient
    });

    const response = await client.text({
      model: "Text-Model",
      prompt: "Hello",
      params: { thinking_budget: "123" }
    });

    expect(response).toEqual({ content: "hi" });
    expect(httpClient).toHaveBeenCalledWith(
      "https://api.poe.com/v1/chat/completions",
      expect.objectContaining({
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer secret"
        }
      })
    );

    const call = (httpClient as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    const body = call[1]?.body as string;
    const parsed = JSON.parse(body);
    expect(parsed).toEqual({
      model: "Text-Model",
      messages: [{ role: "user", content: "Hello" }],
      extra_body: { thinking_budget: "123" }
    });
  });

  it("omits extra_body when no params are provided", async () => {
    const httpClient = createHttpClientMock({
      choices: [{ message: { content: "ok" } }]
    });

    const client = createPoeClient({
      apiKey: "secret",
      baseUrl,
      httpClient
    });

    await client.text({
      model: "Text-Model",
      prompt: "Hello"
    });

    const call = (httpClient as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    const body = call[1]?.body as string;
    const parsed = JSON.parse(body);
    expect(parsed).toEqual({
      model: "Text-Model",
      messages: [{ role: "user", content: "Hello" }]
    });
  });

  it("parses media responses from JSON content", async () => {
    const httpClient = createHttpClientMock({
      choices: [
        {
          message: {
            content: JSON.stringify({
              url: "https://example.com/out.mp4",
              mimeType: "video/mp4"
            })
          }
        }
      ]
    });

    const client = createPoeClient({
      apiKey: "secret",
      baseUrl,
      httpClient
    });

    const response = await client.media("video", {
      model: "Video-Model",
      prompt: "Launch",
      params: { resolution: "1080p" }
    });

    expect(response).toEqual({
      url: "https://example.com/out.mp4",
      mimeType: "video/mp4"
    });

    const call = (httpClient as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    const body = call[1]?.body as string;
    const parsed = JSON.parse(body);
    expect(parsed).toEqual({
      model: "Video-Model",
      messages: [{ role: "user", content: "Launch" }],
      extra_body: { resolution: "1080p" }
    });
  });

  it("accepts media responses as raw URLs", async () => {
    const httpClient = createHttpClientMock({
      choices: [
        {
          message: {
            content: "https://example.com/out.mp3"
          }
        }
      ]
    });

    const client = createPoeClient({
      apiKey: "secret",
      baseUrl,
      httpClient
    });

    const response = await client.media("audio", {
      model: "Audio-Model",
      prompt: "Hello"
    });

    expect(response).toEqual({ url: "https://example.com/out.mp3" });
  });

  it("does not treat ordinary markdown links as generated media", async () => {
    async function mediaFor(content: string, type: "image" | "video" | "audio" = "image") {
      const client = createPoeClient({
        apiKey: "secret",
        baseUrl,
        httpClient: createHttpClientMock({
          choices: [{ message: { content } }]
        })
      });

      return client.media(type, {
        model: "Media-Model",
        prompt: "Generate media"
      });
    }

    await expect(mediaFor("![image](https://cdn.example.test/generated.png)")).resolves.toEqual({
      url: "https://cdn.example.test/generated.png"
    });
    await expect(
      mediaFor("[video](https://cdn.example.test/generated.mp4)", "video")
    ).resolves.toEqual({
      url: "https://cdn.example.test/generated.mp4"
    });
    await expect(
      mediaFor("[audio](https://cdn.example.test/generated.mp3)", "audio")
    ).resolves.toEqual({
      url: "https://cdn.example.test/generated.mp3"
    });
    await expect(
      mediaFor("I cannot generate that. See [Poe docs](https://docs.example.test/media-help).")
    ).resolves.toEqual({
      content: "I cannot generate that. See [Poe docs](https://docs.example.test/media-help)."
    });
    await expect(
      mediaFor("Here is a citation [not media](https://example.test/page.html).")
    ).resolves.toEqual({
      content: "Here is a citation [not media](https://example.test/page.html)."
    });
  });

  it("returns content when no URL found", async () => {
    const httpClient = createHttpClientMock({
      choices: [
        {
          message: {
            content: "Sorry, I cannot generate images."
          }
        }
      ]
    });

    const client = createPoeClient({
      apiKey: "secret",
      baseUrl,
      httpClient
    });

    const response = await client.media("image", {
      model: "Text-Model",
      prompt: "Draw a cat"
    });

    expect(response).toEqual({ content: "Sorry, I cannot generate images." });
  });

  it("includes status and redacted body in API errors", async () => {
    const httpClient: HttpClient = vi.fn(async () => ({
      ok: false,
      status: 401,
      json: async () => ({ error: "Invalid API key" }),
      text: async () => "Invalid API key"
    }));

    const client = createPoeClient({
      apiKey: "secret",
      baseUrl,
      httpClient
    });

    await expect(
      client.text({ model: "Text-Model", prompt: "Hello" })
    ).rejects.toMatchObject({
      message: "Poe API error (401): Invalid API key",
      httpStatus: 401
    });
  });

  it("redacts secret-like Poe API error response bodies", async () => {
    const bareToken = "sk-live-1234567890";
    const projectToken = "sk-proj-abcdefghijklmnopqrstuvwxyz";
    const httpClient: HttpClient = vi.fn(async () => ({
      ok: false,
      status: 401,
      json: async () => ({ error: "Invalid API key" }),
      text: async () =>
        JSON.stringify({
          error: `invalid ${bareToken}`,
          access_token: "poe-access-token",
          nested: {
            client_secret: "poe-client-secret",
            detail: `Gateway echoed token ${projectToken} in detail`
          },
          detail: "Authorization: Bearer poe-bearer-token"
        })
    }));

    const client = createPoeClient({
      apiKey: "secret",
      baseUrl,
      httpClient
    });

    let thrown: unknown;
    try {
      await client.text({ model: "Text-Model", prompt: "Hello" });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toMatchObject({
      context: {
        httpStatus: 401,
        apiEndpoint: "chat/completions"
      }
    });

    const apiError = thrown as { context?: { responseBody?: string } };
    const responseBody = apiError.context?.responseBody ?? "";
    const serialized = JSON.stringify(thrown);
    expect(thrown).toMatchObject({
      message: expect.stringContaining('"access_token":"[redacted]"')
    });
    expect(thrown).toMatchObject({
      message: expect.stringContaining('"error":"invalid [redacted]"')
    });
    expect(responseBody).toContain('"client_secret":"[redacted]"');
    expect(responseBody).toContain('"detail":"Gateway echoed token [redacted] in detail"');
    expect(serialized).not.toMatch(
      /poe-access-token|poe-client-secret|poe-bearer-token|sk-live-1234567890|sk-proj-abcdefghijklmnopqrstuvwxyz/u
    );
  });
});

// ── model-strategy ────────────────────────────────────────────────────────────

const CLAUDE_MODEL_SONNET = DEFAULT_CLAUDE_CODE_MODEL;

describe("MixedStrategy", () => {
  let strategy: MixedStrategy;

  beforeEach(() => {
    strategy = new MixedStrategy();
  });

  it(`alternates between gpt-5.5 and ${CLAUDE_MODEL_SONNET}`, () => {
    const model1 = strategy.getNextModel();
    const model2 = strategy.getNextModel();
    const model3 = strategy.getNextModel();
    const model4 = strategy.getNextModel();

    expect(model1).toBe("gpt-5.5");
    expect(model2).toBe(CLAUDE_MODEL_SONNET);
    expect(model3).toBe("gpt-5.5");
    expect(model4).toBe(CLAUDE_MODEL_SONNET);
  });

  it("resets to first model when reset() is called", () => {
    strategy.getNextModel(); // gpt-5.5
    strategy.getNextModel(); // Default Claude model

    strategy.reset();

    const model = strategy.getNextModel();
    expect(model).toBe("gpt-5.5");
  });

  it("returns correct name and description", () => {
    expect(strategy.getName()).toBe("mixed");
    expect(strategy.getDescription()).toContain("Alternates");
  });
});

describe("SmartStrategy", () => {
  let strategy: SmartStrategy;

  beforeEach(() => {
    strategy = new SmartStrategy();
  });

  it("selects gpt-5.5 for complex code tasks", () => {
    const context: ModelContext = {
      messageType: "code",
      complexity: "complex",
    };

    const model = strategy.getNextModel(context);
    expect(model).toBe("gpt-5.5");
  });

  it("selects Claude for medium complexity code tasks", () => {
    const context: ModelContext = {
      messageType: "code",
      complexity: "medium",
    };

    const model = strategy.getNextModel(context);
    expect(model).toBe(CLAUDE_MODEL_SONNET);
  });

  it("selects gpt-5.5 for complex reasoning tasks", () => {
    const context: ModelContext = {
      messageType: "reasoning",
      complexity: "complex",
    };

    const model = strategy.getNextModel(context);
    expect(model).toBe("gpt-5.5");
  });

  it("selects gpt-4o for chat tasks", () => {
    const context: ModelContext = {
      messageType: "chat",
      complexity: "simple",
    };

    const model = strategy.getNextModel(context);
    expect(model).toBe("gpt-4o");
  });

  it("defaults to Claude when no context provided", () => {
    const model = strategy.getNextModel();
    expect(model).toBe(CLAUDE_MODEL_SONNET);
  });

  it("defaults to Claude for general tasks", () => {
    const context: ModelContext = {
      messageType: "general",
      complexity: "medium",
    };

    const model = strategy.getNextModel(context);
    expect(model).toBe(CLAUDE_MODEL_SONNET);
  });

  it("returns correct name and description", () => {
    expect(strategy.getName()).toBe("smart");
    expect(strategy.getDescription()).toContain("Intelligently");
  });
});

describe("FixedStrategy", () => {
  it("always returns the configured model", () => {
    const strategy = new FixedStrategy("gpt-5.4");

    expect(strategy.getNextModel()).toBe("gpt-5.4");
    expect(strategy.getNextModel()).toBe("gpt-5.4");
    expect(strategy.getNextModel()).toBe("gpt-5.4");
  });

  it(`defaults to ${CLAUDE_MODEL_SONNET} when no model specified`, () => {
    const strategy = new FixedStrategy();

    expect(strategy.getNextModel()).toBe(CLAUDE_MODEL_SONNET);
  });

  it("can change the model", () => {
    const strategy = new FixedStrategy("gpt-5.4");

    strategy.setModel("gpt-4o");

    expect(strategy.getNextModel()).toBe("gpt-4o");
  });

  it("returns correct name and description", () => {
    const strategy = new FixedStrategy("gpt-5.4");

    expect(strategy.getName()).toBe("fixed");
    expect(strategy.getDescription()).toContain("gpt-5.4");
  });
});

describe("RoundRobinStrategy", () => {
  it("cycles through all available models by default", () => {
    const strategy = new RoundRobinStrategy();

    const model1 = strategy.getNextModel();
    const model2 = strategy.getNextModel();
    const model3 = strategy.getNextModel();
    const model4 = strategy.getNextModel();
    const model5 = strategy.getNextModel();
    const model6 = strategy.getNextModel();
    const model7 = strategy.getNextModel();
    const model8 = strategy.getNextModel();
    const model9 = strategy.getNextModel(); // Should wrap around

    expect(model1).toBe(CLAUDE_MODEL_SONNET);
    expect(model2).toBe("gpt-5.5");
    expect(model3).toBe("gpt-5.4");
    expect(model4).toBe("gpt-5.4-chat");
    expect(model5).toBe("gpt-5.4-pro");
    expect(model6).toBe("gpt-4o");
    expect(model7).toBe("Claude-3.5-Sonnet");
    expect(model8).toBe(DEFAULT_CODEX_MODEL);
    expect(model9).toBe(CLAUDE_MODEL_SONNET); // Wrapped around
  });

  it("cycles through custom model order", () => {
    const customOrder = ["gpt-5.4", CLAUDE_MODEL_SONNET];
    const strategy = new RoundRobinStrategy(customOrder);

    const model1 = strategy.getNextModel();
    const model2 = strategy.getNextModel();
    const model3 = strategy.getNextModel();

    expect(model1).toBe("gpt-5.4");
    expect(model2).toBe(CLAUDE_MODEL_SONNET);
    expect(model3).toBe("gpt-5.4"); // Wrapped around
  });

  it("resets to first model when reset() is called", () => {
    const customOrder = ["gpt-5.4", CLAUDE_MODEL_SONNET];
    const strategy = new RoundRobinStrategy(customOrder);

    strategy.getNextModel(); // gpt-5.4
    strategy.getNextModel(); // Default Claude model

    strategy.reset();

    const model = strategy.getNextModel();
    expect(model).toBe("gpt-5.4");
  });

  it("returns correct name and description", () => {
    const strategy = new RoundRobinStrategy(["gpt-5.4", CLAUDE_MODEL_SONNET]);

    expect(strategy.getName()).toBe("round-robin");
    expect(strategy.getDescription()).toContain("gpt-5.4");
    expect(strategy.getDescription()).toContain(CLAUDE_MODEL_SONNET);
  });
});

describe("ModelStrategyFactory", () => {
  it("creates MixedStrategy", () => {
    const config: StrategyConfig = { type: "mixed" };
    const strategy = ModelStrategyFactory.createStrategy(config);

    expect(strategy).toBeInstanceOf(MixedStrategy);
    expect(strategy.getName()).toBe("mixed");
  });

  it("creates SmartStrategy", () => {
    const config: StrategyConfig = { type: "smart" };
    const strategy = ModelStrategyFactory.createStrategy(config);

    expect(strategy).toBeInstanceOf(SmartStrategy);
    expect(strategy.getName()).toBe("smart");
  });

  it("creates FixedStrategy with specified model", () => {
    const config: StrategyConfig = {
      type: "fixed",
      fixedModel: "gpt-5.4",
    };
    const strategy = ModelStrategyFactory.createStrategy(config);

    expect(strategy).toBeInstanceOf(FixedStrategy);
    expect(strategy.getNextModel()).toBe("gpt-5.4");
  });

  it("creates RoundRobinStrategy with custom order", () => {
    const config: StrategyConfig = {
      type: "round-robin",
      customOrder: ["gpt-5.4", CLAUDE_MODEL_SONNET],
    };
    const strategy = ModelStrategyFactory.createStrategy(config);

    expect(strategy).toBeInstanceOf(RoundRobinStrategy);
    expect(strategy.getNextModel()).toBe("gpt-5.4");
    expect(strategy.getNextModel()).toBe(CLAUDE_MODEL_SONNET);
  });

  it("rejects an empty round-robin custom order", () => {
    expect(() => ModelStrategyFactory.createStrategy({
      type: "round-robin",
      customOrder: []
    })).toThrow("Round-robin custom order must include at least one model");
  });

  it("does not allow supported-model metadata to alter routing", () => {
    expect(() => (AVAILABLE_MODELS as unknown as string[]).push("injected-model"))
      .toThrow();

    const strategy = ModelStrategyFactory.createStrategy({ type: "round-robin" });
    expect(strategy.getDescription()).not.toContain("injected-model");
  });

  it("lists all available strategies", () => {
    const strategies = ModelStrategyFactory.getAvailableStrategies();

    expect(strategies).toHaveLength(4);
    expect(strategies.map(s => s.type)).toEqual([
      "mixed",
      "smart",
      "fixed",
      "round-robin",
    ]);
  });
});

// ── service-install ───────────────────────────────────────────────────────────

function createMockRunner(
  responses: Record<string, { stdout?: string; stderr?: string; exitCode: number }>
) {
  return vi.fn(async (command: string, args: string[]) => {
    const key = [command, ...args].join(" ");
    const response = responses[key];
    if (!response) {
      return { stdout: "", stderr: "", exitCode: 0 };
    }
    return {
      stdout: response.stdout ?? "",
      stderr: response.stderr ?? "",
      exitCode: response.exitCode
    };
  });
}

function createPassingCheck(): CommandCheck {
  return {
    id: "check-pass",
    async run() {
      // passes by not throwing
    }
  };
}

function createFailingThenPassingCheck(): CommandCheck {
  let called = false;
  return {
    id: "check-fail-then-pass",
    async run() {
      if (!called) {
        called = true;
        throw new Error("Not installed");
      }
    }
  };
}

describe("runServiceInstall", () => {
  describe("platform filtering", () => {
    it("runs only steps matching the current platform", async () => {
      const runCommand = createMockRunner({});
      const logs: string[] = [];

      const definition: ServiceInstallDefinition = {
        id: "test-service",
        summary: "Test Service",
        check: createFailingThenPassingCheck(),
        steps: [
          {
            id: "darwin-step",
            command: "darwin-cmd",
            args: ["arg1"],
            platforms: ["darwin"]
          },
          {
            id: "linux-step",
            command: "linux-cmd",
            args: ["arg1"],
            platforms: ["linux"]
          },
          {
            id: "win32-step",
            command: "win32-cmd",
            args: ["arg1"],
            platforms: ["win32"]
          }
        ]
      };

      const context: InstallContext = {
        isDryRun: false,
        runCommand,
        logger: (msg) => logs.push(msg),
        platform: "darwin"
      };

      await runServiceInstall(definition, context);

      expect(runCommand).toHaveBeenCalledWith("darwin-cmd", ["arg1"]);
      expect(runCommand).not.toHaveBeenCalledWith("linux-cmd", ["arg1"]);
      expect(runCommand).not.toHaveBeenCalledWith("win32-cmd", ["arg1"]);
    });

    it("runs steps without platform restriction on all platforms", async () => {
      const runCommand = createMockRunner({});
      const logs: string[] = [];

      const definition: ServiceInstallDefinition = {
        id: "test-service",
        summary: "Test Service",
        check: createFailingThenPassingCheck(),
        steps: [
          {
            id: "universal-step",
            command: "universal-cmd",
            args: []
          },
          {
            id: "darwin-only-step",
            command: "darwin-cmd",
            args: [],
            platforms: ["darwin"]
          }
        ]
      };

      const context: InstallContext = {
        isDryRun: false,
        runCommand,
        logger: (msg) => logs.push(msg),
        platform: "linux"
      };

      await runServiceInstall(definition, context);

      expect(runCommand).toHaveBeenCalledWith("universal-cmd", []);
      expect(runCommand).not.toHaveBeenCalledWith("darwin-cmd", []);
    });

    it("runs steps matching multiple platforms", async () => {
      const runCommand = createMockRunner({});
      const logs: string[] = [];

      const definition: ServiceInstallDefinition = {
        id: "test-service",
        summary: "Test Service",
        check: createFailingThenPassingCheck(),
        steps: [
          {
            id: "unix-step",
            command: "unix-cmd",
            args: [],
            platforms: ["darwin", "linux"]
          },
          {
            id: "win32-step",
            command: "win32-cmd",
            args: [],
            platforms: ["win32"]
          }
        ]
      };

      const context: InstallContext = {
        isDryRun: false,
        runCommand,
        logger: (msg) => logs.push(msg),
        platform: "linux"
      };

      await runServiceInstall(definition, context);

      expect(runCommand).toHaveBeenCalledWith("unix-cmd", []);
      expect(runCommand).not.toHaveBeenCalledWith("win32-cmd", []);
    });

    it("filters steps correctly in dry run mode", async () => {
      const runCommand = createMockRunner({});
      const logs: string[] = [];

      const definition: ServiceInstallDefinition = {
        id: "test-service",
        summary: "Test Service",
        check: createFailingThenPassingCheck(),
        steps: [
          {
            id: "darwin-step",
            command: "darwin-cmd",
            args: [],
            platforms: ["darwin"]
          },
          {
            id: "linux-step",
            command: "linux-cmd",
            args: [],
            platforms: ["linux"]
          }
        ]
      };

      const context: InstallContext = {
        isDryRun: true,
        runCommand,
        logger: (msg) => logs.push(msg),
        platform: "darwin"
      };

      await runServiceInstall(definition, context);

      expect(logs.some((msg) => msg.includes("darwin-cmd"))).toBe(true);
      expect(logs.some((msg) => msg.includes("linux-cmd"))).toBe(false);
    });
  });

  describe("skips installation when already installed", () => {
    it("does not run steps when check passes", async () => {
      const runCommand = createMockRunner({});
      const logs: string[] = [];

      const definition: ServiceInstallDefinition = {
        id: "test-service",
        summary: "Test Service",
        check: createPassingCheck(),
        steps: [
          {
            id: "install-step",
            command: "install-cmd",
            args: []
          }
        ]
      };

      const context: InstallContext = {
        isDryRun: false,
        runCommand,
        logger: (msg) => logs.push(msg),
        platform: "darwin"
      };

      const result = await runServiceInstall(definition, context);

      expect(result).toBe(false);
      expect(runCommand).not.toHaveBeenCalled();
      expect(logs.some((msg) => msg.includes("already installed"))).toBe(true);
    });
  });
});

// ── version-service ───────────────────────────────────────────────────────────

function createMockHttpClient(
  response: { ok: boolean; status: number; json: () => Promise<unknown> } | Error
): HttpClient {
  return vi.fn(async () => {
    if (response instanceof Error) {
      throw response;
    }
    return response;
  });
}

describe("version service", () => {
  describe("checkForUpdate", () => {
    it("returns update available when registry version is newer", async () => {
      const httpClient = createMockHttpClient({
        ok: true,
        status: 200,
        json: async () => ({ "dist-tags": { latest: "2.0.0" } })
      });

      const result = await checkForUpdate({
        currentVersion: "1.0.0",
        httpClient
      });

      expect(result).toEqual<VersionCheckResult>({
        currentVersion: "1.0.0",
        latestVersion: "2.0.0",
        updateAvailable: true
      });
      expect(httpClient).toHaveBeenCalledWith(
        "https://registry.npmjs.org/poe-code",
        expect.objectContaining({ method: "GET" })
      );
    });

    it("returns no update when versions match", async () => {
      const httpClient = createMockHttpClient({
        ok: true,
        status: 200,
        json: async () => ({ "dist-tags": { latest: "1.0.0" } })
      });

      const result = await checkForUpdate({
        currentVersion: "1.0.0",
        httpClient
      });

      expect(result).toEqual<VersionCheckResult>({
        currentVersion: "1.0.0",
        latestVersion: "1.0.0",
        updateAvailable: false
      });
    });

    it("returns no update when current version is newer", async () => {
      const httpClient = createMockHttpClient({
        ok: true,
        status: 200,
        json: async () => ({ "dist-tags": { latest: "1.0.0" } })
      });

      const result = await checkForUpdate({
        currentVersion: "2.0.0",
        httpClient
      });

      expect(result).toEqual<VersionCheckResult>({
        currentVersion: "2.0.0",
        latestVersion: "1.0.0",
        updateAvailable: false
      });
    });

    it("returns null when http request fails", async () => {
      const httpClient = createMockHttpClient(new Error("Network error"));

      const result = await checkForUpdate({
        currentVersion: "1.0.0",
        httpClient
      });

      expect(result).toBeNull();
    });

    it("returns null when response is not ok", async () => {
      const httpClient = createMockHttpClient({
        ok: false,
        status: 404,
        json: async () => ({})
      });

      const result = await checkForUpdate({
        currentVersion: "1.0.0",
        httpClient
      });

      expect(result).toBeNull();
    });

    it("returns null when response has invalid structure", async () => {
      const httpClient = createMockHttpClient({
        ok: true,
        status: 200,
        json: async () => ({ unexpected: "structure" })
      });

      const result = await checkForUpdate({
        currentVersion: "1.0.0",
        httpClient
      });

      expect(result).toBeNull();
    });

    it("returns null when latest version is not valid semver", async () => {
      const httpClient = createMockHttpClient({
        ok: true,
        status: 200,
        json: async () => ({ "dist-tags": { latest: "not-a-version" } })
      });

      const result = await checkForUpdate({
        currentVersion: "1.0.0",
        httpClient
      });

      expect(result).toBeNull();
    });

    it("handles dev version correctly", async () => {
      const httpClient = createMockHttpClient({
        ok: true,
        status: 200,
        json: async () => ({ "dist-tags": { latest: "1.0.0" } })
      });

      const result = await checkForUpdate({
        currentVersion: "0.0.0-dev",
        httpClient
      });

      expect(result).toEqual<VersionCheckResult>({
        currentVersion: "0.0.0-dev",
        latestVersion: "1.0.0",
        updateAvailable: true
      });
    });
  });
});
