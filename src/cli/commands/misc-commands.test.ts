import { beforeEach, describe, it, expect, vi, afterEach } from "vitest";
import { Volume, createFsFromVolume } from "memfs";
import { Command, CommanderError } from "commander";
import { stripVTControlCharacters } from "node:util";
import { createProgram } from "../program.js";
import { resolveConfigPath, resolveProjectConfigPath } from "@poe-code/poe-code-config/core";
import { createCliContainer } from "../container.js";
import { registerUtilsCommand } from "./utils.js";
import { SilentError, ValidationError } from "../errors.js";
import type { FileSystem } from "../utils/file-system.js";

// ---------------------------------------------------------------------------
// agent-command hoisted mocks
// ---------------------------------------------------------------------------

const createAgentSessionMock = vi.hoisted(() => vi.fn());
const sendMessageMock = vi.hoisted(() => vi.fn());
const disposeMock = vi.hoisted(() => vi.fn());
const renderAcpEventMock = vi.hoisted(() => vi.fn());

vi.mock("@poe-code/poe-agent", () => ({
  createAgentSession: createAgentSessionMock,
  parseNullablePluginConfigEntries: (value: unknown) => value,
  parsePluginConfigEntries: (value: unknown) => value
}));

vi.mock("@poe-code/agent-spawn", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@poe-code/agent-spawn")>();
  return { ...actual, renderAcpEvent: renderAcpEventMock };
});

// ---------------------------------------------------------------------------
// config-command mocks
// ---------------------------------------------------------------------------

vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return {
    ...actual,
    execSync: vi.fn()
  };
});

// ---------------------------------------------------------------------------
// root-command hoisted mocks
// ---------------------------------------------------------------------------

const runCliState = vi.hoisted(() => ({
  argvSnapshots: [] as string[][],
  optionsSnapshots: [] as unknown[]
}));

vi.mock("toolcraft/cli", async () => {
  const actual = await vi.importActual<typeof import("toolcraft/cli")>("toolcraft/cli");
  return {
    ...actual,
    runCLI: vi.fn(async (_root, options) => {
      runCliState.argvSnapshots.push([...process.argv]);
      runCliState.optionsSnapshots.push(options);
    })
  };
});

// ---------------------------------------------------------------------------
// Shared constants
// ---------------------------------------------------------------------------

const cwd = "/repo";
const homeDir = "/home/test";
const globalConfigPath = resolveConfigPath(homeDir);
const projectConfigPath = resolveProjectConfigPath(cwd);

// ---------------------------------------------------------------------------
// agent-command.test.ts — agent command
// ---------------------------------------------------------------------------

describe("agent command", () => {
  function createMemFs(): FileSystem {
    const volume = new Volume();
    volume.mkdirSync(homeDir, { recursive: true });
    return createFsFromVolume(volume).promises as unknown as FileSystem;
  }

  beforeEach(() => {
    createAgentSessionMock.mockReset();
    sendMessageMock.mockReset();
    disposeMock.mockReset();
    renderAcpEventMock.mockReset();
    createAgentSessionMock.mockResolvedValue({
      sendMessage: sendMessageMock,
      dispose: disposeMock
    });
    sendMessageMock.mockResolvedValue({
      role: "assistant",
      content: "Hello from Poe agent"
    });
    disposeMock.mockResolvedValue(undefined);
  });

  it("creates a session, sends prompt, prints response, and disposes", async () => {
    const logs: string[] = [];
    const program = createProgram({
      fs: createMemFs(),
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir },
      logger: (message) => {
        logs.push(message);
      }
    });

    await program.parseAsync([
      "node",
      "cli",
      "agent",
      "Say hello",
      "--model",
      "Claude-Sonnet-4.5",
      "--api-key",
      "test-api-key"
    ]);

    expect(createAgentSessionMock).toHaveBeenCalledWith({
      model: "Claude-Sonnet-4.5",
      apiKey: "test-api-key",
      cwd
    });
    expect(sendMessageMock).toHaveBeenCalledWith("Say hello", expect.objectContaining({
      onSessionUpdate: expect.any(Function)
    }));
    expect(disposeMock).toHaveBeenCalledTimes(1);
    expect(logs.some((line) => line.includes("Hello from Poe agent"))).toBe(true);
  });

  it("prints the failure before closing the panel with the feedback footer", async () => {
    const logs: string[] = [];
    sendMessageMock.mockRejectedValue(new Error("Prompt must not be empty."));
    const program = createProgram({
      fs: createMemFs(),
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir },
      logger: (message) => {
        logs.push(message);
      }
    });

    await expect(program.parseAsync(["node", "cli", "agent", "Say hello", "--model", "test-model"])).rejects.toThrow(
      "Prompt must not be empty."
    );

    const errorIndex = logs.findIndex((line) => line.includes("Prompt must not be empty."));
    const footerIndex = logs.findIndex((line) => line.includes("Problems?"));
    expect(errorIndex).toBeGreaterThanOrEqual(0);
    expect(footerIndex).toBeGreaterThan(errorIndex);
    expect(disposeMock).toHaveBeenCalledTimes(1);
  });

  it("requires and advertises an explicit model", async () => {
    const program = createProgram({
      fs: createMemFs(),
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir },
      logger: () => {}
    });

    await expect(program.parseAsync(["node", "cli", "agent", "Say hello"])).rejects.toThrow(
      "--model <model>"
    );
    expect(createAgentSessionMock).not.toHaveBeenCalled();
    expect(program.commands.find((command) => command.name() === "agent")?.helpInformation()).toContain(
      "Model identifier"
    );
  });

  it.each([
    ["empty --model value", ["--model", ""], "--model cannot be empty."],
    ["whitespace-only --model value", ["--model", "  "], "--model cannot be empty."],
    ["empty --api-key value", ["--model", "test-model", "--api-key", ""], "--api-key cannot be empty."],
    ["whitespace-only --api-key value", ["--model", "test-model", "--api-key", " "], "--api-key cannot be empty."]
  ])("rejects %s instead of falling back", async (_name, flagArgs, message) => {
    const program = createProgram({
      fs: createMemFs(),
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir },
      logger: () => {}
    });

    await expect(
      program.parseAsync(["node", "cli", "agent", "Say hello", ...flagArgs])
    ).rejects.toThrow(message);
    expect(createAgentSessionMock).not.toHaveBeenCalled();
  });

  it("names an unknown model and points at the catalog command instead of sending it", async () => {
    const logs: string[] = [];
    const httpClient = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        data: [
          { id: "Claude-Sonnet-4.5", owned_by: "anthropic" },
          { id: "GPT-5", owned_by: "openai" }
        ]
      }),
      text: async () => ""
    });
    const program = createProgram({
      fs: createMemFs(),
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir },
      logger: (message) => {
        logs.push(message);
      },
      httpClient
    });

    await expect(
      program.parseAsync([
        "node",
        "cli",
        "agent",
        "Say hello",
        "--model",
        "not-real",
        "--api-key",
        "test-api-key"
      ])
    ).rejects.toThrow('Unknown model "not-real"');

    expect(createAgentSessionMock).not.toHaveBeenCalled();
    const output = logs.join("\n");
    expect(output).toContain('Unknown model "not-real"');
    expect(output).toContain("poe-code models");
  });

  it("sends a model the catalog lists", async () => {
    const httpClient = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ data: [{ id: "Claude-Sonnet-4.5", owned_by: "anthropic" }] }),
      text: async () => ""
    });
    const program = createProgram({
      fs: createMemFs(),
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir },
      logger: () => {},
      httpClient
    });

    await program.parseAsync([
      "node",
      "cli",
      "agent",
      "Say hello",
      "--model",
      "anthropic/Claude-Sonnet-4.5",
      "--api-key",
      "test-api-key"
    ]);

    expect(createAgentSessionMock).toHaveBeenCalledWith({
      model: "anthropic/Claude-Sonnet-4.5",
      apiKey: "test-api-key",
      cwd
    });
  });

  it("runs the prompt when the catalog cannot be read", async () => {
    const httpClient = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({}),
      text: async () => ""
    });
    const program = createProgram({
      fs: createMemFs(),
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir },
      logger: () => {},
      httpClient
    });

    await program.parseAsync([
      "node",
      "cli",
      "agent",
      "Say hello",
      "--model",
      "not-real",
      "--api-key",
      "test-api-key"
    ]);

    expect(createAgentSessionMock).toHaveBeenCalledWith({
      model: "not-real",
      apiKey: "test-api-key",
      cwd
    });
  });

  it("warns and documents POE_API_KEY when --api-key is passed on the command line", async () => {
    const logs: string[] = [];
    const program = createProgram({
      fs: createMemFs(),
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir },
      logger: (message) => {
        logs.push(message);
      }
    });

    await program.parseAsync(["node", "cli", "agent", "Say hello", "--model", "test-model", "--api-key", "sk-secret"]);

    const output = logs.join("\n");
    expect(output).toMatch(/shell history/i);
    expect(output).toContain("POE_API_KEY");
    expect(output).not.toContain("sk-secret");

    const help = program.commands.find((command) => command.name() === "agent")?.helpInformation() ?? "";
    expect(help).toContain("POE_API_KEY");
    expect(help).toMatch(/shell history/i);
  });

  it("does not warn about --api-key when the flag is omitted", async () => {
    const logs: string[] = [];
    const program = createProgram({
      fs: createMemFs(),
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir },
      logger: (message) => {
        logs.push(message);
      }
    });

    await program.parseAsync(["node", "cli", "agent", "Say hello", "--model", "test-model"]);

    expect(logs.join("\n")).not.toMatch(/shell history/i);
  });

  it("supports global dry-run mode", async () => {
    const logs: string[] = [];
    const program = createProgram({
      fs: createMemFs(),
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir },
      logger: (message) => {
        logs.push(message);
      }
    });

    await program.parseAsync([
      "node",
      "cli",
      "--dry-run",
      "agent",
      "Dry run prompt",
      "--model",
      "Claude-Sonnet-4.5",
      "--api-key",
      "test-api-key"
    ]);

    expect(createAgentSessionMock).not.toHaveBeenCalled();
    expect(logs.some((line) => line.includes("Dry run:"))).toBe(true);
  });

  it("renders session updates through shared ACP conversion", async () => {
    sendMessageMock.mockImplementation(
      (_prompt: string, opts?: { onSessionUpdate?: (update: unknown) => void }) => {
        opts?.onSessionUpdate?.({
          sessionUpdate: "agent_thought_chunk",
          content: { type: "text", text: "Checking workspace." }
        });
        opts?.onSessionUpdate?.({
          sessionUpdate: "tool_call",
          toolCallId: "call-1",
          title: "read_file",
          kind: "read",
          status: "pending",
          locations: [{ path: "src/index.ts" }]
        });
        opts?.onSessionUpdate?.({
          sessionUpdate: "tool_call_update",
          toolCallId: "call-1",
          status: "cancelled",
          rawOutput: { reason: "stopped" }
        });
        opts?.onSessionUpdate?.({
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text: "Here are the files." }
        });
        opts?.onSessionUpdate?.({
          sessionUpdate: "usage_update",
          used: 12,
          size: 18,
          cost: { amount: 0.02, currency: "USD" }
        });
        return Promise.resolve({ role: "assistant", content: "Here are the files." });
      }
    );

    const program = createProgram({
      fs: createMemFs(),
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir },
      logger: () => {}
    });

    await program.parseAsync([
      "node",
      "cli",
      "agent",
      "List files",
      "--model",
      "Claude-Sonnet-4.5",
      "--api-key",
      "key"
    ]);

    const events = renderAcpEventMock.mock.calls.map((call: unknown[]) => call[0]);
    expect(events).toEqual([
      { event: "reasoning", text: "Checking workspace." },
      { event: "tool_start", kind: "read", title: "src/index.ts", id: "call-1" },
      { event: "tool_complete", kind: "read", path: '{"reason":"stopped"}', id: "call-1" },
      { event: "agent_message", text: "Here are the files." },
      {
        event: "usage",
        inputTokens: 12,
        outputTokens: 0,
        cachedTokens: 6,
        costUsd: 0.02,
        costSource: "reported"
      }
    ]);
  });

  it("disposes the session when message send fails", async () => {
    sendMessageMock.mockRejectedValue(new Error("message failed"));

    const program = createProgram({
      fs: createMemFs(),
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir },
      logger: () => {}
    });

    await expect(
      program.parseAsync([
        "node",
        "cli",
        "agent",
        "Trigger failure",
        "--model",
        "Claude-Sonnet-4.5"
      ])
    ).rejects.toThrow("message failed");

    expect(disposeMock).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// config.test.ts — config command
// ---------------------------------------------------------------------------

describe("config command", () => {
  function createMemFs(): FileSystem {
    const volume = new Volume();
    volume.mkdirSync(homeDir, { recursive: true });
    volume.mkdirSync(cwd, { recursive: true });
    return createFsFromVolume(volume).promises as unknown as FileSystem;
  }

  function createBaseProgram(): Command {
    const program = new Command();
    program.exitOverride();
    program
      .name("poe-code")
      .option("-y, --yes")
      .option("--dry-run")
      .option("--verbose");
    return program;
  }

  let fs: FileSystem;
  let logs: string[];

  beforeEach(() => {
    vi.clearAllMocks();
    fs = createMemFs();
    logs = [];
  });

  it("shows global and project config paths with status", async () => {
    await fs.mkdir(`${homeDir}/.poe-code`, { recursive: true });
    await fs.writeFile(globalConfigPath, "{}\n", { encoding: "utf8" });

    const container = createCliContainer({
      fs,
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir },
      logger: (message) => logs.push(message)
    });
    const program = createBaseProgram();
    registerUtilsCommand(program, container);

    await program.parseAsync(["node", "cli", "utils", "config"]);

    expect(logs.some((message) => message.includes(`Global config: ${globalConfigPath} (exists)`)))
      .toBe(true);
    expect(logs.some((message) => message.includes(`Project config: ${projectConfigPath} (missing)`)))
      .toBe(true);
    expect(logs.some((message) => message.includes('Run "poe-code utils config show" to see resolved configuration')))
      .toBe(true);
  });

  it("shows global, project, env, and resolved config", async () => {
    await fs.mkdir(`${homeDir}/.poe-code`, { recursive: true });
    await fs.mkdir(`${cwd}/.poe-code`, { recursive: true });
    await fs.writeFile(
      globalConfigPath,
      `${JSON.stringify(
        {
          core: {
            apiKey: "sk-global",
            defaultAgent: "claude",
            poeBaseUrl: "https://global.example.test"
          }
        },
        null,
        2
      )}\n`,
      { encoding: "utf8" }
    );
    await fs.writeFile(
      projectConfigPath,
      `${JSON.stringify(
        {
          core: {
            apiKey: "sk-project",
            defaultAgent: "codex:gpt-5.4"
          },
          models: { default: "anthropic/claude-sonnet-4.5" }
        },
        null,
        2
      )}\n`,
      { encoding: "utf8" }
    );

    const container = createCliContainer({
      fs,
      prompts: vi.fn().mockResolvedValue({}),
      env: {
        cwd,
        homeDir,
        variables: {
          POE_API_KEY: "sk-env",
          POE_DEFAULT_AGENT: "opencode:o4-mini"
        }
      },
      logger: (message) => logs.push(message)
    });
    const program = createBaseProgram();
    registerUtilsCommand(program, container);

    await program.parseAsync(["node", "cli", "utils", "config", "show"]);

    const output = stripVTControlCharacters(logs.join("\n"));
    expect(output).toContain("Global config");
    expect(output).toContain("Project config");
    expect(output).toContain("Environment variable overrides");
    expect(output).toContain("Resolved (merged)");
    expect(output).toContain("core.apiKey");
    expect(output).toContain("<redacted>");
    expect(output).toContain("core.defaultAgent");
    expect(output).toContain("claude");
    expect(output).toContain("codex:gpt-5.4");
    expect(output).toContain("POE_API_KEY = <redacted>");
    expect(output).toContain("POE_DEFAULT_AGENT = opencode:o4-mini");
    expect(output).toContain("opencode:o4-mini");
    expect(output).toContain("core.poeBaseUrl");
    expect(output).toContain("https://global.example.test");
    expect(output).toContain("models.default");
    expect(output).toContain("anthropic/claude-sonnet-4.5");
    expect(output).not.toContain("sk-global");
    expect(output).not.toContain("sk-project");
    expect(output).not.toContain("sk-env");
  });

  it("summarizes resolved config as scannable rows instead of a nested JSON dump", async () => {
    await fs.mkdir(`${cwd}/.poe-code`, { recursive: true });
    await fs.writeFile(
      projectConfigPath,
      `${JSON.stringify({
        core: { apiKey: "sk-project", defaultAgent: "codex" },
        configured_services: {
          claude: { model: "Claude-Sonnet-4.5", baseUrl: "https://example.test" }
        }
      })}\n`,
      { encoding: "utf8" }
    );

    const container = createCliContainer({
      fs,
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir, variables: {} },
      logger: (message) => logs.push(message)
    });
    const program = createBaseProgram();
    registerUtilsCommand(program, container);

    await program.parseAsync(["node", "cli", "utils", "config", "show"]);

    const output = stripVTControlCharacters(logs.join("\n"));
    // The nested JSON dump is machine output and belongs behind --json.
    expect(output).not.toContain('"configured_services": {');
    expect(output).not.toContain('"defaultAgent": "codex"');
    expect(output).toContain("core.defaultAgent");
    expect(output).toContain("codex");
    expect(output).toContain("configured_services.claude");
    expect(output).toContain("<redacted>");
    expect(output).not.toContain("sk-project");
    expect(output).toContain("--json");
  });

  it("prints the full redacted config document with --json", async () => {
    await fs.mkdir(`${cwd}/.poe-code`, { recursive: true });
    await fs.writeFile(
      projectConfigPath,
      `${JSON.stringify({ core: { apiKey: "sk-project", defaultAgent: "codex" } })}\n`,
      { encoding: "utf8" }
    );

    const container = createCliContainer({
      fs,
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir, variables: { POE_API_KEY: "sk-env" } },
      logger: (message) => logs.push(message)
    });
    const program = createBaseProgram();
    registerUtilsCommand(program, container);
    const writeSpy = vi.spyOn(process.stdout, "write").mockReturnValue(true);

    await program.parseAsync(["node", "cli", "utils", "config", "show", "--json"]);

    const stdout = writeSpy.mock.calls.map(([chunk]) => String(chunk)).join("");
    writeSpy.mockRestore();
    const payload = JSON.parse(stdout) as {
      project: { document: { core: { apiKey: string; defaultAgent: string } } };
      resolved: Record<string, unknown>;
    };

    expect(payload.project.document.core.defaultAgent).toBe("codex");
    expect(payload.project.document.core.apiKey).toBe("<redacted>");
    expect(payload.resolved).toBeDefined();
    expect(stdout).not.toContain("sk-project");
    expect(stdout).not.toContain("sk-env");
  });

  it("redacts secret-bearing plugin headers when showing config", async () => {
    await fs.mkdir(`${cwd}/.poe-code`, { recursive: true });
    await fs.writeFile(
      projectConfigPath,
      `${JSON.stringify(
        {
          agent: {
            plugins: [
              {
                name: "openai-responses",
                options: {
                  defaultHeaders: {
                    Authorization: "Bearer sk-header-secret",
                    "proxy-authorization": "Basic proxy-secret",
                    "x-api-key": "sk-proxy-secret",
                    "x-auth-token": "token-secret",
                    "x-trace-id": "trace-123"
                  }
                }
              }
            ]
          }
        },
        null,
        2
      )}\n`,
      { encoding: "utf8" }
    );

    const container = createCliContainer({
      fs,
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir, variables: {} },
      logger: (message) => logs.push(message)
    });
    const program = createBaseProgram();
    registerUtilsCommand(program, container);
    const writeSpy = vi.spyOn(process.stdout, "write").mockReturnValue(true);

    // --json is the surface that prints whole documents, so redaction must hold there.
    await program.parseAsync(["node", "cli", "utils", "config", "show", "--json"]);
    const jsonOutput = writeSpy.mock.calls.map(([chunk]) => String(chunk)).join("");
    writeSpy.mockRestore();

    await program.parseAsync(["node", "cli", "utils", "config", "show"]);
    const humanOutput = stripVTControlCharacters(logs.join("\n"));

    expect(jsonOutput).toContain('"Authorization":"<redacted>"');
    expect(jsonOutput).toContain('"proxy-authorization":"<redacted>"');
    expect(jsonOutput).toContain('"x-api-key":"<redacted>"');
    expect(jsonOutput).toContain('"x-auth-token":"<redacted>"');
    expect(jsonOutput).toContain('"x-trace-id":"trace-123"');

    for (const output of [jsonOutput, humanOutput]) {
      expect(output).not.toContain("sk-header-secret");
      expect(output).not.toContain("proxy-secret");
      expect(output).not.toContain("sk-proxy-secret");
      expect(output).not.toContain("token-secret");
    }
  });

  it("shows empty sections when config files are missing", async () => {
    const container = createCliContainer({
      fs,
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir, variables: {} },
      logger: (message) => logs.push(message)
    });
    const program = createBaseProgram();
    registerUtilsCommand(program, container);

    await program.parseAsync(["node", "cli", "utils", "config", "show"]);

    const output = logs.join("\n");
    expect(output).toContain("Global config");
    expect(output).toContain("Project config");
    expect(output).toContain("Environment variable overrides");
    expect(output).toContain("Resolved (merged)");
    expect(output.match(/\(empty\)/g)?.length ?? 0).toBeGreaterThanOrEqual(4);
  });

  it("does not recover malformed config files while previewing config show", async () => {
    const malformedConfig = "not json\n";
    await fs.mkdir(`${cwd}/.poe-code`, { recursive: true });
    await fs.writeFile(projectConfigPath, malformedConfig, { encoding: "utf8" });

    const container = createCliContainer({
      fs,
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir, variables: {} },
      logger: (message) => logs.push(message)
    });
    const program = createBaseProgram();
    registerUtilsCommand(program, container);

    await expect(
      program.parseAsync(["node", "cli", "--dry-run", "utils", "config", "show"])
    ).rejects.toThrow();

    await expect(fs.readFile(projectConfigPath, "utf8")).resolves.toBe(malformedConfig);
    await expect(fs.readdir(`${cwd}/.poe-code`)).resolves.toEqual(["config.json"]);
  });

  it("creates an empty project config file", async () => {
    const container = createCliContainer({
      fs,
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir },
      logger: (message) => logs.push(message)
    });
    const program = createBaseProgram();
    registerUtilsCommand(program, container);

    await program.parseAsync(["node", "cli", "utils", "config", "init"]);

    await expect(fs.readFile(projectConfigPath, "utf8")).resolves.toBe("{}\n");
    expect(logs.some((message) => message.includes(`Created project config at ${projectConfigPath}`)))
      .toBe(true);
  });

  it("does nothing when project config already exists", async () => {
    await fs.mkdir(`${cwd}/.poe-code`, { recursive: true });
    await fs.writeFile(projectConfigPath, '{\n  "core": {\n    "apiKey": "sk-project"\n  }\n}\n', {
      encoding: "utf8"
    });

    const container = createCliContainer({
      fs,
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir },
      logger: (message) => logs.push(message)
    });
    const program = createBaseProgram();
    registerUtilsCommand(program, container);

    await program.parseAsync(["node", "cli", "utils", "config", "init"]);

    await expect(fs.readFile(projectConfigPath, "utf8")).resolves.toContain("sk-project");
    expect(logs.some((message) => message.includes(`Project config already exists at ${projectConfigPath}`)))
      .toBe(true);
  });

  it("does not write files in dry-run init mode", async () => {
    const container = createCliContainer({
      fs,
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir },
      logger: (message) => logs.push(message)
    });
    const program = createBaseProgram();
    registerUtilsCommand(program, container);

    await program.parseAsync(["node", "cli", "--dry-run", "utils", "config", "init"]);

    await expect(fs.stat(projectConfigPath)).rejects.toBeTruthy();
    expect(logs.some((message) => message.includes(`Dry run: would create project config at ${projectConfigPath}`)))
      .toBe(true);
  });

  it("opens the project config in the configured editor", async () => {
    const { execSync } = await import("node:child_process");
    await fs.mkdir(`${cwd}/.poe-code`, { recursive: true });
    await fs.writeFile(projectConfigPath, "{}\n", { encoding: "utf8" });

    const container = createCliContainer({
      fs,
      prompts: vi.fn().mockResolvedValue({}),
      env: {
        cwd,
        homeDir,
        variables: {
          EDITOR: "vim"
        }
      },
      logger: (message) => logs.push(message)
    });
    const program = createBaseProgram();
    registerUtilsCommand(program, container);

    await program.parseAsync(["node", "cli", "utils", "config", "edit"]);

    expect(execSync).toHaveBeenCalledWith(`vim ${projectConfigPath}`, {
      stdio: "inherit"
    });
    await expect(fs.readFile(projectConfigPath, "utf8")).resolves.toBe("{}\n");
  });

  it("opens the global config when --global is passed", async () => {
    const { execSync } = await import("node:child_process");
    const container = createCliContainer({
      fs,
      prompts: vi.fn().mockResolvedValue({}),
      env: {
        cwd,
        homeDir,
        variables: {
          VISUAL: "code -w"
        }
      },
      logger: (message) => logs.push(message)
    });
    const program = createBaseProgram();
    registerUtilsCommand(program, container);

    await program.parseAsync(["node", "cli", "utils", "config", "edit", "--global"]);

    expect(execSync).toHaveBeenCalledWith(`code -w ${globalConfigPath}`, {
      stdio: "inherit"
    });
    await expect(fs.readFile(globalConfigPath, "utf8")).resolves.toBe("{}\n");
  });

  it("fails when no editor is configured", async () => {
    const container = createCliContainer({
      fs,
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir, variables: {} },
      logger: (message) => logs.push(message)
    });
    const program = createBaseProgram();
    registerUtilsCommand(program, container);

    await expect(
      program.parseAsync(["node", "cli", "utils", "config", "edit"])
    ).rejects.toThrow("Set $EDITOR to use this command");
  });

  it("reports the missing editor as a user error rather than a system failure", async () => {
    const container = createCliContainer({
      fs,
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir, variables: {} },
      logger: (message) => logs.push(message)
    });
    const program = createBaseProgram();
    registerUtilsCommand(program, container);

    const error = await program.parseAsync(["node", "cli", "utils", "config", "edit"]).then(
      () => undefined,
      (thrown: unknown) => thrown
    );

    expect(error).toBeInstanceOf(ValidationError);
    expect((error as ValidationError).isUserError).toBe(true);
  });

  it("prints the project config path when a project config exists", async () => {
    await fs.mkdir(`${cwd}/.poe-code`, { recursive: true });
    await fs.writeFile(projectConfigPath, "{}\n", { encoding: "utf8" });

    const container = createCliContainer({
      fs,
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir },
      logger: (message) => logs.push(message)
    });
    const program = createBaseProgram();
    registerUtilsCommand(program, container);
    const writeSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    await program.parseAsync(["node", "cli", "utils", "config", "path"]);

    expect(writeSpy).toHaveBeenCalledWith(`${projectConfigPath}\n`);
    writeSpy.mockRestore();
  });

  it("falls back to the global config path when no project config exists", async () => {
    const container = createCliContainer({
      fs,
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir },
      logger: (message) => logs.push(message)
    });
    const program = createBaseProgram();
    registerUtilsCommand(program, container);
    const writeSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    await program.parseAsync(["node", "cli", "utils", "config", "path"]);

    expect(writeSpy).toHaveBeenCalledWith(`${globalConfigPath}\n`);
    writeSpy.mockRestore();
  });

  it("prints the global config path when --global is passed", async () => {
    await fs.mkdir(`${cwd}/.poe-code`, { recursive: true });
    await fs.writeFile(projectConfigPath, "{}\n", { encoding: "utf8" });

    const container = createCliContainer({
      fs,
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir },
      logger: (message) => logs.push(message)
    });
    const program = createBaseProgram();
    registerUtilsCommand(program, container);
    const writeSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    await program.parseAsync(["node", "cli", "utils", "config", "path", "--global"]);

    expect(writeSpy).toHaveBeenCalledWith(`${globalConfigPath}\n`);
    writeSpy.mockRestore();
  });

  it("prints the project config path when --project is passed and the file is missing", async () => {
    const container = createCliContainer({
      fs,
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir },
      logger: (message) => logs.push(message)
    });
    const program = createBaseProgram();
    registerUtilsCommand(program, container);
    const writeSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    await program.parseAsync(["node", "cli", "utils", "config", "path", "--project"]);

    expect(writeSpy).toHaveBeenCalledWith(`${projectConfigPath}\n`);
    writeSpy.mockRestore();
  });

  it("does not create a config file when printing the path", async () => {
    const container = createCliContainer({
      fs,
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir },
      logger: (message) => logs.push(message)
    });
    const program = createBaseProgram();
    registerUtilsCommand(program, container);
    const writeSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    await program.parseAsync(["node", "cli", "utils", "config", "path", "--project"]);

    await expect(fs.readdir(cwd)).resolves.toEqual([]);
    writeSpy.mockRestore();
  });

  it("rejects passing both --global and --project", async () => {
    const container = createCliContainer({
      fs,
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir },
      logger: (message) => logs.push(message)
    });
    const program = createBaseProgram();
    registerUtilsCommand(program, container);

    await expect(
      program.parseAsync(["node", "cli", "utils", "config", "path", "--global", "--project"])
    ).rejects.toThrow("Choose either --global or --project, not both.");
  });

});

// ---------------------------------------------------------------------------
// root-command.test.ts — root command
// ---------------------------------------------------------------------------

describe("root command", () => {
  function createMemFs(): FileSystem {
    const vol = new Volume();
    vol.mkdirSync("/home/test", { recursive: true });
    return createFsFromVolume(vol).promises as unknown as FileSystem;
  }

  function stripAnsi(str: string): string {
    let result = "";
    let index = 0;
    while (index < str.length) {
      const char = str[index];
      if (char === "\u001b" && str[index + 1] === "[") {
        index += 2;
        while (index < str.length && str[index] !== "m") {
          index += 1;
        }
        if (index < str.length) {
          index += 1;
        }
        continue;
      }
      result += char;
      index += 1;
    }
    return result;
  }

  async function renderHelp(argv: string[], binPath = "/usr/local/bin/poe-code"): Promise<string> {
    process.argv = ["node", binPath, ...argv];

    const fs = createMemFs();
    const prompts = vi.fn().mockResolvedValue({});

    const program = createProgram({
      fs,
      prompts,
      env: {
        cwd: "/repo",
        homeDir: "/home/test",
        variables: {}
      },
      logger: () => {}
    });

    const chunks: string[] = [];
    const stdoutSpy = vi
      .spyOn(process.stdout, "write")
      .mockImplementation(((chunk: unknown) => {
        chunks.push(String(chunk));
        return true;
      }) as unknown as typeof process.stdout.write);

    try {
      await program.parseAsync(["node", "cli", ...argv]);
    } catch (error) {
      if (!(error instanceof CommanderError) || error.code !== "commander.helpDisplayed") {
        stdoutSpy.mockRestore();
        throw error;
      }
    }

    stdoutSpy.mockRestore();
    return stripAnsi(chunks.join(""));
  }

  const originalArgv = [...process.argv];

  afterEach(() => {
    vi.restoreAllMocks();
    process.argv = [...originalArgv];
    runCliState.argvSnapshots = [];
    runCliState.optionsSnapshots = [];
  });

  it("shows help when invoked without arguments", async () => {
    const plainOutput = await renderHelp([]);
    expect(plainOutput).toContain("Poe - poe-code");
    expect(plainOutput).toContain("Configure coding agents to use the Poe API");
    expect(plainOutput).toContain("Usage:");
    expect(plainOutput).toContain("poe-code <command> [...args]");
    expect(plainOutput).toContain("<command>");
    expect(plainOutput).toContain("Commands:");
    expect(plainOutput).toContain("install, i");
    expect(plainOutput).toContain("configure, c");
    expect(plainOutput).toContain("unconfigure, uc");
    expect(plainOutput).toContain("spawn, s");
    expect(plainOutput).not.toContain("wrap, w");
    expect(plainOutput).not.toMatch(/\bwrap\b/);
    expect(plainOutput).toContain("models, m");
    expect(plainOutput).toContain("usage, u");
    expect(plainOutput).not.toContain("generate, g");
    expect(plainOutput).toContain("test");
    expect(plainOutput).toContain("Configure developer tooling for Poe API");
    expect(plainOutput).toContain("Install agent binary for a configured agent");
    expect(plainOutput).not.toContain("mcp configure");
    expect(plainOutput).not.toContain("mcp unconfigure");
    expect(plainOutput).toContain("experiment");
    expect(plainOutput).toContain("login");
    expect(plainOutput).toContain("config");
    expect(plainOutput).toContain("Authentication and account commands");
    expect(plainOutput).toContain("agent");
    expect(plainOutput).toContain("Run a one-shot Poe agent prompt");
    expect(plainOutput).toContain("pipeline");
    expect(plainOutput).toContain("plan");
    expect(plainOutput).not.toContain("plan markdown-read");
    expect(plainOutput).not.toContain("plan markdown-read-section");
    expect(plainOutput).not.toContain("plan markdown-reader-mcp");
    expect(plainOutput).toContain("ralph");
    expect(plainOutput).toContain("experiment");
    expect(plainOutput).toContain("github-workflows, gh");
    expect(plainOutput).toContain("GitHub workflow automations");
    expect(plainOutput).toContain("approvals");
    expect(plainOutput).toContain("Inspect and execute queued approvals");
    expect(plainOutput).not.toContain("auth api_key");
    expect(plainOutput).not.toContain("auth login");
    expect(plainOutput).not.toContain("auth logout");
    expect(plainOutput).not.toContain("research");
    expect(plainOutput).toContain("[agent]");
    expect(plainOutput).toContain("<agent>");
    expect(plainOutput).toContain("skill");
    expect(plainOutput).toContain("Skill directory commands");
    expect(plainOutput).not.toContain("poe-code configure claude-code");
    expect(plainOutput).not.toContain('poe-code spawn codex "Say hello"');
    expect(plainOutput).toContain("Run poe-code <command> --help for command options.");
    expect(plainOutput).toContain("Options:");
    expect(plainOutput).toContain("--dry-run");
    expect(plainOutput).not.toContain("[service]");
    expect(plainOutput).not.toContain("<service>");
    expect(plainOutput).not.toContain("unconfigure<agent>");
  });

  it("describes the root program with the same tagline the help body renders", async () => {
    const plainOutput = await renderHelp([]);
    const program = createProgram({
      fs: createMemFs(),
      prompts: vi.fn().mockResolvedValue({}),
      env: {
        cwd: "/repo",
        homeDir: "/home/test",
        variables: {}
      },
      logger: () => {}
    });

    expect(program.description()).toBe("Configure coding agents to use the Poe API.");
    expect(plainOutput).toContain(program.description());
  });

  it("names the required subcommand in parent command help usage", async () => {
    // Scoped to the usage line: a group requires a subcommand, so it says <command>
    // rather than commander's raw [command] placeholder or a bare [options].
    const usageLineOf = (help: string): string =>
      help.split("\n").find((line) => line.startsWith("Usage:")) ?? "";

    const usageHelp = await renderHelp(["usage", "--help"]);
    expect(usageLineOf(usageHelp)).toBe("Usage: poe-code usage <command>");

    const launchHelp = await renderHelp(["launch", "--help"]);
    expect(usageLineOf(launchHelp)).toBe("Usage: poe-code launch <command>");

    const utilsConfigHelp = await renderHelp(["utils", "config", "--help"]);
    expect(usageLineOf(utilsConfigHelp)).toBe("Usage: poe-code utils config <command>");

    // journal runs standalone on a doc, so it advertises its own argument, not a subcommand.
    const experimentJournalHelp = await renderHelp(["experiment", "journal", "--help"]);
    expect(usageLineOf(experimentJournalHelp)).toBe("Usage: poe-code experiment journal [doc]");
  });

  it("shows markdown reader subcommands in plan help", async () => {
    const planHelp = await renderHelp(["plan", "--help"]);

    expect(planHelp).toContain("markdown-read [options] <file>");
    expect(planHelp).toContain("markdown-read-section [options] <file> <section>");
    expect(planHelp).toContain("markdown-reader-mcp");
  });

  it("lists primary commands first and the rest under Advanced", async () => {
    const rootHelp = await renderHelp([]);

    for (const command of [
      "plan",
      "pipeline",
      "experiment",
      "harness",
      "ralph",
      "usage"
    ]) {
      expect(rootHelp.indexOf(command)).toBeGreaterThanOrEqual(0);
      expect(rootHelp.indexOf(command)).toBeLessThan(rootHelp.indexOf("Advanced:"));
    }

    for (const command of [
      "tasks",
      "skill",
      "eval",
      "maestro",
      "memory",
      "runtime",
      "worktree",
      "launch",
      "approvals",
      "github-workflows",
      "code-review",
      "superintendent",
      "provider",
      "utils"
    ]) {
      expect(rootHelp.indexOf("Advanced:")).toBeLessThan(rootHelp.indexOf(command));
    }

    for (const command of [
      "plan list",
      "plan markdown-read",
      "tasks import",
      "tasks set-state",
      "runtime jobs"
    ]) {
      expect(rootHelp).not.toContain(command);
    }
  });

  it("registers a --verbose flag", () => {
    const fs = createMemFs();
    const prompts = vi.fn().mockResolvedValue({});
    const program = createProgram({
      fs,
      prompts,
      env: {
        cwd: "/repo",
        homeDir: "/home/test"
      },
      logger: () => {}
    });

    const hasVerbose = program.options.some((option) => option.long === "--verbose");
    expect(hasVerbose).toBe(true);
  });

  it("does not register the legacy research command", () => {
    const fs = createMemFs();
    const prompts = vi.fn().mockResolvedValue({});
    const program = createProgram({
      fs,
      prompts,
      env: {
        cwd: "/repo",
        homeDir: "/home/test"
      },
      logger: () => {}
    });

    const command = program.commands.find((entry) => entry.name() === "research");
    expect(command).toBeUndefined();
  });

  it("registers the github-workflows command with the gh alias", () => {
    const fs = createMemFs();
    const prompts = vi.fn().mockResolvedValue({});
    const program = createProgram({
      fs,
      prompts,
      env: {
        cwd: "/repo",
        homeDir: "/home/test"
      },
      logger: () => {}
    });

    const command = program.commands.find((entry) => entry.name() === "github-workflows");
    expect(command).toBeDefined();
    expect(command?.aliases()).toContain("gh");
  });

  it("registers the approvals command", () => {
    const fs = createMemFs();
    const prompts = vi.fn().mockResolvedValue({});
    const program = createProgram({
      fs,
      prompts,
      env: {
        cwd: "/repo",
        homeDir: "/home/test"
      },
      logger: () => {}
    });

    const command = program.commands.find((entry) => entry.name() === "approvals");
    expect(command).toBeDefined();
  });

  it("registers eval authoring subcommands", () => {
    const fs = createMemFs();
    const prompts = vi.fn().mockResolvedValue({});
    const program = createProgram({
      fs,
      prompts,
      env: {
        cwd: "/repo",
        homeDir: "/home/test"
      },
      logger: () => {}
    });

    const command = program.commands.find((entry) => entry.name() === "eval");
    expect(command?.commands.map((entry) => entry.name())).toEqual([
      "run",
      "report",
      "init",
      "check",
      "lint"
    ]);
  });

  it("shows github-workflows help when invoked without an automation name", async () => {
    process.argv = ["node", "/usr/local/bin/poe-code", "github-workflows"];

    const fs = createMemFs();
    const prompts = vi.fn().mockResolvedValue({});
    const program = createProgram({
      fs,
      prompts,
      env: {
        cwd: "/repo",
        homeDir: "/home/test"
      },
      logger: () => {}
    });

    await program.parseAsync(["node", "cli", "github-workflows"]);

    expect(runCliState.argvSnapshots).toEqual([["node", "/usr/local/bin/poe-code", "github-workflows", "--help"]]);
    expect(process.argv).toEqual(["node", "/usr/local/bin/poe-code", "github-workflows"]);
  });

  it("preserves forwarded root flags when showing github-workflows help", async () => {
    process.argv = ["node", "/usr/local/bin/poe-code", "--yes", "github-workflows"];

    const fs = createMemFs();
    const prompts = vi.fn().mockResolvedValue({});
    const program = createProgram({
      fs,
      prompts,
      env: {
        cwd: "/repo",
        homeDir: "/home/test"
      },
      logger: () => {}
    });

    await program.parseAsync(["node", "cli", "--yes", "github-workflows"]);

    expect(runCliState.argvSnapshots).toEqual([["node", "/usr/local/bin/poe-code", "github-workflows", "--help", "--yes"]]);
    expect(process.argv).toEqual(["node", "/usr/local/bin/poe-code", "--yes", "github-workflows"]);
  });

  it("forwards dry-run into superintendent toolcraft commands", async () => {
    process.argv = ["node", "/usr/local/bin/poe-code", "--dry-run", "superintendent", "run", "plan.md"];

    const fs = createMemFs();
    const program = createProgram({
      fs,
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd: "/repo", homeDir: "/home/test" },
      logger: () => {}
    });

    await program.parseAsync(["node", "cli", "--dry-run", "superintendent", "run", "plan.md"]);

    expect(runCliState.argvSnapshots).toEqual([
      ["node", "/usr/local/bin/poe-code", "superintendent", "run", "plan.md", "--dry-run"]
    ]);
  });

  it("forwards output format values into eval toolcraft commands", async () => {
    process.argv = [
      "node",
      "/usr/local/bin/poe-code",
      "eval",
      "run",
      "--agent",
      "codex",
      "--model",
      "openai/gpt-5",
      "--dry-run",
      "--output",
      "json"
    ];

    const program = createProgram({
      fs: createMemFs(),
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd: "/repo", homeDir: "/home/test" },
      logger: () => {}
    });

    await program.parseAsync(process.argv);

    expect(runCliState.argvSnapshots).toEqual([
      [
        "node",
        "/usr/local/bin/poe-code",
        "eval",
        "run",
        "--agent",
        "codex",
        "--model",
        "openai/gpt-5",
        "--dry-run",
        "--output",
        "json"
      ]
    ]);
  });

  it("shows approvals help when invoked without a subcommand", async () => {
    process.argv = ["node", "/usr/local/bin/poe-code", "approvals"];

    const fs = createMemFs();
    const prompts = vi.fn().mockResolvedValue({});
    const program = createProgram({
      fs,
      prompts,
      env: {
        cwd: "/repo",
        homeDir: "/home/test"
      },
      logger: () => {}
    });

    await program.parseAsync(["node", "cli", "approvals"]);

    expect(runCliState.argvSnapshots).toEqual([["node", "/usr/local/bin/poe-code", "approvals", "--help"]]);
    expect(process.argv).toEqual(["node", "/usr/local/bin/poe-code", "approvals"]);
  });

  it("forwards approvals commands through toolcraft with the shared human-in-loop task list", async () => {
    process.argv = ["node", "/usr/local/bin/poe-code", "approvals", "list"];

    const fs = createMemFs();
    const prompts = vi.fn().mockResolvedValue({});
    const program = createProgram({
      fs,
      prompts,
      env: {
        cwd: "/repo",
        homeDir: "/home/test"
      },
      logger: () => {}
    });

    await program.parseAsync(["node", "cli", "approvals", "list"]);

    expect(runCliState.argvSnapshots).toEqual([["node", "/usr/local/bin/poe-code", "approvals", "list"]]);
    expect(runCliState.optionsSnapshots).toEqual([
      expect.objectContaining({
        humanInLoop: expect.objectContaining({
          invoke: expect.any(Function),
          mergeApprovalsGroup: expect.any(Function),
          runtimeOptions: expect.objectContaining({
            provider: expect.objectContaining({ requestApproval: expect.any(Function) }),
            taskList: {
              dir: "/repo/.poe-code/approvals.yaml",
              format: "yaml-file"
            }
          })
        })
      })
    ]);
    expect(process.argv).toEqual(["node", "/usr/local/bin/poe-code", "approvals", "list"]);
  });

  it("shows a short heading when invoked as poe", async () => {
    const plainOutput = await renderHelp([], "/usr/local/bin/poe");
    expect(plainOutput).toContain("Poe\n");
    expect(plainOutput).not.toContain("Poe - poe-code");
  });

  it("errors for unknown commands without printing help", async () => {
    process.argv = ["node", "/usr/local/bin/poe"];

    const fs = createMemFs();
    const prompts = vi.fn().mockResolvedValue({});

    let loggerOutput = "";
    let commanderOut = "";
    let commanderErr = "";

    const program = createProgram({
      fs,
      prompts,
      env: {
        cwd: "/repo",
        homeDir: "/home/test",
        variables: {}
      },
      logger: (message) => {
        loggerOutput += `${message}\n`;
      }
    });

    program.configureOutput({
      writeOut: (str) => {
        commanderOut += str;
      },
      writeErr: (str) => {
        commanderErr += str;
      }
    });

    await expect(program.parseAsync(["node", "cli", "nope"])).rejects.toBeInstanceOf(SilentError);

    const plainLogger = stripAnsi(loggerOutput);
    expect(plainLogger).toContain("Unknown command:");
    expect(plainLogger).toContain("nope");
    expect(plainLogger).toContain("poe --help");

    const plainCommander = stripAnsi(`${commanderOut}${commanderErr}`);
    expect(plainCommander).not.toContain("Usage:");
    expect(plainCommander).not.toContain("Commands:");
  });

  it.each([
    { args: ["nope", "--help"], help: "poe --help" },
    { args: ["skill", "nope", "--help"], help: "poe skill --help" }
  ])("errors for unknown help command paths: $args", async ({ args, help }) => {
    process.argv = ["node", "/usr/local/bin/poe"];
    let loggerOutput = "";
    const program = createProgram({
      fs: createMemFs(),
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd: "/repo", homeDir: "/home/test", variables: {} },
      logger: (message) => {
        loggerOutput += `${message}\n`;
      }
    });

    await expect(program.parseAsync(["node", "cli", ...args])).rejects.toBeInstanceOf(
      SilentError
    );

    const plainLogger = stripAnsi(loggerOutput);
    expect(plainLogger).toContain("Unknown command:");
    expect(plainLogger).toContain("nope");
    expect(plainLogger).toContain(help);
  });

  it.each([
    { args: ["confgure"], expected: "Did you mean: configure?" },
    { args: ["spwn"], expected: "Did you mean: spawn?" }
  ])("suggests registered root commands for typos: $args", async ({ args, expected }) => {
    process.argv = ["node", "/usr/local/bin/poe"];
    let loggerOutput = "";
    const program = createProgram({
      fs: createMemFs(),
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd: "/repo", homeDir: "/home/test", variables: {} },
      logger: (message) => {
        loggerOutput += `${message}\n`;
      }
    });

    await expect(program.parseAsync(["node", "cli", ...args])).rejects.toBeInstanceOf(SilentError);

    expect(stripAnsi(loggerOutput)).toContain(expected);
  });

  it("scopes suggestions to sibling subcommands of the group", async () => {
    process.argv = ["node", "/usr/local/bin/poe"];
    let loggerOutput = "";
    const program = createProgram({
      fs: createMemFs(),
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd: "/repo", homeDir: "/home/test", variables: {} },
      logger: (message) => {
        loggerOutput += `${message}\n`;
      }
    });

    await expect(
      program.parseAsync(["node", "cli", "skill", "instal", "--help"])
    ).rejects.toBeInstanceOf(SilentError);

    expect(stripAnsi(loggerOutput)).toContain("Did you mean: install?");
  });

  it("does not suggest unrelated root commands inside a group", async () => {
    process.argv = ["node", "/usr/local/bin/poe"];
    let loggerOutput = "";
    const program = createProgram({
      fs: createMemFs(),
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd: "/repo", homeDir: "/home/test", variables: {} },
      logger: (message) => {
        loggerOutput += `${message}\n`;
      }
    });

    await expect(
      program.parseAsync(["node", "cli", "skill", "spwn", "--help"])
    ).rejects.toBeInstanceOf(SilentError);

    expect(stripAnsi(loggerOutput)).not.toContain("Did you mean");
  });

  it("uses the development invocation in help hints when running via npm run dev", async () => {
    const previousLifecycleEvent = process.env.npm_lifecycle_event;
    process.env.npm_lifecycle_event = "dev";
    try {
      const fs = createMemFs();
      const prompts = vi.fn().mockResolvedValue({});

      let loggerOutput = "";
      const program = createProgram({
        fs,
        prompts,
        env: {
          cwd: "/repo",
          homeDir: "/home/test"
        },
        logger: (message) => {
          loggerOutput += `${message}\n`;
        }
      });

      await expect(program.parseAsync(["node", "cli", "nope"])).rejects.toBeInstanceOf(SilentError);

      const plainLogger = stripAnsi(loggerOutput);
      expect(plainLogger).toContain("Unknown command:");
      expect(plainLogger).toContain("npm run dev -- --help");
    } finally {
      if (previousLifecycleEvent === undefined) {
        delete process.env.npm_lifecycle_event;
      } else {
        process.env.npm_lifecycle_event = previousLifecycleEvent;
      }
    }
  });
});
