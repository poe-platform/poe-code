import { describe, it, expect, vi, afterEach } from "vitest";
import { Volume, createFsFromVolume } from "memfs";
import { createProgram } from "../program.js";
import type { FileSystem } from "../utils/file-system.js";
import { SilentError } from "../errors.js";

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

describe("root command", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("shows help when invoked without arguments", async () => {
    const fs = createMemFs();
    const prompts = vi.fn().mockResolvedValue({});

    let helpOutput = "";
    const program = createProgram({
      fs,
      prompts,
      env: {
        cwd: "/repo",
        homeDir: "/home/test"
      },
      logger: () => {}
    });

    program.configureOutput({
      writeOut: (str) => {
        helpOutput += str;
      }
    });

    await program.parseAsync(["node", "cli"]);

    const plainOutput = stripAnsi(helpOutput);
    expect(plainOutput).toContain("Poe - poe-code");
    expect(plainOutput).toContain("Configure coding agents to use the Poe API");
    expect(plainOutput).toContain("Usage:");
    expect(plainOutput).toContain("<command>");
    expect(plainOutput).toContain("Commands:");
    expect(plainOutput).toContain("configure");
    expect(plainOutput).toContain("Configure a coding agent");
    expect(plainOutput).toContain("mcp configure");
    expect(plainOutput).toContain("mcp unconfigure");
    expect(plainOutput).toContain("mcp serve");
    expect(plainOutput).toContain("login");
    expect(plainOutput).toContain("auth status");
    expect(plainOutput).toContain("agent");
    expect(plainOutput).toContain("Run a one-shot Poe agent prompt");
    expect(plainOutput).toContain("pipeline");
    expect(plainOutput).not.toContain("auth api_key");
    expect(plainOutput).not.toContain("auth login");
    expect(plainOutput).not.toContain("auth logout");
    expect(plainOutput).not.toContain("research");
    expect(plainOutput).toContain("[agent]");
    expect(plainOutput).toContain("<agent>");
    expect(plainOutput).toContain("skill configure");
    expect(plainOutput).toContain("skill unconfigure");
    expect(plainOutput).toContain("Configure agent skills");
    expect(plainOutput).not.toContain("poe-code configure claude-code");
    expect(plainOutput).not.toContain('poe-code spawn codex "Say hello"');
    expect(plainOutput).not.toContain("wrap");
    expect(plainOutput).not.toContain("test");
    expect(plainOutput).not.toContain("Options:");
    expect(plainOutput).not.toContain("[service]");
    expect(plainOutput).not.toContain("<service>");
    expect(plainOutput).not.toContain("unconfigure<agent>");
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

    const hasVerbose = program.options.some(
      (option) => option.long === "--verbose"
    );
    expect(hasVerbose).toBe(true);
  });

  it("errors for unknown commands without printing help", async () => {
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
        homeDir: "/home/test"
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

    await expect(program.parseAsync(["node", "cli", "nope"])).rejects.toBeInstanceOf(
      SilentError
    );

    const plainLogger = stripAnsi(loggerOutput);
    expect(plainLogger).toContain("Unknown command:");
    expect(plainLogger).toContain("nope");
    expect(plainLogger).toContain("poe-code --help");

    const plainCommander = stripAnsi(`${commanderOut}${commanderErr}`);
    expect(plainCommander).not.toContain("Usage:");
    expect(plainCommander).not.toContain("Commands:");
  });

  it("suggests the correct help scope for unknown subcommands", async () => {
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

    await expect(
      program.parseAsync(["node", "cli", "mcp", "nope"])
    ).rejects.toBeInstanceOf(SilentError);

    const plainLogger = stripAnsi(loggerOutput);
    expect(plainLogger).toContain("Unknown command:");
    expect(plainLogger).toContain("nope");
    expect(plainLogger).toContain("poe-code mcp --help");
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

      await expect(
        program.parseAsync(["node", "cli", "nope"])
      ).rejects.toBeInstanceOf(SilentError);

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
