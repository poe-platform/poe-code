import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Volume, createFsFromVolume } from "memfs";
import type { FileSystem } from "../utils/file-system.js";

const { resolveSkillReferenceMock } = vi.hoisted(() => {
  return { resolveSkillReferenceMock: vi.fn() };
});

// resolveSkillReference walks the real filesystem, so the seam is mocked here:
// its own resolution rules are covered by agent-skill-config's unit tests.
vi.mock("@poe-code/agent-skill-config", async () => {
  const actual = await vi.importActual<Record<string, unknown>>("@poe-code/agent-skill-config");
  return {
    ...actual,
    resolveSkillReference: resolveSkillReferenceMock
  };
});

import { createProgram } from "../program.js";

const cwd = "/repo";
const homeDir = "/home/test";

function createMemFs(): FileSystem {
  const vol = new Volume();
  vol.mkdirSync(cwd, { recursive: true });
  vol.mkdirSync(homeDir, { recursive: true });
  return createFsFromVolume(vol).promises as unknown as FileSystem;
}

function createTestProgram(logs: string[]) {
  return createProgram({
    fs: createMemFs(),
    prompts: vi.fn().mockResolvedValue({}),
    env: { cwd, homeDir },
    logger: (message) => {
      logs.push(message);
    },
    suppressCommanderOutput: true
  });
}

describe("skill bridge command", () => {
  beforeEach(() => {
    resolveSkillReferenceMock.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("previews where a reference resolves and where it would be bridged", async () => {
    resolveSkillReferenceMock.mockReturnValue({
      kind: "resolved",
      ref: "claude-code/reviewer",
      name: "reviewer",
      sourceAgentId: "claude-code",
      sourcePath: `${cwd}/.claude/skills/reviewer`,
      scope: "project"
    });
    const logs: string[] = [];

    await createTestProgram(logs).parseAsync([
      "node",
      "cli",
      "skill",
      "bridge",
      "claude-code/reviewer",
      "--agent",
      "codex"
    ]);

    const output = logs.join("\n");
    expect(resolveSkillReferenceMock).toHaveBeenCalledWith("claude-code/reviewer", cwd, homeDir);
    expect(output).toContain("claude-code/reviewer");
    expect(output).toContain(".claude/skills/reviewer");
    expect(output).toContain(".codex/skills/reviewer");
  });

  it("shortens a user-scope source to ~ and targets the spawn agent's local dir", async () => {
    resolveSkillReferenceMock.mockReturnValue({
      kind: "resolved",
      ref: "shared",
      name: "shared",
      sourcePath: `${homeDir}/.poe-code/skills/shared`,
      scope: "user"
    });
    const logs: string[] = [];
    const program = createTestProgram(logs);

    await program.parseAsync(["node", "cli", "skill", "bridge", "shared", "--agent", "codex"]);

    const output = logs.join("\n");
    expect(output).toContain("~/.poe-code/skills/shared");
    expect(output).toContain(".codex/skills/shared");
  });

  it("reports every searched path for an unresolved reference", async () => {
    resolveSkillReferenceMock.mockReturnValue({
      kind: "not-found",
      ref: "missing",
      searchedPaths: [`${cwd}/.poe-code/skills/missing`, `${homeDir}/.poe-code/skills/missing`]
    });

    await expect(
      createTestProgram([]).parseAsync([
        "node",
        "cli",
        "skill",
        "bridge",
        "missing",
        "--agent",
        "codex"
      ])
    ).rejects.toThrow(/missing[\s\S]*\.poe-code\/skills\/missing/);
  });

  it("reports a malformed reference with the expected syntax", async () => {
    resolveSkillReferenceMock.mockReturnValue({ kind: "malformed", ref: "a/b/c" });

    await expect(
      createTestProgram([]).parseAsync(["node", "cli", "skill", "bridge", "a/b/c", "--agent", "codex"])
    ).rejects.toThrow(/<agentId>\/<name>/);
  });

  it("rejects an unknown bridge target agent", async () => {
    await expect(
      createTestProgram([]).parseAsync([
        "node",
        "cli",
        "skill",
        "bridge",
        "shared",
        "--agent",
        "unknown"
      ])
    ).rejects.toThrow(/^Unknown agent "unknown"\. Agents supporting skill: /);
  });
});
