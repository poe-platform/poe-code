import { describe, it, expect, vi, afterEach } from "vitest";
import { Volume, createFsFromVolume } from "memfs";
import type { FileSystem } from "../utils/file-system.js";

const { selectMock, cancelMock } = vi.hoisted(() => {
  return {
    selectMock: vi.fn(),
    cancelMock: vi.fn()
  };
});

vi.mock("@poe-code/design-system", async () => {
  const actual = await vi.importActual<Record<string, unknown>>(
    "@poe-code/design-system"
  );
  return {
    ...actual,
    select: selectMock,
    isCancel: (value: unknown) => value === "__cancel__",
    cancel: cancelMock
  };
});

import { createProgram } from "../program.js";

const cwd = "/repo";
const homeDir = "/home/test";

function createMemFs(): { fs: FileSystem; vol: Volume } {
  const vol = new Volume();
  vol.mkdirSync(homeDir, { recursive: true });
  vol.mkdirSync(cwd, { recursive: true });
  const fs = createFsFromVolume(vol).promises as unknown as FileSystem;
  return { fs, vol };
}

// ---------------------------------------------------------------------------
// skill-unconfigure-command.test.ts
// ---------------------------------------------------------------------------

describe("skill unconfigure command", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    selectMock.mockReset();
    cancelMock.mockReset();
  });

  it("errors for unknown agent", async () => {
    const { fs } = createMemFs();
    const logs: string[] = [];

    const program = createProgram({
      fs,
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir },
      logger: (message) => {
        logs.push(message);
      },
      suppressCommanderOutput: true
    });

    await program.parseAsync([
      "node",
      "cli",
      "skill",
      "unconfigure",
      "unknown"
    ]);

    expect(logs).toContain("Unknown agent: unknown");
  });

  it("warns when directory has files and --force is not set", async () => {
    const { fs, vol } = createMemFs();
    const logs: string[] = [];

    vol.mkdirSync(`${homeDir}/.claude/skills`, { recursive: true });
    await fs.writeFile(`${homeDir}/.claude/skills/a.txt`, "hello", "utf8");

    const program = createProgram({
      fs,
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir },
      logger: (message) => {
        logs.push(message);
      },
      suppressCommanderOutput: true
    });

    await program.parseAsync([
      "node",
      "cli",
      "skill",
      "unconfigure",
      "claude-code",
      "--global"
    ]);

    expect(logs.some((line) => line.includes("has files"))).toBe(true);
    expect(logs.some((line) => line.includes("--force"))).toBe(true);
    await expect(fs.stat(`${homeDir}/.claude/skills`)).resolves.toBeDefined();
    await expect(fs.readdir(`${homeDir}/.claude/skills`)).resolves.toContain(
      "a.txt"
    );
  });

  it("removes directory when --force is set", async () => {
    const { fs, vol } = createMemFs();
    const logs: string[] = [];

    vol.mkdirSync(`${homeDir}/.claude/skills`, { recursive: true });
    await fs.writeFile(`${homeDir}/.claude/skills/a.txt`, "hello", "utf8");

    const program = createProgram({
      fs,
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir },
      logger: (message) => {
        logs.push(message);
      },
      suppressCommanderOutput: true
    });

    await program.parseAsync([
      "node",
      "cli",
      "skill",
      "unconfigure",
      "claude-code",
      "--global",
      "--force"
    ]);

    expect(logs).toContain(
      "Removed skill directory for claude-code at ~/.claude/skills"
    );
    await expect(fs.stat(`${homeDir}/.claude/skills`)).rejects.toThrow("ENOENT");
  });

  it("prompts for agent and scope when not provided", async () => {
    const { fs, vol } = createMemFs();
    const logs: string[] = [];

    vol.mkdirSync(`${homeDir}/.claude/skills`, { recursive: true });

    selectMock.mockResolvedValueOnce("claude-code").mockResolvedValueOnce("global");

    const program = createProgram({
      fs,
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir },
      logger: (message) => {
        logs.push(message);
      },
      suppressCommanderOutput: true
    });

    await program.parseAsync(["node", "cli", "skill", "unconfigure", "--force"]);

    expect(selectMock).toHaveBeenCalledTimes(2);
    expect(logs).toContain(
      "Removed skill directory for claude-code at ~/.claude/skills"
    );
    await expect(fs.stat(`${homeDir}/.claude/skills`)).rejects.toThrow("ENOENT");
  });
});

// ---------------------------------------------------------------------------
// skill-configure-command.test.ts
// ---------------------------------------------------------------------------

describe("skill configure command", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    selectMock.mockReset();
    cancelMock.mockReset();
  });

  it("errors for unknown agent", async () => {
    const { fs } = createMemFs();
    const logs: string[] = [];

    const program = createProgram({
      fs,
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir },
      logger: (message) => {
        logs.push(message);
      },
      suppressCommanderOutput: true
    });

    await program.parseAsync([
      "node",
      "cli",
      "skill",
      "configure",
      "invalid-provider"
    ]);

    expect(logs).toContain("Unknown agent: invalid-provider");
  });

  it("configures skills for an agent and reports the target path", async () => {
    const { fs } = createMemFs();
    const logs: string[] = [];

    const program = createProgram({
      fs,
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir },
      logger: (message) => {
        logs.push(message);
      },
      suppressCommanderOutput: true
    });

    await program.parseAsync([
      "node",
      "cli",
      "skill",
      "configure",
      "claude-code",
      "--global"
    ]);

    expect(logs).toContain("Configured skills for claude-code at ~/.claude/skills");
    await expect(fs.stat(`${homeDir}/.claude/skills`)).resolves.toBeDefined();
    await expect(
      fs.stat(`${homeDir}/.claude/skills/poe-generate.md`)
    ).resolves.toBeDefined();
  });

  it("prompts for agent and scope when not provided", async () => {
    const { fs } = createMemFs();
    const logs: string[] = [];

    selectMock.mockResolvedValueOnce("claude-code").mockResolvedValueOnce("global");

    const program = createProgram({
      fs,
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir },
      logger: (message) => {
        logs.push(message);
      },
      suppressCommanderOutput: true
    });

    await program.parseAsync(["node", "cli", "skill", "configure"]);

    expect(selectMock).toHaveBeenCalledTimes(2);
    expect(logs).toContain("Configured skills for claude-code at ~/.claude/skills");
    await expect(fs.stat(`${homeDir}/.claude/skills/poe-generate.md`)).resolves.toBeDefined();
  });

  it("uses defaults with --yes and does not prompt", async () => {
    const { fs } = createMemFs();
    const logs: string[] = [];

    const program = createProgram({
      fs,
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir },
      logger: (message) => {
        logs.push(message);
      },
      suppressCommanderOutput: true
    });

    await program.parseAsync(["node", "cli", "--yes", "skill", "configure"]);

    expect(selectMock).not.toHaveBeenCalled();
    expect(logs).toContain("Configured skills for claude-code at ~/.claude/skills");
    await expect(fs.stat(`${homeDir}/.claude/skills/poe-generate.md`)).resolves.toBeDefined();
  });

  it("prompts for agent when --local is provided and reports local path", async () => {
    const { fs } = createMemFs();
    const logs: string[] = [];

    selectMock.mockResolvedValueOnce("claude-code");

    const program = createProgram({
      fs,
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir },
      logger: (message) => {
        logs.push(message);
      },
      suppressCommanderOutput: true
    });

    await program.parseAsync(["node", "cli", "skill", "configure", "--local"]);

    expect(selectMock).toHaveBeenCalledTimes(1);
    expect(logs).toContain("Configured skills for claude-code at ./.claude/skills");
    await expect(fs.stat(`${cwd}/.claude/skills/poe-generate.md`)).resolves.toBeDefined();
  });
});
