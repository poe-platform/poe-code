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

describe("skill configure command", () => {
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
      "configure",
      "--agent",
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
      "--agent",
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
