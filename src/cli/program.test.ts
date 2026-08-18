import { afterEach, describe, it, expect, vi } from "vitest";
import { stripVTControlCharacters } from "node:util";
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

  it("prints root help for the `help` command", async () => {
    const writes: string[] = [];
    vi.spyOn(process.stdout, "write").mockImplementation(((chunk: unknown) => {
      writes.push(String(chunk));
      return true;
    }) as typeof process.stdout.write);
    const program = createProgram({
      fs: createMemFs(homeDir),
      prompts: async () => ({}),
      env: { cwd: "/repo", homeDir },
      logger: () => {},
      exitOverride: true
    });

    await program.parseAsync(["node", "cli", "help"]);

    const output = stripVTControlCharacters(writes.join(""));
    expect(output).toContain("Configure coding agents to use the Poe API.");
    expect(output).toContain("configure");
  });

  it.each([
    ["--help", ["--help"]],
    ["help", ["help"]],
    ["no arguments", []],
    ["configure --help", ["configure", "--help"]],
    ["help configure", ["help", "configure"]]
  ])("ends %s output with exactly one terminal newline", async (_name, args) => {
    const writes: string[] = [];
    vi.spyOn(process.stdout, "write").mockImplementation(((chunk: unknown) => {
      writes.push(String(chunk));
      return true;
    }) as typeof process.stdout.write);
    process.argv = ["node", "/usr/local/bin/poe-code", ...args];
    const prompts = vi.fn().mockResolvedValue({});
    const program = createProgram({
      fs: createMemFs(homeDir),
      prompts,
      env: { cwd: "/repo", homeDir, variables: {} },
      logger: () => {},
      exitOverride: true
    });

    const result = program.parseAsync(process.argv);
    if (args.includes("--help")) {
      await expect(result).rejects.toMatchObject({
        code: "commander.helpDisplayed",
        exitCode: 0
      });
    } else {
      await expect(result).resolves.toBe(program);
    }

    const output = writes.join("");
    expect(output.endsWith("\n")).toBe(true);
    expect(output.endsWith("\n\n")).toBe(false);
    expect(`${output}$ `.split("\n").at(-1)).toBe("$ ");
    expect(prompts).not.toHaveBeenCalled();
  });

  it("prints command help for `help <command>`", async () => {
    const writes: string[] = [];
    vi.spyOn(process.stdout, "write").mockImplementation(((chunk: unknown) => {
      writes.push(String(chunk));
      return true;
    }) as typeof process.stdout.write);
    const program = createProgram({
      fs: createMemFs(homeDir),
      prompts: async () => ({}),
      env: { cwd: "/repo", homeDir },
      logger: () => {},
      exitOverride: true
    });

    await program.parseAsync(["node", "cli", "help", "maestro", "tui"]);

    const output = stripVTControlCharacters(writes.join(""));
    expect(output).toContain("Poe - maestro tui");
    expect(output).toContain("--workflow");
  });

  it("reports command not found for `help <unknown>`", async () => {
    const program = createProgram({
      fs: createMemFs(homeDir),
      prompts: async () => ({}),
      env: { cwd: "/repo", homeDir },
      logger: () => {},
      exitOverride: true,
      suppressCommanderOutput: true
    });

    await expect(program.parseAsync(["node", "cli", "help", "bogus"])).rejects.toThrow();
    expect(process.exitCode).toBe(1);
    process.exitCode = 0;
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

  it.each(["help", "version", "dashboard"])(
    "lists the conventional %s command in root help",
    (name) => {
      const program = createProgram({
        fs: createMemFs(homeDir),
        prompts: async () => ({}),
        env: { cwd: "/repo", homeDir },
        logger: () => {},
        exitOverride: true,
        suppressCommanderOutput: true
      });

      expect(program.commands.some((command) => command.name() === name)).toBe(true);
      expect(stripVTControlCharacters(program.helpInformation())).toContain(name);
    }
  );

  it("does not expose the employee-only whoami commands", () => {
    const program = createProgram({
      fs: createMemFs(homeDir),
      prompts: async () => ({}),
      env: { cwd: "/repo", homeDir },
      logger: () => {},
      exitOverride: true,
      suppressCommanderOutput: true
    });

    expect(program.commands.some((command) => command.name() === "whoami")).toBe(false);
    const auth = program.commands.find((command) => command.name() === "auth");
    expect(auth?.commands.some((command) => command.name() === "whoami")).toBe(false);
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

  describe("group help formatting", () => {
    const renderHelp = async (args: string[]): Promise<string> => {
      const writes: string[] = [];
      vi.spyOn(process.stdout, "write").mockImplementation(((chunk: unknown) => {
        writes.push(String(chunk));
        return true;
      }) as typeof process.stdout.write);
      process.argv = ["node", "/usr/local/bin/poe-code", ...args];
      const program = createProgram({
        fs: createMemFs(homeDir),
        prompts: async () => ({}),
        env: { cwd: "/repo", homeDir },
        logger: () => {},
        exitOverride: true
      });

      try {
        await program.parseAsync(process.argv);
      } catch (error) {
        expect(error).toBeInstanceOf(CommanderError);
      }

      return stripVTControlCharacters(writes.join(""));
    };

    const usageLineOf = (help: string): string =>
      help.split("\n").find((line) => line.startsWith("Usage:")) ?? "";

    it.each(["skill", "utils", "usage", "ralph", "worktree", "harness", "provider", "runtime"])(
      "advertises the required subcommand in the %s usage line",
      async (command) => {
        const usageLine = usageLineOf(await renderHelp([command, "--help"]));

        expect(usageLine).toBe(`Usage: poe-code ${command} <command>`);
      }
    );

    it.each(["provider", "runtime", "harness", "skill"])(
      "omits commander's implicit help subcommand from %s help",
      async (command) => {
        const output = await renderHelp([command, "--help"]);

        expect(output).not.toContain("display help for command");
        expect(output).not.toContain("help [command]");
      }
    );
  });

  it("reports command not found for an unknown worktree subcommand asking for help", async () => {
    const logs: string[] = [];
    process.argv = ["node", "/usr/local/bin/poe-code", "worktree", "add", "--help"];
    const program = createProgram({
      fs: createMemFs(homeDir),
      prompts: async () => ({}),
      env: { cwd: "/repo", homeDir },
      logger: (message) => logs.push(message),
      exitOverride: true,
      suppressCommanderOutput: true
    });

    await expect(program.parseAsync(process.argv)).rejects.toThrow();

    expect(process.exitCode).toBe(1);
    process.exitCode = 0;
    const output = stripVTControlCharacters(logs.join("\n"));
    expect(output).toContain("add");
    expect(output).toContain("worktree --help");
  });

  describe("global flags on subcommand help", () => {
    const renderHelp = async (args: string[]): Promise<string> => {
      const writes: string[] = [];
      vi.spyOn(process.stdout, "write").mockImplementation(((chunk: unknown) => {
        writes.push(String(chunk));
        return true;
      }) as typeof process.stdout.write);
      process.argv = ["node", "/usr/local/bin/poe-code", ...args];
      const program = createProgram({
        fs: createMemFs(homeDir),
        prompts: async () => ({}),
        env: { cwd: "/repo", homeDir },
        logger: () => {},
        exitOverride: true
      });

      try {
        await program.parseAsync(process.argv);
      } catch (error) {
        // --help exits through commander; exitOverride surfaces it as an error.
        expect(error).toBeInstanceOf(CommanderError);
      }

      return stripVTControlCharacters(writes.join(""));
    };

    it("documents --yes on memory clear, whose body requires it without a TTY", async () => {
      const output = await renderHelp(["memory", "clear", "--help"]);

      expect(output).toContain("Global Options:");
      expect(output).toContain("-y, --yes");
    });

    it.each([
      ["spawn"],
      ["unconfigure"],
      ["install"],
      ["login"],
      ["update"],
      ["plan"],
      ["pipeline"],
      ["worktree"]
    ])("lists the root global flags on %s help", async (command) => {
      const output = await renderHelp([command, "--help"]);

      const globalBlock = output.slice(output.indexOf("Global Options:"));
      expect(output).toContain("Global Options:");
      expect(globalBlock).toContain("-y, --yes");
      expect(globalBlock).toContain("--dry-run");
      expect(globalBlock).toContain("--verbose");
    });

    it("keeps root help free of a Global Options section", async () => {
      const output = await renderHelp(["--help"]);

      expect(output).not.toContain("Global Options:");
      expect(output).toContain("-y, --yes");
    });
  });

  describe("forwarded toolcraft help matches commander help", () => {
    const renderHelp = async (args: string[]): Promise<string> => {
      const writes: string[] = [];
      vi.spyOn(process.stdout, "write").mockImplementation(((chunk: unknown) => {
        writes.push(String(chunk));
        return true;
      }) as typeof process.stdout.write);
      // argv[1] ending in .ts puts the CLI in development execution mode, which is
      // where the 'npm run dev --' invocation used to leak into help output.
      process.argv = ["node", "/repo/src/index.ts", ...args];
      const program = createProgram({
        fs: createMemFs(homeDir),
        prompts: async () => ({}),
        env: { cwd: "/repo", homeDir },
        logger: () => {},
        exitOverride: true,
        suppressCommanderOutput: true
      });

      await program.parseAsync(process.argv);

      return stripVTControlCharacters(writes.join(""));
    };

    it("titles forwarded group help without the redundant poe-code segment", async () => {
      expect(await renderHelp(["superintendent", "--help"])).toContain("Poe - superintendent");
    });

    it("uses the canonical binary name in forwarded usage lines, never npm run dev", async () => {
      const output = await renderHelp(["superintendent", "--help"]);

      expect(output).toContain("Usage: poe-code superintendent");
      expect(output).not.toContain("npm run dev");
    });

    it("renders forwarded section headings with commander casing", async () => {
      const output = await renderHelp(["superintendent", "--help"]);

      expect(output).toContain("Commands:");
      expect(output).not.toMatch(/^COMMANDS$/m);
    });

    it("collapses forwarded command rows instead of dumping every flag inline", async () => {
      const output = await renderHelp(["superintendent", "--help"]);

      expect(output).toContain("run [docs...] [+8 options]");
      expect(output).not.toContain("--runner-sync");
    });

    it("lists forwarded leaf positionals under Arguments, not Options", async () => {
      const output = await renderHelp(["superintendent", "run", "--help"]);

      expect(output).toContain("Arguments:");
      const argumentsBlock = output.slice(output.indexOf("Arguments:"), output.indexOf("Options:"));
      const optionsBlock = output.slice(output.indexOf("Options:"));

      expect(argumentsBlock).toContain("[docs...]");
      expect(optionsBlock).not.toContain("[docs...]");
      expect(optionsBlock).toContain("--agent");
    });

    it("does not render two competing Options headings in forwarded leaf help", async () => {
      const output = await renderHelp(["superintendent", "run", "--help"]);

      expect(output).not.toMatch(/^OPTIONS$/m);
      expect(output).toContain("Global Options:");
      expect(output.match(/^Options:$/gm)).toHaveLength(1);
    });
  });
});
