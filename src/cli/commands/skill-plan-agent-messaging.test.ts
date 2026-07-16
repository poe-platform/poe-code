import { describe, it, expect, vi } from "vitest";
import { Volume, createFsFromVolume } from "memfs";
import type { FileSystem } from "../../utils/file-system.js";
import { ValidationError } from "../errors.js";
import { createProgram } from "../program.js";

const cwd = "/repo";
const homeDir = "/home/test";

function createMemFs(): FileSystem {
  const vol = new Volume();
  vol.mkdirSync(homeDir, { recursive: true });
  vol.mkdirSync(cwd, { recursive: true });
  return createFsFromVolume(vol).promises as unknown as FileSystem;
}

function runCli(argv: string[]): Promise<unknown> {
  const program = createProgram({
    fs: createMemFs(),
    prompts: vi.fn().mockResolvedValue({}),
    env: { cwd, homeDir },
    logger: () => {},
    suppressCommanderOutput: true
  });
  return program.parseAsync(["node", "cli", ...argv]);
}

async function captureError(argv: string[]): Promise<Error> {
  try {
    await runCli(argv);
  } catch (error) {
    return error as Error;
  }
  throw new Error("expected the command to reject");
}

describe("skill commands share the unknown-agent message", () => {
  for (const command of ["configure", "unconfigure"] as const) {
    it(`skill ${command} lists skill-capable agents and suggests a match`, async () => {
      const error = await captureError(["skill", command, "claude-cod", "--yes"]);
      expect(error).toBeInstanceOf(ValidationError);
      expect(error.message).toContain('Unknown agent "claude-cod".');
      expect(error.message).toContain("Did you mean: claude-code?");
      expect(error.message).toContain("Agents supporting skill:");
    });
  }

  it("reports kimi as lacking skill support rather than unknown", async () => {
    const error = await captureError(["skill", "configure", "kimi", "--yes"]);
    expect(error).toBeInstanceOf(ValidationError);
    expect(error.message).toContain('Agent "kimi" does not support skill.');
    expect(error.message).toContain("configure");
  });

  it("advertises alias-inclusive skill agents in help so it matches configure", async () => {
    const program = createProgram({
      fs: createMemFs(),
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir },
      logger: () => {},
      suppressCommanderOutput: true
    });
    const skill = program.commands.find((command) => command.name() === "skill");
    const configure = skill?.commands.find((command) => command.name() === "configure");
    const help = configure?.helpInformation() ?? "";
    for (const alias of ["claude", "cursor-agent", "gemini"]) {
      expect(help).toContain(alias);
    }
  });
});

describe("plan install shares the unknown-agent message", () => {
  it("lists supported agents for an unknown agent", async () => {
    const error = await captureError(["plan", "install", "--agent", "claude-cod", "--local", "--yes"]);
    expect(error).toBeInstanceOf(ValidationError);
    expect(error.message).toContain('Unknown agent "claude-cod".');
    expect(error.message).toContain("Agents supporting skill:");
  });

  it("reports pi as spawn-only instead of a bare Unsupported agent", async () => {
    const error = await captureError(["plan", "install", "--agent", "pi", "--local", "--yes"]);
    expect(error).toBeInstanceOf(ValidationError);
    expect(error.message).toContain('Agent "pi" does not support skill.');
    expect(error.message).toContain("pi supports: spawn.");
  });

  it("reports kimi as configurable but not skill-capable", async () => {
    const error = await captureError(["plan", "install", "--agent", "kimi", "--local", "--yes"]);
    expect(error).toBeInstanceOf(ValidationError);
    expect(error.message).toContain('Agent "kimi" does not support skill.');
    expect(error.message).toContain("configure");
  });
});
