import { afterEach, describe, expect, it, vi } from "vitest";
import { CommanderError, type Command } from "commander";
import { Volume, createFsFromVolume } from "memfs";
import { createProgram } from "../program.js";
import type { FileSystem } from "../utils/file-system.js";

function createMemFs(): FileSystem {
  const volume = new Volume();
  volume.mkdirSync("/home/test", { recursive: true });
  return createFsFromVolume(volume).promises as unknown as FileSystem;
}

function stripAnsi(input: string): string {
  let result = "";
  let index = 0;

  while (index < input.length) {
    const char = input[index];
    if (char === "\u001b" && input[index + 1] === "[") {
      index += 2;
      while (index < input.length && input[index] !== "m") {
        index += 1;
      }
      index += 1;
      continue;
    }
    result += char;
    index += 1;
  }

  return result;
}

/** Pins the help width so wrapping assertions cannot drift with the ambient terminal. */
function setHelpWidth(command: Command, width: number): void {
  command.configureOutput({ getOutHelpWidth: () => width });
  for (const subcommand of command.commands) {
    setHelpWidth(subcommand, width);
  }
}

async function renderHelp(argv: string[]): Promise<string> {
  process.argv = ["node", "/usr/local/bin/poe-code", ...argv];
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
  setHelpWidth(program, 80);
  const chunks: string[] = [];
  const stdoutWrite = vi
    .spyOn(process.stdout, "write")
    .mockImplementation(((chunk: unknown) => {
      chunks.push(String(chunk));
      return true;
    }) as unknown as typeof process.stdout.write);

  try {
    await program.parseAsync(["node", "cli", ...argv]);
  } catch (error) {
    if (!(error instanceof CommanderError) || error.code !== "commander.helpDisplayed") {
      throw error;
    }
  } finally {
    stdoutWrite.mockRestore();
  }

  return stripAnsi(chunks.join(""));
}

/** Returns the body lines of a help section: everything indented under its heading. */
function sectionBody(help: string, heading: string): string[] {
  const lines = help.split("\n");
  const start = lines.indexOf(heading);
  expect(start, `help is missing the "${heading}" section`).toBeGreaterThan(-1);
  const body: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (line.length > 0 && !line.startsWith(" ")) {
      break;
    }
    body.push(line);
  }
  return body;
}

/** Returns one option's help entry, rejoining the lines its description wrapped onto. */
function optionHelpEntry(help: string, flag: string): string {
  const lines = help.split("\n");
  const start = lines.findIndex((line) => line.trimStart().startsWith(`${flag} `));
  expect(start, `help is missing the "${flag}" option`).toBeGreaterThan(-1);
  const entry = [lines[start] ?? ""];
  for (const line of lines.slice(start + 1)) {
    const trimmed = line.trim();
    if (trimmed.length === 0 || trimmed.startsWith("-")) {
      break;
    }
    entry.push(line);
  }
  return entry.join(" ").replace(/\s+/g, " ").trim();
}

describe("primary command help examples", () => {
  const originalArgv = [...process.argv];

  afterEach(() => {
    vi.restoreAllMocks();
    process.argv = [...originalArgv];
  });

  it.each([
    ["configure", ["configure", "--help"], "$ poe-code configure claude"],
    ["spawn", ["spawn", "--help"], "$ poe-code spawn claude"],
    ["plan", ["plan", "--help"], "$ poe-code plan"],
    ["models", ["models", "--help"], "$ poe-code models --provider anthropic"]
  ])("gives %s an Examples section", async (_name, argv, example) => {
    const help = await renderHelp(argv);
    expect(sectionBody(help, "Examples:").join("\n")).toContain(example);
  });

  it.each([["configure"], ["spawn"], ["plan"], ["models"]])(
    "keeps %s examples and notes inside an 80 column terminal",
    async (name) => {
      const help = await renderHelp([name, "--help"]);
      const guided = [
        ...sectionBody(help, "Examples:"),
        ...sectionBody(help, "Notes:")
      ];

      expect(guided.filter((line) => line.length > 80)).toEqual([]);
    }
  );

  it("groups spawn options into Options, Advanced, and Infrastructure", async () => {
    const help = await renderHelp(["spawn", "--help"]);

    const options = sectionBody(help, "Options:").join("\n");
    const advanced = sectionBody(help, "Advanced:").join("\n");
    const infrastructure = sectionBody(help, "Infrastructure:").join("\n");

    expect(options).toContain("--model");
    expect(options).toContain("--mode");
    expect(options).toContain("-i, --interactive");
    expect(options).not.toContain("--log-dir");
    expect(options).not.toContain("--hooks-strategy");

    expect(advanced).toContain("--mcp-servers");
    expect(advanced).toContain("--hooks-strategy");
    expect(advanced).toContain("--skill <ref>");

    expect(infrastructure).toContain("--log-dir");
    expect(infrastructure).toContain("--log-content");
    expect(infrastructure).toContain("--capture-otel");
    expect(infrastructure).toContain("--runtime <runtime>");
    expect(infrastructure).toContain("--detach");
  });

  it("documents --mcp-servers with an example instead of a raw JSON schema", async () => {
    const help = await renderHelp(["spawn", "--help"]);

    expect(help).not.toContain("{name: {command, args?, env?}}");
    expect(sectionBody(help, "Examples:").join("\n")).toContain("--mcp-servers");
  });

  it("labels the plan explorer keymap instead of trailing it after the help body", async () => {
    const help = await renderHelp(["plan", "--help"]);

    expect(help).not.toContain("Explorer keymap: e edit, a archive, d delete, n new");
    expect(sectionBody(help, "Notes:").join("\n")).toContain("e edit");
    expect(help.trimEnd().endsWith("n new")).toBe(false);
  });

  it("drops the models Filters section that duplicated Options", async () => {
    const help = await renderHelp(["models", "--help"]);

    expect(help).not.toContain("Filters:");
    expect(help).not.toContain("Views:");
    expect(help).toMatch(/combine with AND/i);
    expect(sectionBody(help, "Options:").join("\n")).toContain("Substring match on provider");
    expect(sectionBody(help, "Options:").join("\n")).toContain("pricing");
  });

  it.each([
    ["pipeline", ["pipeline", "run", "--help"]],
    ["experiment", ["experiment", "run", "--help"]],
    ["ralph", ["ralph", "run", "--help"]]
  ])("documents the dashboard exit keys on %s run --tui", async (_name, argv) => {
    const help = await renderHelp(argv);
    const tuiEntry = optionHelpEntry(help, "--tui");

    expect(tuiEntry).toContain("Show a live dashboard");
    expect(tuiEntry).toContain("q quit, Ctrl+C force quit");
  });
});
