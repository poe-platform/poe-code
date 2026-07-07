import { beforeEach, describe, it, expect, vi, afterEach } from "vitest";
import { Volume, createFsFromVolume } from "memfs";
import { Command, CommanderError } from "commander";
import { createProgram } from "../program.js";
import { resolveConfigPath, resolveProjectConfigPath } from "@poe-code/poe-code-config";
import { createCliContainer } from "../container.js";
import { DEFAULT_FRONTIER_MODEL } from "../constants.js";
import { registerUtilsCommand } from "./utils.js";
import { SilentError } from "../errors.js";
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

  it("uses and advertises the default model when omitted", async () => {
    const program = createProgram({
      fs: createMemFs(),
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir },
      logger: () => {}
    });

    await program.parseAsync(["node", "cli", "agent", "Say hello"]);

    expect(createAgentSessionMock).toHaveBeenCalledWith({
      model: DEFAULT_FRONTIER_MODEL,
      apiKey: undefined,
      cwd
    });
    expect(program.commands.find((command) => command.name() === "agent")?.helpInformation()).toContain(
      `Model identifier (default: ${DEFAULT_FRONTIER_MODEL})`
    );
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

    const output = logs.join("\n");
    expect(output).toContain("Global config");
    expect(output).toContain("Project config");
    expect(output).toContain("Environment variable overrides");
    expect(output).toContain("Resolved (merged)");
    expect(output).toContain('"apiKey": "<redacted>"');
    expect(output).toContain('"defaultAgent": "claude"');
    expect(output).toContain('"defaultAgent": "codex:gpt-5.4"');
    expect(output).toContain("POE_API_KEY = <redacted>");
    expect(output).toContain("POE_DEFAULT_AGENT = opencode:o4-mini");
    expect(output).toContain('"defaultAgent": "opencode:o4-mini"');
    expect(output).toContain('"poeBaseUrl": "https://global.example.test"');
    expect(output).toContain('"default": "anthropic/claude-sonnet-4.5"');
    expect(output).not.toContain("sk-global");
    expect(output).not.toContain("sk-project");
    expect(output).not.toContain("sk-env");
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

    await program.parseAsync(["node", "cli", "utils", "config", "show"]);

    const output = logs.join("\n");
    expect(output).toContain('"Authorization": "<redacted>"');
    expect(output).toContain('"proxy-authorization": "<redacted>"');
    expect(output).toContain('"x-api-key": "<redacted>"');
    expect(output).toContain('"x-auth-token": "<redacted>"');
    expect(output).toContain('"x-trace-id": "trace-123"');
    expect(output).not.toContain("sk-header-secret");
    expect(output).not.toContain("proxy-secret");
    expect(output).not.toContain("sk-proxy-secret");
    expect(output).not.toContain("token-secret");
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
    expect(plainOutput).toContain("wrap, w");
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
    expect(plainOutput).not.toContain("github-workflows, gh");
    expect(plainOutput).not.toContain("GitHub workflow automations");
    expect(plainOutput).not.toContain("approvals");
    expect(plainOutput).not.toContain("Inspect and execute queued approvals");
    expect(plainOutput).not.toContain("auth api_key");
    expect(plainOutput).not.toContain("auth login");
    expect(plainOutput).not.toContain("auth logout");
    expect(plainOutput).not.toContain("research");
    expect(plainOutput).toContain("[agent]");
    expect(plainOutput).toContain("<agent>");
    expect(plainOutput).not.toContain("skill");
    expect(plainOutput).not.toContain("Skill directory commands");
    expect(plainOutput).not.toContain("poe-code configure claude-code");
    expect(plainOutput).not.toContain('poe-code spawn codex "Say hello"');
    expect(plainOutput).toContain("Run poe-code <command> --help for command options.");
    expect(plainOutput).toContain("Options:");
    expect(plainOutput).toContain("--dry-run");
    expect(plainOutput).not.toContain("[service]");
    expect(plainOutput).not.toContain("<service>");
    expect(plainOutput).not.toContain("unconfigure<agent>");
  });

  it("omits the raw [command] placeholder from parent command help usage", async () => {
    const usageHelp = await renderHelp(["usage", "--help"]);
    expect(usageHelp).toContain("Usage: poe-code usage [options]");
    expect(usageHelp).not.toContain("[command]");

    const launchHelp = await renderHelp(["launch", "--help"]);
    expect(launchHelp).toContain("Usage: poe-code launch [options]");
    expect(launchHelp).not.toContain("[command]");

    const utilsConfigHelp = await renderHelp(["utils", "config", "--help"]);
    expect(utilsConfigHelp).toContain("Usage: poe-code utils config [options]");
    expect(utilsConfigHelp).not.toContain("[command]");

    const experimentJournalHelp = await renderHelp(["experiment", "journal", "--help"]);
    expect(experimentJournalHelp).toContain("Usage: poe-code experiment journal [options] [doc]");
    expect(experimentJournalHelp).not.toContain("[command]");
  });

  it("shows markdown reader subcommands in plan help", async () => {
    const planHelp = await renderHelp(["plan", "--help"]);

    expect(planHelp).toContain("markdown-read [options] <file>");
    expect(planHelp).toContain("markdown-read-section [options] <file> <section>");
    expect(planHelp).toContain("markdown-reader-mcp");
  });

  it("keeps root help focused on primary command groups", async () => {
    const rootHelp = await renderHelp([]);

    for (const command of [
      "plan",
      "pipeline",
      "experiment",
      "harness",
      "ralph",
      "usage"
    ]) {
      expect(rootHelp).toContain(command);
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
