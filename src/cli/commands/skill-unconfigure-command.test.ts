import { describe, it, expect, vi, beforeEach, afterEach } from "bun:test";
import { Volume, createFsFromVolume } from "memfs";
import type { FileSystem } from "../utils/file-system.js";

const selectMock = vi.fn();
const cancelMock = vi.fn();

const identity = (s: string) => s;

import * as designSystemModule from "@poe-code/design-system";

let selectSpyDs: ReturnType<typeof vi.spyOn>;
let cancelSpyDs: ReturnType<typeof vi.spyOn>;
let isCancelSpyDs: ReturnType<typeof vi.spyOn>;

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

describe("skill unconfigure command", () => {
    beforeEach(() => {
    selectSpyDs = vi.spyOn(designSystemModule, "select" as any).mockImplementation(selectMock);
    cancelSpyDs = vi.spyOn(designSystemModule, "cancel" as any).mockImplementation(cancelMock);
    isCancelSpyDs = vi.spyOn(designSystemModule, "isCancel" as any).mockImplementation((value: unknown) => value === "__cancel__");
  });

  afterEach(() => {
    vi.restoreAllMocks();
    selectMock.mockReset();
    cancelMock.mockReset();
    selectSpyDs?.mockRestore();
    cancelSpyDs?.mockRestore();
    isCancelSpyDs?.mockRestore();
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
      "--agent",
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
      "--agent",
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
      "--agent",
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
