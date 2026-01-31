import { describe, it, expect, vi, beforeEach } from "vitest";
import { Volume, createFsFromVolume } from "memfs";
import path from "node:path";
import { Readable } from "node:stream";
import { Command } from "commander";
import { createProgram } from "../program.js";
import { registerSpawnCommand } from "./spawn.js";
import { createCliContainer, type CliDependencies } from "../container.js";
import type { FileSystem } from "../utils/file-system.js";
import type {
  CommandRunner,
  CommandRunnerOptions,
  CommandRunnerResult
} from "../../utils/command-checks.js";
import {
  DEFAULT_FRONTIER_MODEL,
  FRONTIER_MODELS,
  PROVIDER_NAME
} from "../constants.js";

const cwd = "/repo";
const homeDir = "/home/test";

function createMemFs(): FileSystem {
  const vol = new Volume();
  // Pre-create common directories to avoid slow recursive mkdir
  vol.mkdirSync(`${homeDir}/.poe-code/codex`, { recursive: true });
  vol.mkdirSync(`${homeDir}/.poe-code/opencode/.config/opencode`, { recursive: true });
  return createFsFromVolume(vol).promises as unknown as FileSystem;
}

interface CommandCall {
  command: string;
  args: string[];
  options?: CommandRunnerOptions;
}

function createCommandRunnerStub(
  result: CommandRunnerResult = { stdout: "", stderr: "", exitCode: 0 }
): { runner: CommandRunner; calls: CommandCall[] } {
  const calls: CommandCall[] = [];
  const runner: CommandRunner = async (command, args, options) => {
    const call: CommandCall = { command, args };
    if (options) {
      call.options = options;
    }
    calls.push(call);
    return { ...result };
  };
  return { runner, calls };
}

function createContainerWithDependencies(
  overrides: Partial<CliDependencies> = {}
): {
  container: ReturnType<typeof createCliContainer>;
  logs: string[];
  commandCalls: CommandCall[];
} {
  const logs: string[] = [];
  const { runner, calls } = createCommandRunnerStub();
  const container = createCliContainer({
    fs: overrides.fs ?? createMemFs(),
    prompts: overrides.prompts ?? vi.fn().mockResolvedValue({}),
    env: overrides.env ?? { cwd, homeDir },
    commandRunner: overrides.commandRunner ?? runner,
    logger: overrides.logger ?? ((message) => {
      logs.push(message);
    })
  });
  return { container, logs, commandCalls: calls };
}

describe("spawn command", () => {
  let fs: FileSystem;

  beforeEach(() => {
    fs = createMemFs();
    vi.clearAllMocks();
  });

  async function ensureIsolatedConfig(service: string): Promise<void> {
    if (service === "codex") {
      await fs.writeFile(
        `${homeDir}/.poe-code/codex/config.toml`,
        "",
        { encoding: "utf8" }
      );
      return;
    }
    if (service === "opencode") {
      await fs.writeFile(
        `${homeDir}/.poe-code/opencode/.config/opencode/config.json`,
        "{}",
        { encoding: "utf8" }
      );
    }
  }

  it("spawns a claude-code agent", async () => {
    const logs: string[] = [];
    const { runner, calls } = createCommandRunnerStub({
      stdout: "Agent output\n",
      stderr: "",
      exitCode: 0
    });
    await fs.writeFile(
      `${homeDir}/.poe-code/credentials.json`,
      JSON.stringify({ apiKey: "sk-test" }),
      { encoding: "utf8" }
    );
    const program = createProgram({
      fs,
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir, variables: {} },
      commandRunner: runner,
      logger: (message) => {
        logs.push(message);
      }
    });

    await program.parseAsync([
      "node",
      "cli",
      "spawn",
      "claude-code",
      "Explain the change"
    ]);

    expect(calls).toEqual([
      {
        command: "claude",
        args: [
          "-p",
          "Explain the change",
          "--allowedTools",
          "Bash,Read",
          "--permission-mode",
          "acceptEdits",
          "--output-format",
          "text"
        ],
        options: {
          env: {
            ANTHROPIC_API_KEY: "sk-test",
            ANTHROPIC_BASE_URL: "https://api.poe.com"
          }
        }
      }
    ]);
    expect(logs.some((message) => message.includes("Agent output"))).toBe(true);
  });

  it("spawns a codex agent", async () => {
    await ensureIsolatedConfig("codex");
    const logs: string[] = [];
    const { runner, calls } = createCommandRunnerStub({
      stdout: "Codex output\n",
      stderr: "",
      exitCode: 0
    });
    const program = createProgram({
      fs,
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir },
      commandRunner: runner,
      logger: (message) => {
        logs.push(message);
      }
    });

    await program.parseAsync([
      "node",
      "cli",
      "spawn",
      "codex",
      "Summarize the diff"
    ]);

    expect(calls).toEqual([
      {
        command: "codex",
        args: ["exec", "Summarize the diff", "--full-auto", "--skip-git-repo-check"],
        options: {
          env: {
            CODEX_HOME: `${homeDir}/.poe-code/codex`,
            XDG_CONFIG_HOME: `${homeDir}/.poe-code/codex`
          }
        }
      }
    ]);
    expect(logs.some((message) => message.includes("Codex output"))).toBe(true);
  });

  it("spawns an opencode agent", async () => {
    await ensureIsolatedConfig("opencode");
    const logs: string[] = [];
    const { runner, calls } = createCommandRunnerStub({
      stdout: "OpenCode output\n",
      stderr: "",
      exitCode: 0
    });
    const program = createProgram({
      fs,
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir },
      commandRunner: runner,
      logger: (message) => {
        logs.push(message);
      }
    });

    await program.parseAsync([
      "node",
      "cli",
      "spawn",
      "opencode",
      "List files"
    ]);

    expect(calls).toEqual([
      {
        command: "opencode",
        args: [
          "--model",
          `poe/${DEFAULT_FRONTIER_MODEL}`,
          "run",
          "List files"
        ],
        options: {
          env: {
            XDG_CONFIG_HOME: `${homeDir}/.poe-code/opencode/.config`,
            XDG_DATA_HOME: `${homeDir}/.poe-code/opencode/.local/share`
          }
        }
      }
    ]);
    expect(logs.some((message) => message.includes("OpenCode output"))).toBe(
      true
    );
  });

  it("fails when spawn command exits with error", async () => {
    const { runner } = createCommandRunnerStub({
      stdout: "",
      stderr: "spawn failed",
      exitCode: 1
    });
    await fs.writeFile(
      `${homeDir}/.poe-code/credentials.json`,
      JSON.stringify({ apiKey: "sk-test" }),
      { encoding: "utf8" }
    );
    const program = createProgram({
      fs,
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir, variables: {} },
      commandRunner: runner,
      logger: () => {}
    });

    await expect(
      program.parseAsync([
        "node",
        "cli",
        "spawn",
        "claude-code",
        "Explain the change"
      ])
    ).rejects.toThrow(/spawn failed/i);
  });

  it("skips execution during dry run spawn", async () => {
    const logs: string[] = [];
    const { runner, calls } = createCommandRunnerStub({
      stdout: "Agent output\n",
      stderr: "",
      exitCode: 0
    });
    const program = createProgram({
      fs,
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir },
      commandRunner: runner,
      logger: (message) => {
        logs.push(message);
      }
    });

    await program.parseAsync([
      "node",
      "cli",
      "--dry-run",
      "spawn",
      "claude-code",
      "Dry run prompt"
    ]);

    expect(calls).toHaveLength(0);
    const dryRunLog = logs.find((line) =>
      line.includes("Dry run: would spawn Claude Code.")
    );
    expect(dryRunLog).toBeTruthy();
    expect(dryRunLog).toContain("Prompt:");
  });

  it("invokes custom spawn handlers when provided", async () => {
    const { container, logs, commandCalls } = createContainerWithDependencies();
    const program = new Command();
    program.exitOverride();
    registerSpawnCommand(program, container, {
      handlers: {
        "poe-code": async (ctx) => {
          logs.push(`custom:${ctx.options.prompt}`);
          expect(ctx.service).toBe("poe-code");
          expect(ctx.options.args).toEqual(["--model", "beta"]);
        }
      }
    });

    await program.parseAsync([
      "node",
      "cli",
      "spawn",
      "poe-code",
      "Explain the change",
      "--",
      "--model",
      "beta"
    ]);

    expect(logs).toContain("custom:Explain the change");
    expect(commandCalls).toHaveLength(0);
  });

  it("includes extra services in spawn help output", () => {
    const { container } = createContainerWithDependencies();
    const program = new Command();
    registerSpawnCommand(program, container, {
      extraServices: ["poe-code", "beta-agent"]
    });

    const spawnCommand = program.commands.find((cmd) => cmd.name() === "spawn");
    expect(spawnCommand).toBeDefined();
    const help = spawnCommand?.helpInformation() ?? "";
    expect(help).toContain("poe-code");
    expect(help).toContain("beta-agent");
  });

  it("passes through model override via CLI flag", async () => {
    await ensureIsolatedConfig("opencode");
    const logs: string[] = [];
    const { runner, calls } = createCommandRunnerStub({
      stdout: "OpenCode output\n",
      stderr: "",
      exitCode: 0
    });
    const program = createProgram({
      fs,
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir },
      commandRunner: runner,
      logger: (message) => {
        logs.push(message);
      }
    });

    const override = FRONTIER_MODELS[FRONTIER_MODELS.length - 1]!;

    await program.parseAsync([
      "node",
      "cli",
      "spawn",
      "--model",
      override,
      "opencode",
      "List files"
    ]);

    expect(calls).toEqual([
      {
        command: "opencode",
        args: [
          "--model",
          `poe/${override}`,
          "run",
          "List files"
        ],
        options: {
          env: {
            XDG_CONFIG_HOME: `${homeDir}/.poe-code/opencode/.config`,
            XDG_DATA_HOME: `${homeDir}/.poe-code/opencode/.local/share`
          }
        }
      }
    ]);
    expect(logs.some((message) => message.includes("OpenCode output"))).toBe(true);
  });

  it("avoids duplicating provider prefixes for CLI model overrides", async () => {
    await ensureIsolatedConfig("opencode");
    const logs: string[] = [];
    const { runner, calls } = createCommandRunnerStub({
      stdout: "OpenCode output\n",
      stderr: "",
      exitCode: 0
    });
    const program = createProgram({
      fs,
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir },
      commandRunner: runner,
      logger: (message) => {
        logs.push(message);
      }
    });

    const prefixed = `${PROVIDER_NAME}/${FRONTIER_MODELS[0]!}`;

    await program.parseAsync([
      "node",
      "cli",
      "spawn",
      "--model",
      prefixed,
      "opencode",
      "List files"
    ]);

    expect(calls).toEqual([
      {
        command: "opencode",
        args: ["--model", prefixed, "run", "List files"],
        options: {
          env: {
            XDG_CONFIG_HOME: `${homeDir}/.poe-code/opencode/.config`,
            XDG_DATA_HOME: `${homeDir}/.poe-code/opencode/.local/share`
          }
        }
      }
    ]);
    expect(logs.some((message) => message.includes("OpenCode output"))).toBe(true);
  });

  it("runs spawn commands from a custom cwd via -C flag", async () => {
    const customCwd = "/projects/demo";
    const { runner, calls } = createCommandRunnerStub({
      stdout: "Agent output\n",
      stderr: "",
      exitCode: 0
    });
    await fs.writeFile(
      `${homeDir}/.poe-code/credentials.json`,
      JSON.stringify({ apiKey: "sk-test" }),
      { encoding: "utf8" }
    );
    const program = createProgram({
      fs,
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir, variables: {} },
      commandRunner: runner,
      logger: () => {}
    });

    await program.parseAsync([
      "node",
      "cli",
      "spawn",
      "-C",
      customCwd,
      "claude-code",
      "Explain the change"
    ]);

    expect(calls).toEqual([
      {
        command: "claude",
        args: [
          "-p",
          "Explain the change",
          "--allowedTools",
          "Bash,Read",
          "--permission-mode",
          "acceptEdits",
          "--output-format",
          "text"
        ],
        options: {
          cwd: customCwd,
          env: {
            ANTHROPIC_API_KEY: "sk-test",
            ANTHROPIC_BASE_URL: "https://api.poe.com"
          }
        }
      }
    ]);
  });

  it("resolves relative cwd paths against the CLI environment", async () => {
    await ensureIsolatedConfig("codex");
    const relative = "feature";
    const resolved = path.join(cwd, relative);
    const { runner, calls } = createCommandRunnerStub({
      stdout: "Agent output\n",
      stderr: "",
      exitCode: 0
    });
    const program = createProgram({
      fs,
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir },
      commandRunner: runner,
      logger: () => {}
    });

    await program.parseAsync([
      "node",
      "cli",
      "spawn",
      "--cwd",
      relative,
      "codex",
      "Summarize the diff"
    ]);

    expect(calls).toEqual([
      {
        command: "codex",
        args: [
          "exec",
          "Summarize the diff",
          "--full-auto",
          "--skip-git-repo-check"
        ],
        options: {
          cwd: resolved,
          env: {
            CODEX_HOME: `${homeDir}/.poe-code/codex`,
            XDG_CONFIG_HOME: `${homeDir}/.poe-code/codex`
          }
        }
      }
    ]);
  });

  it("creates isolated config when missing", async () => {
    const { runner, calls } = createCommandRunnerStub({
      stdout: "Agent output\n",
      stderr: "",
      exitCode: 0
    });
    const program = createProgram({
      fs,
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir },
      commandRunner: runner,
      logger: () => {}
    });

    await fs.writeFile(
      `${homeDir}/.poe-code/credentials.json`,
      JSON.stringify({ apiKey: "sk-test" }),
      { encoding: "utf8" }
    );

    await program.parseAsync(["node", "cli", "spawn", "codex", "Summarize the diff"]);

    expect(calls).toEqual([
      {
        command: "codex",
        args: ["exec", "Summarize the diff", "--full-auto", "--skip-git-repo-check"],
        options: {
          env: {
            CODEX_HOME: `${homeDir}/.poe-code/codex`,
            XDG_CONFIG_HOME: `${homeDir}/.poe-code/codex`
          }
        }
      }
    ]);

    await expect(fs.stat(`${homeDir}/.poe-code/codex/config.toml`)).resolves.toBeDefined();
  });

  it("consumes prompt text from stdin when no prompt argument is provided", async () => {
    await ensureIsolatedConfig("codex");
    const { runner, calls } = createCommandRunnerStub({
      stdout: "Codex output\n",
      stderr: "",
      exitCode: 0
    });
    const program = createProgram({
      fs,
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir },
      commandRunner: runner,
      logger: () => {}
    });

    const stdinStream = Readable.from([Buffer.from("Prompt via stdin")]);
    Object.defineProperty(stdinStream, "isTTY", { value: false });
    const stdinSpy = vi
      .spyOn(process, "stdin", "get")
      .mockReturnValue(stdinStream as NodeJS.ReadStream);

    await program.parseAsync(["node", "cli", "spawn", "codex"]);

    expect(calls).toEqual([
      {
        command: "codex",
        args: ["exec", "-", "--full-auto", "--skip-git-repo-check"],
        options: {
          env: {
            CODEX_HOME: `${homeDir}/.poe-code/codex`,
            XDG_CONFIG_HOME: `${homeDir}/.poe-code/codex`
          },
          stdin: "Prompt via stdin"
        }
      }
    ]);

    stdinSpy.mockRestore();
  });

  it("treats the next argument as agent args when --stdin is set", async () => {
    await ensureIsolatedConfig("codex");
    const { runner, calls } = createCommandRunnerStub({
      stdout: "Codex output\n",
      stderr: "",
      exitCode: 0
    });
    const program = createProgram({
      fs,
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir },
      commandRunner: runner,
      logger: () => {}
    });

    const stdinStream = Readable.from([Buffer.from("Prompt via stdin")]);
    Object.defineProperty(stdinStream, "isTTY", { value: false });
    const stdinSpy = vi
      .spyOn(process, "stdin", "get")
      .mockReturnValue(stdinStream as NodeJS.ReadStream);

    await program.parseAsync([
      "node",
      "cli",
      "spawn",
      "--stdin",
      "codex",
      "--",
      "--foo",
      "bar"
    ]);

    expect(calls).toEqual([
      {
        command: "codex",
        args: ["exec", "-", "--full-auto", "--skip-git-repo-check", "--foo", "bar"],
        options: {
          env: {
            CODEX_HOME: `${homeDir}/.poe-code/codex`,
            XDG_CONFIG_HOME: `${homeDir}/.poe-code/codex`
          },
          stdin: "Prompt via stdin"
        }
      }
    ]);

    stdinSpy.mockRestore();
  });

  it("fails with a meaningful error when stdin prompts are not supported", async () => {
    const { runner } = createCommandRunnerStub({
      stdout: "",
      stderr: "",
      exitCode: 0
    });
    const program = createProgram({
      fs,
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir },
      commandRunner: runner,
      logger: () => {}
    });

    const stdinStream = Readable.from([Buffer.from("Prompt via stdin")]);
    Object.defineProperty(stdinStream, "isTTY", { value: false });
    const stdinSpy = vi
      .spyOn(process, "stdin", "get")
      .mockReturnValue(stdinStream as NodeJS.ReadStream);

    await expect(
      program.parseAsync(["node", "cli", "spawn", "opencode"])
    ).rejects.toThrow(/stdin prompts/i);

    stdinSpy.mockRestore();
  });
});
