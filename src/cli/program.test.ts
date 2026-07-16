import { afterEach, describe, it, expect, vi } from "vitest";
import { CommanderError } from "commander";
import { Volume, createFsFromVolume } from "memfs";
import type { FileSystem } from "../utils/file-system.js";
import { createProgram } from "./program.js";

function createMemFs(homeDir: string): FileSystem {
  const vol = new Volume();
  vol.mkdirSync(homeDir, { recursive: true });
  return createFsFromVolume(vol).promises as unknown as FileSystem;
}

describe("createProgram", () => {
  const homeDir = "/home/test";
  const originalArgv = [...process.argv];

  afterEach(() => {
    process.argv = [...originalArgv];
    vi.restoreAllMocks();
  });

  it("registers the provider command group", () => {
    const fs = createMemFs(homeDir);
    const program = createProgram({
      fs,
      prompts: async () => ({}),
      env: { cwd: "/repo", homeDir },
      logger: () => {},
      exitOverride: true,
      suppressCommanderOutput: true
    });

    const providerCommand = program.commands.find((c) => c.name() === "provider");
    expect(providerCommand).toBeDefined();
  });

  it("registers login command", () => {
    const fs = createMemFs(homeDir);
    const program = createProgram({
      fs,
      prompts: async () => ({}),
      env: { cwd: "/repo", homeDir },
      logger: () => {},
      exitOverride: true,
      suppressCommanderOutput: true
    });

    const loginCommand = program.commands.find((c) => c.name() === "login");
    expect(loginCommand).toBeDefined();
  });

  it("registers configure command", () => {
    const fs = createMemFs(homeDir);
    const program = createProgram({
      fs,
      prompts: async () => ({}),
      env: { cwd: "/repo", homeDir },
      logger: () => {},
      exitOverride: true,
      suppressCommanderOutput: true
    });

    const configureCommand = program.commands.find((c) => c.name() === "configure");
    expect(configureCommand).toBeDefined();
  });

  it("renders maestro help and exits 0", async () => {
    const fs = createMemFs(homeDir);
    const chunks: string[] = [];
    const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(((chunk: unknown) => {
      chunks.push(String(chunk));
      return true;
    }) as typeof process.stdout.write);
    const originalExitCode = process.exitCode;
    process.exitCode = undefined;
    process.argv = ["node", "/usr/local/bin/poe-code", "maestro", "--help"];
    const program = createProgram({
      fs,
      prompts: async () => ({}),
      env: { cwd: "/repo", homeDir },
      logger: () => {},
      exitOverride: true
    });

    try {
      await program.parseAsync(["node", "cli", "maestro", "--help"]);
    } catch (error) {
      expect(error).toBeInstanceOf(CommanderError);
      expect((error as CommanderError).exitCode).toBe(0);
    }

    const output = chunks.join("");
    expect(output).toContain("maestro");
    expect(output).toContain("WORKFLOW.md");
    expect(output).toContain("--max-concurrent");
    expect(output).toContain("--poll-interval-ms");
    expect(process.exitCode).toBeUndefined();
    process.exitCode = originalExitCode;
    stdoutSpy.mockRestore();
  });

  it("lists every registered command in root help", () => {
    const fs = createMemFs(homeDir);
    const program = createProgram({
      fs,
      prompts: async () => ({}),
      env: { cwd: "/repo", homeDir },
      logger: () => {},
      exitOverride: true,
      suppressCommanderOutput: true
    });

    const help = program.helpInformation();
    const visibleNames = program.commands
      .filter((command) => Reflect.get(command, "_hidden") !== true)
      .map((command) => command.name());

    expect(visibleNames.length).toBeGreaterThan(19);
    const missing = visibleNames.filter((name) => !help.includes(name));
    expect(missing).toEqual([]);
  });

  it("groups less-common commands under an Advanced heading in root help", () => {
    const fs = createMemFs(homeDir);
    const program = createProgram({
      fs,
      prompts: async () => ({}),
      env: { cwd: "/repo", homeDir },
      logger: () => {},
      exitOverride: true,
      suppressCommanderOutput: true
    });

    const help = program.helpInformation();

    expect(help).toContain("Advanced:");
    expect(help.indexOf("install")).toBeLessThan(help.indexOf("Advanced:"));
    for (const name of ["skill", "memory", "runtime", "eval", "provider", "tasks", "launch"]) {
      expect(help.indexOf("Advanced:")).toBeLessThan(help.indexOf(name));
    }
  });

  it("registers the code-review command group", () => {
    const fs = createMemFs(homeDir);
    const program = createProgram({
      fs,
      prompts: async () => ({}),
      env: { cwd: "/repo", homeDir },
      logger: () => {},
      exitOverride: true,
      suppressCommanderOutput: true
    });

    expect(program.commands.find((command) => command.name() === "code-review")).toBeDefined();
  });

  it("forwards code-review help through the root command", async () => {
    const fs = createMemFs(homeDir);
    const writes: string[] = [];
    vi.spyOn(process.stdout, "write").mockImplementation(((chunk: unknown) => {
      writes.push(String(chunk));
      return true;
    }) as typeof process.stdout.write);
    process.argv = ["node", "poe-code", "code-review", "--help"];
    const program = createProgram({
      fs,
      prompts: async () => ({}),
      env: { cwd: "/repo", homeDir },
      logger: () => {},
      exitOverride: true,
      suppressCommanderOutput: true
    });

    await program.parseAsync(process.argv);

    const output = writes.join("");
    expect(output).toContain("code-review");
    for (const command of ["install", "profiles", "ingest", "run", "drafts", "commit", "agent-mcp"]) {
      expect(output).toContain(command);
    }
  });

  it.each(["install", "profiles", "ingest", "run", "drafts", "commit", "agent-mcp"])(
    "forwards code-review %s help through the root command",
    async (command) => {
      const fs = createMemFs(homeDir);
      const writes: string[] = [];
      vi.spyOn(process.stdout, "write").mockImplementation(((chunk: unknown) => {
        writes.push(String(chunk));
        return true;
      }) as typeof process.stdout.write);
      process.argv = ["node", "poe-code", "code-review", command, "--help"];
      const program = createProgram({
        fs,
        prompts: async () => ({}),
        env: { cwd: "/repo", homeDir },
        logger: () => {},
        exitOverride: true,
        suppressCommanderOutput: true
      });

      await program.parseAsync(process.argv);

      expect(writes.join("")).toContain(command);
    }
  );
});
