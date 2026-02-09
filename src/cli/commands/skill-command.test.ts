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
      env: { cwd: "/repo", homeDir: "/home/test" },
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
      await program.parseAsync(["node", "cli", "skill"]);
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
});
