import { afterEach, describe, expect, it, vi } from "vitest";
import { CommanderError } from "commander";
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

describe("runtime option help", () => {
  const originalArgv = [...process.argv];

  afterEach(() => {
    vi.restoreAllMocks();
    process.argv = [...originalArgv];
  });

  it.each([
    ["spawn", ["spawn", "--help"]],
    ["experiment", ["experiment", "run", "--help"]],
    ["ralph", ["ralph", "run", "--help"]],
    ["superintendent", ["superintendent", "run", "--help"]]
  ])("snapshots %s help", async (_name, argv) => {
    await expect(renderHelp(argv)).resolves.toMatchSnapshot();
  });
});
