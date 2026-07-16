import { describe, it, expect, vi, afterEach } from "vitest";
import { Volume, createFsFromVolume } from "memfs";
import type { FileSystem } from "../utils/file-system.js";
import { createProgram } from "./program.js";
import { ValidationError } from "./errors.js";

const homeDir = "/home/test";

function createMemFs(): FileSystem {
  const vol = new Volume();
  vol.mkdirSync(homeDir, { recursive: true });
  return createFsFromVolume(vol).promises as unknown as FileSystem;
}

function createTestProgram() {
  return createProgram({
    fs: createMemFs(),
    prompts: async () => ({}),
    env: { cwd: "/repo", homeDir },
    logger: () => {},
    exitOverride: true
  });
}

async function captureParseError(args: string[]): Promise<Error> {
  const program = createTestProgram();
  try {
    await program.parseAsync(["node", "cli", ...args]);
  } catch (error) {
    return error as Error;
  }
  throw new Error(`expected \`${args.join(" ")}\` to fail`);
}

describe("commander input errors", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("reports a missing argument as a design-system validation error with usage", async () => {
    const error = await captureParseError(["spawn"]);

    expect(error).toBeInstanceOf(ValidationError);
    expect(error.message).not.toContain("error: missing required argument");
    expect(error.message).toContain("<agent>");
    expect(error.message).toContain("Usage: poe-code spawn");
  });

  it("names the spawnable agents when spawn is missing its agent", async () => {
    const error = await captureParseError(["spawn"]);

    expect(error.message).toContain("Agent to spawn");
    expect(error.message).toContain("claude");
  });

  it("lists the missing argument and the missing required option together", async () => {
    const error = await captureParseError(["worktree", "reconcile"]);

    expect(error).toBeInstanceOf(ValidationError);
    expect(error.message).toContain("<name>");
    expect(error.message).toContain("--agent <name>");
  });

  it("reports both maestro tick required options in one error", async () => {
    const error = await captureParseError(["maestro", "tick"]);

    expect(error.message).toContain("--task <qualifiedId>");
    expect(error.message).toContain("--transition <fromState:toState>");
  });

  it("reports the missing memory write path alongside --reason", async () => {
    const error = await captureParseError(["memory", "write"]);

    expect(error.message).toContain("<path>");
    expect(error.message).toContain("--reason <text>");
  });

  it("reports both required skill install flags in one error", async () => {
    const error = await captureParseError(["skill", "install", "claude"]);

    expect(error.message).toContain("--name <name>");
    expect(error.message).toContain("--file <path>");
  });

  it("lists agent choices when memory install is missing --agent", async () => {
    const error = await captureParseError(["memory", "install", "--yes"]);

    expect(error.message).toContain("--agent <agent>");
    expect(error.message).toContain("choices: claude-code");
  });

  it("lists the built-in harness kinds when the kind argument is missing", async () => {
    const error = await captureParseError(["harness", "new"]);

    expect(error.message).toContain("<kind>");
    expect(error.message).toContain("choices: ralph-demo");
  });

  it("rejects an unknown harness kind with the valid kinds", async () => {
    const error = await captureParseError(["harness", "new", "bogus", "demo"]);

    expect(error).toBeInstanceOf(ValidationError);
    expect(error.message).toContain("Allowed choices are ralph-demo");
  });

  it("reports an invalid option choice as a validation error", async () => {
    const error = await captureParseError([
      "spawn",
      "claude",
      "hi",
      "--hooks-strategy",
      "bogus"
    ]);

    expect(error).toBeInstanceOf(ValidationError);
    expect(error.message).toContain("Allowed choices are auto, symlink, transform");
  });

  it("reports an invalid models --view choice as a validation error", async () => {
    const error = await captureParseError(["models", "--view", "bogus"]);

    expect(error).toBeInstanceOf(ValidationError);
    expect(error.message).toContain("Allowed choices are capabilities");
  });

  it("does not let commander print its own error text", async () => {
    const stderrWrites: string[] = [];
    vi.spyOn(process.stderr, "write").mockImplementation(((chunk: unknown) => {
      stderrWrites.push(String(chunk));
      return true;
    }) as typeof process.stderr.write);

    await captureParseError(["unconfigure"]);

    expect(stderrWrites.join("")).not.toContain("error:");
  });
});
