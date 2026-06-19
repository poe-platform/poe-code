import { describe, expect, it } from "vitest";
import { Volume, createFsFromVolume } from "memfs";
import { loadInventory } from "./inventory.js";
import { createDummyAgentConfigFixture, dummyCwd, dummyHome, fixedDate } from "./fixtures/dummy-config.js";
import type { AgentStashContext, AgentStashFileSystem } from "./types.js";

function createContext(files = createDummyAgentConfigFixture()): AgentStashContext {
  return {
    cwd: dummyCwd,
    homeDir: dummyHome,
    fs: createFsFromVolume(Volume.fromJSON(files, "/")).promises as unknown as AgentStashFileSystem,
    now: () => fixedDate
  };
}

function createVolumeContext(files = createDummyAgentConfigFixture()): {
  ctx: AgentStashContext;
  volume: Volume;
} {
  const volume = Volume.fromJSON(files, "/");
  return {
    volume,
    ctx: {
      cwd: dummyCwd,
      homeDir: dummyHome,
      fs: createFsFromVolume(volume).promises as unknown as AgentStashFileSystem,
      now: () => fixedDate
    }
  };
}

describe("inventory", () => {
  it("discovers project Claude skills", async () => {
    const items = await loadInventory(createContext(), { scope: "project", agent: "claude-code", kind: "skill" });
    expect(items.map((item) => item.id)).toEqual([
      "project:skill:claude-code:code-review",
      "project:skill:claude-code:commit-helper",
      "project:skill:claude-code:project-only"
    ]);
  });

  it("discovers global Claude skills", async () => {
    const items = await loadInventory(createContext(), { scope: "global", agent: "claude-code", kind: "skill" });
    expect(items.map((item) => item.id)).toEqual([
      "global:skill:claude-code:code-review",
      "global:skill:claude-code:global-only"
    ]);
  });

  it("refuses to read project skills through symbolic link roots", async () => {
    const { ctx, volume } = createVolumeContext({
      ...createDummyAgentConfigFixture(),
      "/outside/skills/outside-skill/SKILL.md": "# Outside\n"
    });
    volume.rmSync("/repo/.claude/skills", { recursive: true, force: true });
    volume.symlinkSync("/outside/skills", "/repo/.claude/skills");

    await expect(loadInventory(ctx, { scope: "project", agent: "claude-code", kind: "skill" })).rejects.toThrow(
      "Refusing to write through symbolic link: /repo/.claude/skills"
    );
  });

  it("refuses to read global skills through symbolic link roots", async () => {
    const { ctx, volume } = createVolumeContext({
      ...createDummyAgentConfigFixture(),
      "/outside/skills/outside-skill/SKILL.md": "# Outside\n"
    });
    volume.rmSync("/home/user/.claude/skills", { recursive: true, force: true });
    volume.symlinkSync("/outside/skills", "/home/user/.claude/skills");

    await expect(loadInventory(ctx, { scope: "global", agent: "claude-code", kind: "skill" })).rejects.toThrow(
      "Refusing to write through symbolic link: /home/user/.claude/skills"
    );
  });

  it("does not inspect skill roots for an explicitly empty skill selection", async () => {
    const { ctx, volume } = createVolumeContext({
      ...createDummyAgentConfigFixture(),
      "/outside/skills/outside-skill/SKILL.md": "# Outside\n"
    });
    volume.rmSync("/repo/.claude/skills", { recursive: true, force: true });
    volume.symlinkSync("/outside/skills", "/repo/.claude/skills");

    await expect(loadInventory(ctx, {
      scope: "project",
      agent: "claude-code",
      kind: "skill",
      skills: []
    })).resolves.toEqual([]);
  });

  it("discovers project Codex skills through the skill registry", async () => {
    const items = await loadInventory(createContext(), { scope: "project", agent: "codex", kind: "skill" });
    expect(items.map((item) => item.id)).toEqual(["project:skill:codex:codex-project"]);
  });

  it("discovers global Codex skills through the skill registry", async () => {
    const items = await loadInventory(createContext(), { scope: "global", agent: "codex", kind: "skill" });
    expect(items.map((item) => item.id)).toEqual(["global:skill:codex:codex-global"]);
  });

  it("reads global Claude hooks as event fragments", async () => {
    const items = await loadInventory(createContext(), { scope: "global", agent: "claude-code", kind: "hook" });
    expect(items.map((item) => item.id)).toEqual(["global:hook:claude-code:Stop"]);
  });

  it("reads project Claude hooks as event fragments without non-hook settings", async () => {
    const items = await loadInventory(createContext(), { scope: "project", agent: "claude-code", kind: "hook" });
    const preToolUse = items.find((item) => item.name === "PreToolUse");
    expect(items.map((item) => item.id)).toEqual([
      "project:hook:claude-code:PreToolUse",
      "project:hook:claude-code:Stop"
    ]);
    expect(preToolUse?.bundleFiles[0]?.content).toContain('"hooks"');
    expect(preToolUse?.bundleFiles[0]?.content).not.toContain("permissions");
  });

  it("reads project Codex hooks as event fragments", async () => {
    const items = await loadInventory(createContext(), { scope: "project", agent: "codex", kind: "hook" });
    expect(items.map((item) => item.id)).toEqual(["project:hook:codex:PreToolUse"]);
  });

  it("rejects hook config files that are not objects", async () => {
    const files = {
      ...createDummyAgentConfigFixture(),
      "/repo/.claude/settings.json": "null"
    };

    await expect(loadInventory(createContext(files), { scope: "project", agent: "claude-code", kind: "hook" })).rejects.toThrow(
      "Malformed hooks in /repo/.claude/settings.json"
    );
  });

  it("rejects malformed hook config JSON with a path-specific error", async () => {
    const files = {
      ...createDummyAgentConfigFixture(),
      "/repo/.claude/settings.json": "{"
    };

    await expect(loadInventory(createContext(files), { scope: "project", agent: "claude-code", kind: "hook" })).rejects.toThrow(
      "Malformed hooks in /repo/.claude/settings.json"
    );
  });

  it("does not inspect hook config for an explicitly empty hook selection", async () => {
    const files = {
      ...createDummyAgentConfigFixture(),
      "/repo/.claude/settings.json": "{"
    };

    await expect(loadInventory(createContext(files), {
      scope: "project",
      agent: "claude-code",
      kind: "hook",
      hooks: []
    })).resolves.toEqual([]);
  });

  it("refuses to read project hook config through symbolic links", async () => {
    const { ctx, volume } = createVolumeContext({
      ...createDummyAgentConfigFixture(),
      "/outside/settings.json": JSON.stringify({
        hooks: {
          PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "outside" }] }]
        }
      }, null, 2)
    });
    volume.unlinkSync("/repo/.claude/settings.json");
    volume.symlinkSync("/outside/settings.json", "/repo/.claude/settings.json");

    await expect(loadInventory(ctx, { scope: "project", agent: "claude-code", kind: "hook" })).rejects.toThrow(
      "Refusing to write through symbolic link: /repo/.claude/settings.json"
    );
  });

  it("rejects hooks collections that are not objects", async () => {
    const files = {
      ...createDummyAgentConfigFixture(),
      "/repo/.claude/settings.json": JSON.stringify({ hooks: [] }, null, 2)
    };

    await expect(loadInventory(createContext(files), { scope: "project", agent: "claude-code", kind: "hook" })).rejects.toThrow(
      "Malformed hooks in /repo/.claude/settings.json"
    );
  });

  it("reads global Codex hooks as event fragments", async () => {
    const items = await loadInventory(createContext(), { scope: "global", agent: "codex", kind: "hook" });
    expect(items.map((item) => item.id)).toEqual(["global:hook:codex:Stop"]);
  });

  it("refuses to read global hook config through symbolic links", async () => {
    const { ctx, volume } = createVolumeContext({
      ...createDummyAgentConfigFixture(),
      "/outside/settings.json": JSON.stringify({
        hooks: {
          Stop: [{ hooks: [{ type: "command", command: "outside" }] }]
        }
      }, null, 2)
    });
    volume.unlinkSync("/home/user/.claude/settings.json");
    volume.symlinkSync("/outside/settings.json", "/home/user/.claude/settings.json");

    await expect(loadInventory(ctx, { scope: "global", agent: "claude-code", kind: "hook" })).rejects.toThrow(
      "Refusing to write through symbolic link: /home/user/.claude/settings.json"
    );
  });

  it("excludes project skills that match .agent-stashignore", async () => {
    const files = {
      ...createDummyAgentConfigFixture(),
      "/repo/.claude/skills/private-client/SKILL.md": "# Private\n",
      "/repo/.agent-stashignore": ".claude/skills/private-client/**\n"
    };
    const items = await loadInventory(createContext(files), { scope: "project", agent: "claude-code", kind: "skill" });
    expect(items.map((item) => item.name)).not.toContain("private-client");
  });

  it("refuses to load project ignores through symbolic links", async () => {
    const { ctx, volume } = createVolumeContext({
      ...createDummyAgentConfigFixture(),
      "/outside/ignore": ".claude/skills/code-review/**\n"
    });
    volume.unlinkSync("/repo/.agent-stashignore");
    volume.symlinkSync("/outside/ignore", "/repo/.agent-stashignore");

    await expect(loadInventory(ctx, { scope: "project", agent: "claude-code", kind: "skill" })).rejects.toThrow(
      "Refusing to write through symbolic link: /repo/.agent-stashignore"
    );
  });

  it("excludes files inside included project skills when they match .agent-stashignore", async () => {
    const files = {
      ...createDummyAgentConfigFixture(),
      "/repo/.claude/skills/code-review/notes.local.md": "local notes\n",
      "/repo/.agent-stashignore": "*.local.md\n"
    };
    const items = await loadInventory(createContext(files), { scope: "project", agent: "claude-code", kind: "skill" });
    const codeReview = items.find((item) => item.name === "code-review");

    expect(codeReview?.bundleFiles.map((file) => file.path)).toEqual(["skills/project/claude-code/code-review/SKILL.md"]);
  });

  it("excludes project hooks when their source config matches .agent-stashignore", async () => {
    const files = {
      ...createDummyAgentConfigFixture(),
      "/repo/.agent-stashignore": ".claude/settings.json\n"
    };
    const items = await loadInventory(createContext(files), { scope: "project", agent: "claude-code", kind: "hook" });

    expect(items).toEqual([]);
  });

  it("excludes global skills that match the global ignore file", async () => {
    const files = {
      ...createDummyAgentConfigFixture(),
      "/home/user/.agent-stash/ignore": ".claude/skills/global-only/**\n"
    };
    const items = await loadInventory(createContext(files), { scope: "global", agent: "claude-code", kind: "skill" });
    expect(items.map((item) => item.name)).toEqual(["code-review"]);
  });

  it("excludes global hooks when their source config matches the global ignore file", async () => {
    const files = {
      ...createDummyAgentConfigFixture(),
      "/home/user/.agent-stash/ignore": ".claude/settings.json\n"
    };
    const items = await loadInventory(createContext(files), { scope: "global", agent: "claude-code", kind: "hook" });

    expect(items).toEqual([]);
  });

  it("refuses to load global ignores through symbolic links", async () => {
    const { ctx, volume } = createVolumeContext({
      ...createDummyAgentConfigFixture(),
      "/outside/ignore": ".claude/skills/code-review/**\n"
    });
    volume.unlinkSync("/home/user/.agent-stash/ignore");
    volume.symlinkSync("/outside/ignore", "/home/user/.agent-stash/ignore");

    await expect(loadInventory(ctx, { scope: "global", agent: "claude-code", kind: "skill" })).rejects.toThrow(
      "Refusing to write through symbolic link: /home/user/.agent-stash/ignore"
    );
  });

  it("returns an empty inventory for absent config trees", async () => {
    await expect(loadInventory(createContext({}), { scope: "project", agent: "claude-code" })).resolves.toEqual([]);
  });
});
