import { describe, it, expect, vi, afterEach } from "vitest";
import { Volume, createFsFromVolume } from "memfs";
import { createProgram } from "../program.js";
import type { FileSystem } from "../utils/file-system.js";

function createMemFs(): FileSystem {
  const vol = new Volume();
  vol.mkdirSync("/home/test", { recursive: true });
  return createFsFromVolume(vol).promises as unknown as FileSystem;
}

function stripAnsi(str: string): string {
  return str.replace(/\x1B\[[0-9;]*m/g, "");
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
    expect(plainOutput).toContain("Configure coding agents to use the Poe API");
    expect(plainOutput).toContain("Usage: poe-code");
    expect(plainOutput).toContain("Commands:");
    expect(plainOutput).toContain("[agent]");
    expect(plainOutput).toContain("<agent>");
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
});
