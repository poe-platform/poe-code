import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { Volume, createFsFromVolume } from "memfs";
import { resolveConfigPath } from "@poe-code/poe-code-config";
import { createProgram } from "../program.js";
import type { FileSystem } from "../utils/file-system.js";
import type { CommandRunner } from "../../utils/command-checks.js";
import type { LlmClient } from "../services/llm-client.js";
import { DEFAULT_CLAUDE_CODE_MODEL, stripModelNamespace, DEFAULT_IMAGE_BOT, DEFAULT_VIDEO_BOT, DEFAULT_AUDIO_BOT } from "../constants.js";
import { createSecretStore } from "auth-store";
import * as clientInstance from "../../services/client-instance.js";
import * as mcpServer from "../mcp-server.js";
import { storeTestApiKey } from "../../../tests/test-helpers.js";

const {
  configureMock,
  unconfigureMock,
  resolveAgentSupportMock
} = vi.hoisted(() => ({
  configureMock: vi.fn(),
  unconfigureMock: vi.fn(),
  resolveAgentSupportMock: vi.fn()
}));

vi.mock("../oauth-login.js", () => ({
  resolveApiKeyViaOAuth: vi.fn(async () => "sk-poe-OAuthKeyFromBrowserFlowTestValue1234567890abc")
}));

vi.mock("@poe-code/agent-mcp-config", () => ({
  supportedAgents: ["claude-desktop", "claude-code", "codex"],
  configure: configureMock,
  unconfigure: unconfigureMock,
  resolveAgentSupport: resolveAgentSupportMock
}));

vi.mock("poe-oauth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("poe-oauth")>();
  return {
    ...actual,
    checkAuth: vi.fn(async () => ({ email: "test@example.com", balance: null }))
  };
});

// Valid-format API keys for tests (43+ alphanumeric characters)
const TEST_KEY = "sk-poe-TestKeyValue1234567890abcdefghijklmnop";
const ENV_KEY = "sk-poe-EnvKeyValue01234567890abcdefghijklmnop";
const FLAG_KEY = "sk-poe-FlagKeyValue1234567890abcdefghijklmnop";
const PROMPT_KEY = "sk-poe-PromptKeyVal1234567890abcdefghijklmnop";
const NEW_KEY = "sk-poe-NewKeyValue01234567890abcdefghijklmnop";
const MANUAL_KEY = "sk-poe-ManualKeyVal1234567890abcdefghijklmnop";
const DRY_KEY = "sk-poe-DryRunKeyVal1234567890abcdefghijklmnop";
const OAUTH_KEY = "sk-poe-OAuthKeyFromBrowserFlowTestValue1234567890abc";

const VALID_API_KEY = "vnlaoHCddCx7eAGLgdH4iS-g_1MYPsg0JnTRPF1qMuo";

function createLoginMemfs(homeDir: string): FileSystem {
  const volume = new Volume();
  volume.mkdirSync(homeDir, { recursive: true });
  return createFsFromVolume(volume).promises as unknown as FileSystem;
}

function readStoredApiKey(fs: FileSystem, homeDir: string): Promise<string | null> {
  const authFs = {
    readFile: (filePath: string, encoding: BufferEncoding) => fs.readFile(filePath, encoding),
    writeFile: (
      filePath: string,
      data: string | NodeJS.ArrayBufferView,
      opts?: { encoding?: BufferEncoding }
    ) => fs.writeFile(filePath, data, opts),
    mkdir: (directoryPath: string, opts?: { recursive?: boolean }) =>
      fs.mkdir(directoryPath, opts).then(() => undefined),
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

function createMcpMemfs(): FileSystem {
  const volume = new Volume();
  const mcpHomeDir = "/home/test";
  const mcpCwd = "/repo";
  volume.mkdirSync(mcpHomeDir, { recursive: true });
  volume.mkdirSync(mcpCwd, { recursive: true });
  volume.mkdirSync(`${mcpHomeDir}/.poe-code`, { recursive: true });
  return createFsFromVolume(volume).promises as unknown as FileSystem;
}

async function createMcpProgram(options?: {
  fs?: FileSystem;
  variables?: Record<string, string | undefined>;
}) {
  const fs = options?.fs ?? createMcpMemfs();
  await storeTestApiKey(fs, "/home/test", "test-api-key");
  const program = createProgram({
    fs,
    prompts: vi.fn(),
    env: { cwd: "/repo", homeDir: "/home/test", variables: { POE_CODE_OAUTH_LOGIN: "0", ...options?.variables } },
    logger: () => {},
    suppressCommanderOutput: true
  });
  return { program, fs };
}

describe("login command", () => {
  const cwd = "/repo";
  const homeDir = "/home/test";
  const configPath = resolveConfigPath(homeDir);
  let fs: FileSystem;
  let logs: string[];
  let prompts: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fs = createLoginMemfs(homeDir);
    logs = [];
    prompts = vi.fn();
  });

  it("stores the provided api key flag", async () => {
    const commandRunner: CommandRunner = vi.fn(async () => ({
      stdout: "",
      stderr: "",
      exitCode: 0
    }));
    const program = createProgram({
      fs,
      prompts,
      env: { cwd, homeDir },
      commandRunner,
      logger: (message) => {
        logs.push(message);
      }
    });

    const optsSpy = vi.spyOn(program, "optsWithGlobals");
    optsSpy.mockReturnValue({ yes: true, dryRun: false } as any);

    await program.parseAsync(["node", "cli", "login", "--api-key", TEST_KEY]);

    const storedKey = await readStoredApiKey(fs, homeDir);
    expect(storedKey).toBe(TEST_KEY);
    expect(prompts).not.toHaveBeenCalled();
    expect(logs.some((message) => message.includes("Logged in."))).toBe(true);

    await expect(fs.stat(`${homeDir}/.claude/settings.json`)).rejects.toBeTruthy();
    await expect(fs.stat(`${homeDir}/.codex/config.toml`)).rejects.toBeTruthy();
    await expect(fs.stat(`${homeDir}/.config/opencode/config.json`)).rejects.toBeTruthy();
  });

  it("reads API key from POE_API_KEY env variable when flag not provided", async () => {
    const commandRunner: CommandRunner = vi.fn(async () => ({
      stdout: "",
      stderr: "",
      exitCode: 0
    }));
    const program = createProgram({
      fs,
      prompts,
      env: { cwd, homeDir, variables: { POE_API_KEY: ENV_KEY } },
      commandRunner,
      logger: (message) => {
        logs.push(message);
      }
    });

    const optsSpy = vi.spyOn(program, "optsWithGlobals");
    optsSpy.mockReturnValue({ yes: true, dryRun: false } as any);

    await program.parseAsync(["node", "cli", "login"]);

    const storedKey = await readStoredApiKey(fs, homeDir);
    expect(storedKey).toBe(ENV_KEY);
    expect(prompts).not.toHaveBeenCalled();
  });

  it("prefers --api-key flag over POE_API_KEY env variable", async () => {
    const commandRunner: CommandRunner = vi.fn(async () => ({
      stdout: "",
      stderr: "",
      exitCode: 0
    }));
    const program = createProgram({
      fs,
      prompts,
      env: { cwd, homeDir, variables: { POE_API_KEY: ENV_KEY } },
      commandRunner,
      logger: (message) => {
        logs.push(message);
      }
    });

    const optsSpy = vi.spyOn(program, "optsWithGlobals");
    optsSpy.mockReturnValue({ yes: true, dryRun: false } as any);

    await program.parseAsync(["node", "cli", "login", "--api-key", FLAG_KEY]);

    const storedKey = await readStoredApiKey(fs, homeDir);
    expect(storedKey).toBe(FLAG_KEY);
    expect(prompts).not.toHaveBeenCalled();
  });

  it("prompts for an api key when flag missing and OAuth disabled", async () => {
    prompts.mockResolvedValue({ apiKey: PROMPT_KEY });
    const commandRunner: CommandRunner = vi.fn(async () => ({
      stdout: "",
      stderr: "",
      exitCode: 0
    }));
    const program = createProgram({
      fs,
      prompts,
      env: { cwd, homeDir, variables: { POE_CODE_OAUTH_LOGIN: "0" } },
      commandRunner,
      logger: (message) => {
        logs.push(message);
      }
    });

    const optsSpy = vi.spyOn(program, "optsWithGlobals");
    optsSpy.mockReturnValue({ yes: true, dryRun: false } as any);

    await program.parseAsync(["node", "cli", "login"]);

    const storedKey = await readStoredApiKey(fs, homeDir);
    expect(storedKey).toBe(PROMPT_KEY);
    expect(prompts).toHaveBeenCalledTimes(1);
    const [descriptor] = prompts.mock.calls[0]!;
    expect(descriptor.message).toContain("Poe API key");
  });

  it("reconfigures all previously configured services with new api key", async () => {
    const volume = new Volume();
    volume.mkdirSync(homeDir, { recursive: true });
    volume.mkdirSync(`${homeDir}/.claude`, { recursive: true });
    volume.mkdirSync(`${homeDir}/.poe-code`, { recursive: true });

    volume.writeFileSync(
      `${homeDir}/.claude/settings.json`,
      JSON.stringify({ apiKeyHelper: "echo old-key", model: "claude-sonnet-4.6" })
    );
    volume.writeFileSync(
      configPath,
      JSON.stringify({
        apiKey: "old-key",
        configured_services: {
          "claude-code": { files: [`${homeDir}/.claude/settings.json`] }
        }
      })
    );

    fs = createFsFromVolume(volume).promises as unknown as FileSystem;

    const commandRunner: CommandRunner = vi.fn(async () => ({
      stdout: "",
      stderr: "",
      exitCode: 0
    }));
    const program = createProgram({
      fs,
      prompts,
      env: { cwd, homeDir },
      commandRunner,
      logger: (message) => {
        logs.push(message);
      }
    });

    const optsSpy = vi.spyOn(program, "optsWithGlobals");
    optsSpy.mockReturnValue({ yes: true, dryRun: false } as any);

    await program.parseAsync(["node", "cli", "login", "--api-key", NEW_KEY]);

    const settingsRaw = await fs.readFile(`${homeDir}/.claude/settings.json`, "utf8");
    const settings = JSON.parse(settingsRaw);
    expect(settings.apiKeyHelper).toBe(`echo ${NEW_KEY}`);
    expect(settings.model).toBe(stripModelNamespace(DEFAULT_CLAUDE_CODE_MODEL));
  });

  it("uses OAuth flow by default", async () => {
    const commandRunner: CommandRunner = vi.fn(async () => ({
      stdout: "",
      stderr: "",
      exitCode: 0
    }));
    const program = createProgram({
      fs,
      prompts,
      env: { cwd, homeDir, variables: {} },
      commandRunner,
      logger: (message) => {
        logs.push(message);
      }
    });

    const optsSpy = vi.spyOn(program, "optsWithGlobals");
    optsSpy.mockReturnValue({ yes: true, dryRun: false } as any);

    await program.parseAsync(["node", "cli", "login"]);

    const storedKey = await readStoredApiKey(fs, homeDir);
    expect(storedKey).toBe(OAUTH_KEY);
    expect(prompts).not.toHaveBeenCalled();
    expect(logs.some((message) => message.includes("Logged in."))).toBe(true);
  });

  it("prefers --api-key flag over OAuth flow", async () => {
    const commandRunner: CommandRunner = vi.fn(async () => ({
      stdout: "",
      stderr: "",
      exitCode: 0
    }));
    const program = createProgram({
      fs,
      prompts,
      env: { cwd, homeDir, variables: {} },
      commandRunner,
      logger: (message) => {
        logs.push(message);
      }
    });

    const optsSpy = vi.spyOn(program, "optsWithGlobals");
    optsSpy.mockReturnValue({ yes: true, dryRun: false } as any);

    await program.parseAsync(["node", "cli", "login", "--api-key", MANUAL_KEY]);

    const storedKey = await readStoredApiKey(fs, homeDir);
    expect(storedKey).toBe(MANUAL_KEY);
  });

  it("skips writing config during dry run", async () => {
    const commandRunner: CommandRunner = vi.fn(async () => ({
      stdout: "",
      stderr: "",
      exitCode: 0
    }));
    const program = createProgram({
      fs,
      prompts,
      env: { cwd, homeDir },
      commandRunner,
      logger: (message) => {
        logs.push(message);
      },
      exitOverride: true
    });

    prompts.mockResolvedValue({ apiKey: DRY_KEY });

    const optsSpy = vi.spyOn(program, "optsWithGlobals");
    optsSpy.mockReturnValue({ yes: true, dryRun: true } as any);

    await program.parseAsync(["node", "cli", "--dry-run", "login", "--api-key", DRY_KEY]);

    const storedKey = await readStoredApiKey(fs, homeDir);
    expect(storedKey).toBeNull();
    expect(logs.some((message) => message.includes("Dry run: would save API key."))).toBe(true);
  });
});

describe("mcp command", () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    configureMock.mockReset();
    unconfigureMock.mockReset();
    resolveAgentSupportMock.mockReset();
    resolveAgentSupportMock.mockImplementation((input: string) => ({
      status: "supported",
      input,
      id: input
    }));
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  describe("poe-code mcp serve --help", () => {
    it("includes JSON config and tools documentation", async () => {
      const { program } = await createMcpProgram();
      let helpOutput = "";
      const outputConfig = {
        writeOut: (str: string) => { helpOutput += str; },
        writeErr: (str: string) => { helpOutput += str; }
      };
      program.configureOutput(outputConfig);
      for (const cmd of program.commands) {
        cmd.configureOutput(outputConfig);
        for (const sub of cmd.commands) {
          sub.configureOutput(outputConfig);
        }
      }

      try {
        await program.parseAsync(["node", "cli", "mcp", "serve", "--help"]);
      } catch {
        // Commander exits on --help
      }

      expect(helpOutput).toContain("poe-code");
      expect(helpOutput).toContain("mcp");
      expect(helpOutput).not.toContain("Available Agents");
      expect(helpOutput).not.toContain("--agent");
      expect(helpOutput).toContain("--output-format");
      expect(helpOutput).toContain('Preferred MCP media output format');
      expect(helpOutput).toContain('"markdown"');
      expect(helpOutput).toContain("cannot be combined");
      expect(helpOutput).toContain("Available Tools");
      expect(helpOutput).toContain("generate_text");
      expect(helpOutput).toContain("generate_image");
      expect(helpOutput).toContain("generate_video");
      expect(helpOutput).toContain("generate_audio");
    });
  });

  it("shows argument descriptions for configure and unconfigure help", async () => {
    const { program } = await createMcpProgram();
    let helpOutput = "";
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
      for (const sub of cmd.commands) {
        sub.configureOutput(outputConfig);
      }
    }

    try {
      await program.parseAsync(["node", "cli", "mcp", "configure", "--help"]);
    } catch {
      // Commander exits on --help.
    }

    expect(helpOutput).toContain("Usage: poe-code mcp configure [options] [agent]");
    expect(helpOutput).toContain("Arguments:");
    expect(helpOutput).toContain("agent");
    expect(helpOutput).toContain("Agent to configure");

    helpOutput = "";

    try {
      await program.parseAsync(["node", "cli", "mcp", "unconfigure", "--help"]);
    } catch {
      // Commander exits on --help.
    }

    expect(helpOutput).toContain("Usage: poe-code mcp unconfigure [options] <agent>");
    expect(helpOutput).toContain("Arguments:");
    expect(helpOutput).toContain("Agent to unconfigure");
  });

  it("rejects --agent with unknown option error", async () => {
    const { program } = await createMcpProgram();
    const exitSpy = vi.spyOn(process, "exit").mockImplementation((code?: number) => {
      throw new Error(`exit:${code}`);
    });
    try {
      await expect(
        program.parseAsync(["node", "cli", "mcp", "serve", "--agent", "claude-code"])
      ).rejects.toThrow("unknown option '--agent'");
    } finally {
      exitSpy.mockRestore();
    }
  });

  it("defaults --output-format to url", async () => {
    const { program } = await createMcpProgram();
    const initSpy = vi
      .spyOn(clientInstance, "initializeClient")
      .mockResolvedValue(undefined);
    const transportSpy = vi
      .spyOn(mcpServer, "runMcpServerWithTransport")
      .mockResolvedValue(undefined);

    try {
      await program.parseAsync(["node", "cli", "mcp", "serve"]);
      expect(transportSpy).toHaveBeenCalledWith(["url"]);
    } finally {
      initSpy.mockRestore();
      transportSpy.mockRestore();
    }
  });

  it("parses comma-separated --output-format preferences", async () => {
    const { program } = await createMcpProgram();
    const initSpy = vi
      .spyOn(clientInstance, "initializeClient")
      .mockResolvedValue(undefined);
    const transportSpy = vi
      .spyOn(mcpServer, "runMcpServerWithTransport")
      .mockResolvedValue(undefined);

    try {
      await program.parseAsync([
        "node",
        "cli",
        "mcp",
        "serve",
        "--output-format",
        "base64,url"
      ]);
      expect(transportSpy).toHaveBeenCalledWith(["base64", "url"]);
    } finally {
      initSpy.mockRestore();
      transportSpy.mockRestore();
    }
  });

  it("passes markdown --output-format preference to transport", async () => {
    const { program } = await createMcpProgram();
    const initSpy = vi
      .spyOn(clientInstance, "initializeClient")
      .mockResolvedValue(undefined);
    const transportSpy = vi
      .spyOn(mcpServer, "runMcpServerWithTransport")
      .mockResolvedValue(undefined);

    try {
      await program.parseAsync([
        "node",
        "cli",
        "mcp",
        "serve",
        "--output-format",
        "markdown"
      ]);
      expect(transportSpy).toHaveBeenCalledWith(["markdown"]);
    } finally {
      initSpy.mockRestore();
      transportSpy.mockRestore();
    }
  });

  it("rejects invalid --output-format values", async () => {
    const { program } = await createMcpProgram();
    await expect(
      program.parseAsync([
        "node",
        "cli",
        "mcp",
        "serve",
        "--output-format",
        "gif,url"
      ])
    ).rejects.toThrow("--output-format");
  });

  it("rejects empty --output-format entries", async () => {
    const { program } = await createMcpProgram();
    await expect(
      program.parseAsync([
        "node",
        "cli",
        "mcp",
        "serve",
        "--output-format",
        "base64,,url"
      ])
    ).rejects.toThrow("empty");
  });

  it("shows login screen and prompts for API key when config is missing for configure", async () => {
    const volume = new Volume();
    volume.mkdirSync("/home/test", { recursive: true });
    volume.mkdirSync("/repo", { recursive: true });
    const noConfigFs = createFsFromVolume(volume).promises as unknown as FileSystem;
    const logs: string[] = [];
    const prompts = vi.fn().mockResolvedValue({ apiKey: VALID_API_KEY });
    const program = createProgram({
      fs: noConfigFs,
      prompts,
      env: { cwd: "/repo", homeDir: "/home/test", variables: { POE_CODE_OAUTH_LOGIN: "0" } },
      logger: (message) => { logs.push(message); },
      suppressCommanderOutput: true
    });

    await program.parseAsync(["node", "cli", "mcp", "configure", "claude-desktop"]);

    expect(prompts).toHaveBeenCalled();
    expect(logs.some(m => m.includes("login"))).toBe(true);
    expect(logs.some(m => m.includes("Logged in"))).toBe(true);
    expect(configureMock).toHaveBeenCalled();
  });

  it("rejects invalid agent names for configure", async () => {
    resolveAgentSupportMock.mockReturnValue({
      status: "unknown",
      input: "unknown"
    });
    const { program } = await createMcpProgram();
    await program.parseAsync(["node", "cli", "mcp", "configure", "unknown"]);

    expect(configureMock).not.toHaveBeenCalled();
  });

  it("configures with serve command and mapped profile", async () => {
    const { program } = await createMcpProgram();
    await program.parseAsync(["node", "cli", "mcp", "configure", "claude-desktop"]);

    expect(configureMock).toHaveBeenCalledTimes(1);
    const [, entry] = configureMock.mock.calls[0] ?? [];
    expect(entry).toEqual(
      expect.objectContaining({
        config: expect.objectContaining({
          args: expect.arrayContaining(["mcp", "serve"])
        })
      })
    );
    expect(entry.config.args).not.toContain("--agent");
  });

  it("configures aliases using the resolved agent id", async () => {
    resolveAgentSupportMock.mockReturnValue({
      status: "supported",
      input: "claude",
      id: "claude-code"
    });
    const { program } = await createMcpProgram();

    await program.parseAsync(["node", "cli", "mcp", "configure", "claude"]);

    expect(configureMock).toHaveBeenCalledTimes(1);
    const [, entry] = configureMock.mock.calls[0] ?? [];
    expect(entry.config.args).toEqual(expect.arrayContaining(["mcp", "serve"]));
    expect(entry.config.args).not.toContain("--agent");
  });

  it("includes --output-format when agent config has mcpOutputFormat", async () => {
    resolveAgentSupportMock.mockReturnValue({
      status: "supported",
      input: "claude-desktop",
      id: "claude-desktop",
      config: { mcpOutputFormat: "markdown_instructions" }
    });
    const { program } = await createMcpProgram();
    await program.parseAsync(["node", "cli", "mcp", "configure", "claude-desktop"]);

    expect(configureMock).toHaveBeenCalledTimes(1);
    const [, entry] = configureMock.mock.calls[0] ?? [];
    expect(entry.config.args).toContain("--output-format");
    expect(entry.config.args).toContain("markdown_instructions");
  });

  it("omits --output-format when agent config has no mcpOutputFormat", async () => {
    const { program } = await createMcpProgram();
    await program.parseAsync(["node", "cli", "mcp", "configure", "claude-code"]);

    expect(configureMock).toHaveBeenCalledTimes(1);
    const [, entry] = configureMock.mock.calls[0] ?? [];
    expect(entry.config.args).not.toContain("--output-format");
  });

  it("rejects agents that are known but not supported for MCP", async () => {
    resolveAgentSupportMock.mockReturnValue({
      status: "unsupported",
      input: "claude-code",
      id: "claude-code"
    });
    const { program } = await createMcpProgram();

    await program.parseAsync(["node", "cli", "mcp", "configure", "claude-code"]);

    expect(configureMock).not.toHaveBeenCalled();
  });
});

describe("mcp server tools", () => {
  let mockClient: LlmClient;

  beforeEach(() => {
    mockClient = {
      text: vi.fn(async () => ({ content: "Hello from bot" })),
      media: vi.fn(async () => ({
        url: "https://example.com/media.png",
        mimeType: "image/png"
      }))
    };
    clientInstance.setGlobalClient(mockClient);
  });

  it("generate_text uses client.text()", async () => {
    const { generateText } = await import("../mcp-server.js");

    const result = await generateText({
      bot_name: "Claude-Haiku-4.5",
      message: "Hello"
    });

    expect(mockClient.text).toHaveBeenCalledWith({
      model: "Claude-Haiku-4.5",
      prompt: "Hello",
      params: undefined
    });
    expect(result).toEqual([{ type: "text", text: "Hello from bot" }]);
  });

  it("generate_text passes params", async () => {
    const { generateText } = await import("../mcp-server.js");

    await generateText({
      bot_name: "test-bot",
      message: "Test",
      params: { temperature: "0.5" }
    });

    expect(mockClient.text).toHaveBeenCalledWith({
      model: "test-bot",
      prompt: "Test",
      params: { temperature: "0.5" }
    });
  });

  it("generate_image uses client.media() with default bot", async () => {
    const { generateImage } = await import("../mcp-server.js");

    const result = await generateImage({
      prompt: "A sunset"
    });

    expect(mockClient.media).toHaveBeenCalledWith("image", {
      model: DEFAULT_IMAGE_BOT,
      prompt: "A sunset",
      params: undefined
    });
    expect(result).toEqual([{ type: "text", text: "https://example.com/media.png" }]);
  });

  it("generate_image renders markdown when requested", async () => {
    const { generateImage } = await import("../mcp-server.js");

    mockClient.media = vi.fn(async () => ({
      url: "https://example.com/media.png",
      mimeType: "image/png"
    }));

    const result = await generateImage({ prompt: "A sunset" }, ["markdown"]);

    expect(result).toEqual([
      { type: "text", text: "![Image](https://example.com/media.png)" }
    ]);
  });

  it("generate_image throws when markdown output is missing a URL", async () => {
    const { generateImage } = await import("../mcp-server.js");

    mockClient.media = vi.fn(async () => ({
      data: "BASE64IMAGE",
      mimeType: "image/png"
    }));

    await expect(generateImage({ prompt: "Test" }, ["markdown"])).rejects.toThrowError(
      new Error(
        "markdown output requires a URL for image. Model response did not include a URL."
      )
    );
  });

  it("generate_image renders markdown_instructions when requested", async () => {
    const { generateImage } = await import("../mcp-server.js");

    mockClient.media = vi.fn(async () => ({
      url: "https://example.com/media.png",
      mimeType: "image/png"
    }));

    const result = await generateImage({ prompt: "A sunset" }, ["markdown_instructions"]);

    expect(result).toEqual([
      {
        type: "text",
        text: "Render this image as markdown image tag in the chat\n\nimage_url: https://example.com/media.png"
      }
    ]);
  });

  it("generate_image throws when markdown_instructions output is missing a URL", async () => {
    const { generateImage } = await import("../mcp-server.js");

    mockClient.media = vi.fn(async () => ({
      data: "BASE64IMAGE",
      mimeType: "image/png"
    }));

    await expect(generateImage({ prompt: "Test" }, ["markdown_instructions"])).rejects.toThrowError(
      "markdown_instructions output requires a URL for image"
    );
  });

  it("generate_image emits base64 image blocks when preferred", async () => {
    const { generateImage } = await import("../mcp-server.js");

    mockClient.media = vi.fn(async () => ({
      data: "BASE64IMAGE",
      mimeType: "image/png"
    }));

    const result = await generateImage({ prompt: "A sunset" }, ["base64", "url"]);

    expect(result).toEqual([
      { type: "image", data: "BASE64IMAGE", mimeType: "image/png" }
    ]);
  });

  it("generate_image converts URL to base64 when preferred", async () => {
    const { generateImage } = await import("../mcp-server.js");

    mockClient.media = vi.fn(async () => ({
      url: "https://example.com/media.png"
    }));

    const pngBytes = Uint8Array.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x00
    ]);

    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      status: 200,
      statusText: "OK",
      headers: { get: () => null },
      arrayBuffer: async () => pngBytes.buffer
    } as unknown as Response);

    const result = await generateImage({ prompt: "A sunset" }, ["base64"]);

    expect(result).toEqual([
      { type: "image", data: Buffer.from(pngBytes).toString("base64"), mimeType: "image/png" }
    ]);
  });

  it("generate_image falls back to url when base64 conversion fails", async () => {
    const { generateImage } = await import("../mcp-server.js");

    mockClient.media = vi.fn(async () => ({
      url: "https://example.com/media.png"
    }));

    const result = await generateImage({ prompt: "A sunset" }, ["base64", "url"]);

    expect(fetch).toHaveBeenCalled();
    expect(result).toEqual([{ type: "text", text: "https://example.com/media.png" }]);
  });

  it("generate_image uses custom bot_name", async () => {
    const { generateImage } = await import("../mcp-server.js");

    await generateImage({
      prompt: "A cat",
      bot_name: "custom-image-bot"
    });

    expect(mockClient.media).toHaveBeenCalledWith("image", {
      model: "custom-image-bot",
      prompt: "A cat",
      params: undefined
    });
  });

  it("generate_video uses client.media() with default bot", async () => {
    const { generateVideo } = await import("../mcp-server.js");

    mockClient.media = vi.fn(async () => ({
      url: "https://example.com/video.mp4",
      mimeType: "video/mp4"
    }));

    const result = await generateVideo({
      prompt: "A rocket launch"
    });

    expect(mockClient.media).toHaveBeenCalledWith("video", {
      model: DEFAULT_VIDEO_BOT,
      prompt: "A rocket launch",
      params: undefined
    });
    expect(result).toEqual([{ type: "text", text: "https://example.com/video.mp4" }]);
  });

  it("generate_video renders markdown when requested", async () => {
    const { generateVideo } = await import("../mcp-server.js");

    mockClient.media = vi.fn(async () => ({
      url: "https://example.com/videos/clip",
      mimeType: "video/mp4"
    }));

    const result = await generateVideo({ prompt: "A rocket launch" }, ["markdown"]);

    expect(result).toEqual([
      { type: "text", text: "[clip](https://example.com/videos/clip)" }
    ]);
  });

  it("generate_video renders markdown_instructions when requested", async () => {
    const { generateVideo } = await import("../mcp-server.js");

    mockClient.media = vi.fn(async () => ({
      url: "https://example.com/videos/clip.mp4",
      mimeType: "video/mp4"
    }));

    const result = await generateVideo({ prompt: "A rocket launch" }, [
      "markdown_instructions"
    ]);

    expect(result).toEqual([
      {
        type: "text",
        text: "Render this video as markdown link in the chat\n\nvideo_url: https://example.com/videos/clip.mp4"
      }
    ]);
  });

  it("generate_video throws when markdown output is missing a URL", async () => {
    const { generateVideo } = await import("../mcp-server.js");

    mockClient.media = vi.fn(async () => ({
      mimeType: "video/mp4"
    }));

    await expect(
      generateVideo({ prompt: "A rocket launch" }, ["markdown"])
    ).rejects.toThrowError(
      new Error(
        "markdown output requires a URL for video. Model response did not include a URL."
      )
    );
  });

  it("generate_audio uses client.media() with default bot", async () => {
    const { generateAudio } = await import("../mcp-server.js");

    mockClient.media = vi.fn(async () => ({
      url: "https://example.com/audio.mp3",
      mimeType: "audio/mp3"
    }));

    const result = await generateAudio({
      prompt: "Hello world"
    });

    expect(mockClient.media).toHaveBeenCalledWith("audio", {
      model: DEFAULT_AUDIO_BOT,
      prompt: "Hello world",
      params: undefined
    });
    expect(result).toEqual([{ type: "text", text: "https://example.com/audio.mp3" }]);
  });

  it("generate_audio renders markdown when requested", async () => {
    const { generateAudio } = await import("../mcp-server.js");

    mockClient.media = vi.fn(async () => ({
      url: "https://example.com/audio/audio.mp3",
      mimeType: "audio/mpeg"
    }));

    const result = await generateAudio({ prompt: "Hello world" }, ["markdown"]);

    expect(result).toEqual([
      { type: "text", text: "[audio.mp3](https://example.com/audio/audio.mp3)" }
    ]);
  });

  it("generate_audio renders markdown_instructions when requested", async () => {
    const { generateAudio } = await import("../mcp-server.js");

    mockClient.media = vi.fn(async () => ({
      url: "https://example.com/audio/audio.mp3",
      mimeType: "audio/mpeg"
    }));

    const result = await generateAudio({ prompt: "Hello world" }, [
      "markdown_instructions"
    ]);

    expect(result).toEqual([
      {
        type: "text",
        text: "Render this audio as markdown link in the chat\n\naudio_url: https://example.com/audio/audio.mp3"
      }
    ]);
  });

  it("generate_audio throws when markdown output is missing a URL", async () => {
    const { generateAudio } = await import("../mcp-server.js");

    mockClient.media = vi.fn(async () => ({
      data: "BASE64AUDIO",
      mimeType: "audio/mpeg"
    }));

    await expect(generateAudio({ prompt: "Hello world" }, ["markdown"])).rejects.toThrowError(
      new Error(
        "markdown output requires a URL for audio. Model response did not include a URL."
      )
    );
  });

  it("extracts filenames from URL pathnames for markdown links", async () => {
    const { generateAudio, generateVideo } = await import("../mcp-server.js");

    mockClient.media = vi.fn(async () => ({
      url: "https://example.com/media/sound.mp3",
      mimeType: "audio/mpeg"
    }));

    await expect(generateAudio({ prompt: "Hello world" }, ["markdown"])).resolves.toEqual(
      [{ type: "text", text: "[sound.mp3](https://example.com/media/sound.mp3)" }]
    );

    mockClient.media = vi.fn(async () => ({
      url: "https://example.com/media/no-extension",
      mimeType: "video/mp4"
    }));

    await expect(
      generateVideo({ prompt: "A rocket launch" }, ["markdown"])
    ).resolves.toEqual([
      { type: "text", text: "[no-extension](https://example.com/media/no-extension)" }
    ]);

    mockClient.media = vi.fn(async () => ({
      url: "https://example.com/media/",
      mimeType: "audio/mpeg"
    }));

    await expect(generateAudio({ prompt: "Hello world" }, ["markdown"])).resolves.toEqual(
      [{ type: "text", text: "[audio](https://example.com/media/)" }]
    );
  });

  it("generate_audio emits base64 audio blocks when preferred", async () => {
    const { generateAudio } = await import("../mcp-server.js");

    mockClient.media = vi.fn(async () => ({
      data: "BASE64AUDIO",
      mimeType: "audio/mpeg"
    }));

    const result = await generateAudio({ prompt: "Hello world" }, ["base64", "url"]);

    expect(result).toEqual([
      { type: "audio", data: "BASE64AUDIO", mimeType: "audio/mpeg" }
    ]);
  });

  it("generate_image throws actionable error for url-only output", async () => {
    const { generateImage } = await import("../mcp-server.js");

    mockClient.media = vi.fn(async () => ({
      data: "BASE64IMAGE",
      mimeType: "image/png"
    }));

    await expect(generateImage({ prompt: "Test" })).rejects.toThrow(
      /Cannot produce url output for image/
    );
  });
});
