import { describe, expect, it, vi } from "vitest";
import { Volume, createFsFromVolume } from "memfs";
import { gistFilenameForBundlePath } from "../bundle.js";
import { hashFiles, sha256 } from "../hash.js";
import { parseManifest, serializeManifest } from "../manifest.js";
import { copyOrMoveItem } from "./copy-move.js";
import { uploadBundle } from "./upload.js";
import { loadInventory } from "../inventory.js";
import { InMemoryGistClient } from "../fixtures/in-memory-gist-client.js";
import { createDummyAgentConfigFixture, dummyCwd, dummyHome, fixedDate } from "../fixtures/dummy-config.js";
import type { AgentStashContext, AgentStashFileSystem } from "../types.js";

vi.mock("../gist-client.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../gist-client.js")>();
  return {
    ...actual,
    createDefaultGistClient: vi.fn(async () => {
      throw new Error("default Gist client should not be created");
    })
  };
});

function createContext(files = createDummyAgentConfigFixture(), gistClient?: InMemoryGistClient): { ctx: AgentStashContext; volume: Volume } {
  const volume = Volume.fromJSON(files, "/");
  return {
    volume,
    ctx: {
      cwd: dummyCwd,
      homeDir: dummyHome,
      fs: createFsFromVolume(volume).promises as unknown as AgentStashFileSystem,
      gistClient,
      now: () => fixedDate
    }
  };
}

describe("copy/move", () => {
  it("rejects invalid copy and move option values before doing work", async () => {
    const { ctx } = createContext();

    await expect(copyOrMoveItem(ctx, {
      operation: "copy",
      from: "workspace" as "project",
      to: "global",
      agent: "claude-code",
      kind: "skill",
      name: "code-review",
      yes: true
    })).rejects.toThrow(/Invalid copy\/move source/);
    await expect(copyOrMoveItem(ctx, {
      operation: "copy",
      from: "project",
      to: "workspace" as "global",
      agent: "claude-code",
      kind: "skill",
      name: "code-review",
      yes: true
    })).rejects.toThrow(/Invalid copy\/move target/);
    await expect(copyOrMoveItem(ctx, {
      operation: "copy",
      from: "project",
      to: "global",
      agent: "claude-code",
      kind: "tool" as "skill",
      name: "code-review",
      yes: true
    })).rejects.toThrow(/Invalid copy\/move kind/);
  });

  it("copies one project skill to global", async () => {
    const { ctx, volume } = createContext();
    const result = await copyOrMoveItem(ctx, {
      operation: "copy",
      from: "project",
      to: "global",
      agent: "claude-code",
      kind: "skill",
      name: "code-review",
      yes: true
    });

    expect(result.item).toMatchObject({
      id: "global:skill:claude-code:code-review",
      scope: "global",
      path: "skills/global/claude-code/code-review"
    });
    expect(result.item.files.map((file) => file.path)).toEqual([
      "skills/global/claude-code/code-review/SKILL.md"
    ]);
    expect(volume.readFileSync("/home/user/.claude/skills/code-review/SKILL.md", "utf8")).toBe("# Code Review\n");
    expect(volume.readFileSync("/repo/.claude/skills/code-review/SKILL.md", "utf8")).toBe("# Code Review\n");
  });

  it("rejects local copy targets ignored by the target scope before creating a backup", async () => {
    const files = createDummyAgentConfigFixture();
    files["/home/user/.agent-stash/ignore"] = ".claude/skills/code-review/**\n";
    const { ctx, volume } = createContext(files);

    await expect(copyOrMoveItem(ctx, {
      operation: "copy",
      from: "project",
      to: "global",
      agent: "claude-code",
      kind: "skill",
      name: "code-review",
      yes: true
    })).rejects.toThrow("Target skill is ignored: code-review");

    expect(volume.readFileSync("/home/user/.claude/skills/code-review/SKILL.md", "utf8")).toBe("# Global Review\n");
    expect(() => volume.statSync("/home/user/.agent-stash/backups")).toThrow();
  });

  it("moves one global skill to project after writing the target", async () => {
    const { ctx, volume } = createContext();
    const result = await copyOrMoveItem(ctx, {
      operation: "move",
      from: "global",
      to: "project",
      agent: "claude-code",
      kind: "skill",
      name: "global-only",
      yes: true
    });

    expect(volume.readFileSync("/repo/.claude/skills/global-only/SKILL.md", "utf8")).toBe("# Global Only\n");
    expect(
      volume.readFileSync(`/home/user/.agent-stash/backups/${result.backupId}/files/home/user/.claude/skills/global-only/SKILL.md`, "utf8")
    ).toBe("# Global Only\n");
    expect(() => volume.statSync("/home/user/.claude/skills/global-only")).toThrow();
  });

  it("moves one project hook to global without dropping unrelated settings", async () => {
    const { ctx, volume } = createContext();
    const result = await copyOrMoveItem(ctx, {
      operation: "move",
      from: "project",
      to: "global",
      agent: "claude-code",
      kind: "hook",
      name: "PreToolUse-Bash-001-001",
      yes: true
    });

    const projectSettings = JSON.parse(volume.readFileSync("/repo/.claude/settings.json", "utf8") as string) as {
      permissions?: unknown;
      hooks?: Record<string, unknown>;
    };
    const globalSettings = JSON.parse(volume.readFileSync("/home/user/.claude/settings.json", "utf8") as string) as {
      env?: unknown;
      hooks?: Record<string, unknown>;
    };

    expect(result.item).toMatchObject({
      id: "global:hook:claude-code:PreToolUse-Bash-001-001",
      scope: "global",
      path: "hooks/global/claude-code/PreToolUse-Bash-001-001.json"
    });
    expect(projectSettings.permissions).toEqual({ allow: ["Bash(npm test)"] });
    expect(projectSettings.hooks?.PreToolUse).toBeUndefined();
    expect(projectSettings.hooks?.Stop).toEqual([{ hooks: [{ type: "command", command: "echo done" }] }]);
    expect(globalSettings.env).toEqual({ KEEP: "1" });
    expect(globalSettings.hooks?.Stop).toEqual([{ hooks: [{ type: "command", command: "global stop" }] }]);
    expect(globalSettings.hooks?.PreToolUse).toEqual([{ matcher: "Bash", hooks: [{ type: "command", command: "npm test" }] }]);
    expect(
      volume.readFileSync(`/home/user/.agent-stash/backups/${result.backupId}/files/repo/.claude/settings.json`, "utf8")
    ).toContain("PreToolUse");
    expect(
      volume.readFileSync(`/home/user/.agent-stash/backups/${result.backupId}/files/home/user/.claude/settings.json`, "utf8")
    ).toContain("global stop");
  });

  it("rejects moving a project hook to malformed global settings before changing local files", async () => {
    const files = createDummyAgentConfigFixture();
    const originalProjectSettings = files["/repo/.claude/settings.json"]!;
    files["/home/user/.claude/settings.json"] = "{";
    const { ctx, volume } = createContext(files);

    await expect(copyOrMoveItem(ctx, {
      operation: "move",
      from: "project",
      to: "global",
      agent: "claude-code",
      kind: "hook",
      name: "PreToolUse-Bash-001-001",
      yes: true
    })).rejects.toThrow("Malformed hooks in /home/user/.claude/settings.json");

    expect(volume.readFileSync("/repo/.claude/settings.json", "utf8")).toBe(originalProjectSettings);
    expect(volume.readFileSync("/home/user/.claude/settings.json", "utf8")).toBe("{");
    expect(() => volume.statSync("/home/user/.agent-stash/backups")).toThrow();
  });

  it("rejects moving local skill directories before writing when fs.rm is unavailable", async () => {
    const { ctx, volume } = createContext();
    ctx.fs.rm = undefined;

    await expect(copyOrMoveItem(ctx, {
      operation: "move",
      from: "project",
      to: "global",
      agent: "claude-code",
      kind: "skill",
      name: "project-only",
      yes: true
    })).rejects.toThrow("Filesystem rm support is required to remove skill directory: /repo/.claude/skills/project-only");

    expect(volume.readFileSync("/repo/.claude/skills/project-only/SKILL.md", "utf8")).toBe("# Project Only\n");
    expect(() => volume.statSync("/home/user/.claude/skills/project-only")).toThrow();
    expect(() => volume.statSync("/home/user/.agent-stash/backups")).toThrow();
  });

  it("rejects missing source Gist profiles before creating a default Gist client", async () => {
    const { ctx } = createContext();
    ctx.gistClient = undefined;

    await expect(copyOrMoveItem(ctx, {
      operation: "copy",
      from: "gist",
      to: "project",
      agent: "claude-code",
      kind: "skill",
      name: "global-only",
      yes: true
    })).rejects.toThrow("A profile with a Gist is required.");
  });

  it("rejects missing target Gist profiles before creating a default Gist client", async () => {
    const { ctx } = createContext();
    ctx.gistClient = undefined;

    await expect(copyOrMoveItem(ctx, {
      operation: "copy",
      from: "project",
      to: "gist",
      agent: "claude-code",
      kind: "skill",
      name: "code-review",
      yes: true
    })).rejects.toThrow("A profile with a Gist is required.");
  });

  it("rejects missing target Gist profiles before reading local sources or creating backups", async () => {
    const { ctx, volume } = createContext();
    ctx.gistClient = undefined;
    await ctx.fs.rm?.("/repo/.claude/skills/code-review", { recursive: true, force: true });

    await expect(copyOrMoveItem(ctx, {
      operation: "move",
      from: "project",
      to: "gist",
      agent: "claude-code",
      kind: "skill",
      name: "code-review",
      yes: true
    })).rejects.toThrow("A profile with a Gist is required.");

    expect(() => volume.statSync("/home/user/.agent-stash/backups")).toThrow();
  });

  it("rejects invalid remote source agents before reading a Gist", async () => {
    const gistClient = new InMemoryGistClient();
    gistClient.seed({ id: "gist-default", htmlUrl: "https://gist.github.com/gist-default", files: {} });
    const { ctx } = createContext(createDummyAgentConfigFixture(), gistClient);

    await expect(copyOrMoveItem(ctx, {
      operation: "copy",
      from: "gist",
      to: "project",
      profile: "default",
      agent: "missing-agent",
      kind: "skill",
      name: "global-only",
      yes: true
    })).rejects.toThrow("Unknown agent: missing-agent");
    expect(gistClient.readCalls).toHaveLength(0);
    expect(gistClient.updateCalls).toHaveLength(0);
  });

  it("copies one Gist skill to project through the Gist client", async () => {
    const gistClient = new InMemoryGistClient();
    gistClient.seed({ id: "gist-default", htmlUrl: "https://gist.github.com/gist-default", files: {} });
    const source = createContext(createDummyAgentConfigFixture(), gistClient);
    await uploadBundle(source.ctx, {
      profile: "default",
      scope: "global",
      agent: "claude-code",
      skills: ["global-only"],
      yes: true
    });
    const targetFiles = createDummyAgentConfigFixture();
    delete targetFiles["/repo/.claude/skills/global-only/SKILL.md"];
    const target = createContext(targetFiles, gistClient);

    const result = await copyOrMoveItem(target.ctx, {
      operation: "copy",
      from: "gist",
      to: "project",
      profile: "default",
      agent: "claude-code",
      kind: "skill",
      name: "global-only",
      yes: true
    });

    expect(result.item.id).toBe("project:skill:claude-code:global-only");
    expect(result.item.path).toBe("skills/project/claude-code/global-only");
    expect(result.item.files.map((file) => file.path)).toEqual([
      "skills/project/claude-code/global-only/SKILL.md"
    ]);
    expect(target.volume.readFileSync("/repo/.claude/skills/global-only/SKILL.md", "utf8")).toBe("# Global Only\n");
  });

  it("rejects malformed Gist hook fragments before creating a local backup", async () => {
    const gistClient = new InMemoryGistClient();
    gistClient.seed({ id: "gist-default", htmlUrl: "https://gist.github.com/gist-default", files: {} });
    const source = createContext(createDummyAgentConfigFixture(), gistClient);
    await uploadBundle(source.ctx, {
      profile: "default",
      scope: "project",
      agent: "claude-code",
      hooks: ["PreToolUse"],
      yes: true
    });
    const record = await gistClient.read("gist-default");
    updateRemoteHookFragment(record, "hooks/project/claude-code/PreToolUse-Bash-001-001.json", { hooks: {} });
    gistClient.seed(record);
    const targetFiles = createDummyAgentConfigFixture();
    const originalSettings = targetFiles["/repo/.claude/settings.json"];
    const target = createContext(targetFiles, gistClient);

    await expect(copyOrMoveItem(target.ctx, {
      operation: "copy",
      from: "gist",
      to: "project",
      profile: "default",
      agent: "claude-code",
      kind: "hook",
      name: "PreToolUse-Bash-001-001",
      yes: true
    })).rejects.toThrow("Hook fragment PreToolUse-Bash-001-001 must contain hook event PreToolUse-Bash-001-001.");

    expect(target.volume.readFileSync("/repo/.claude/settings.json", "utf8")).toBe(originalSettings);
    expect(() => target.volume.statSync("/home/user/.agent-stash/backups")).toThrow();
  });

  it("copies one Gist skill to project using an agent alias", async () => {
    const gistClient = new InMemoryGistClient();
    gistClient.seed({ id: "gist-default", htmlUrl: "https://gist.github.com/gist-default", files: {} });
    const source = createContext(createDummyAgentConfigFixture(), gistClient);
    await uploadBundle(source.ctx, {
      profile: "default",
      scope: "global",
      agent: "claude-code",
      skills: ["global-only"],
      yes: true
    });
    const targetFiles = createDummyAgentConfigFixture();
    delete targetFiles["/repo/.claude/skills/global-only/SKILL.md"];
    const target = createContext(targetFiles, gistClient);

    const result = await copyOrMoveItem(target.ctx, {
      operation: "copy",
      from: "gist",
      to: "project",
      profile: "default",
      agent: "claude",
      kind: "skill",
      name: "global-only",
      yes: true
    });

    expect(result.item.id).toBe("project:skill:claude-code:global-only");
    expect(target.volume.readFileSync("/repo/.claude/skills/global-only/SKILL.md", "utf8")).toBe("# Global Only\n");
  });

  it("rejects ambiguous Gist item names before writing local files", async () => {
    const gistClient = new InMemoryGistClient();
    gistClient.seed({ id: "gist-default", htmlUrl: "https://gist.github.com/gist-default", files: {} });
    const sourceFiles = createDummyAgentConfigFixture();
    sourceFiles["/home/user/.claude/skills/code-review/SKILL.md"] = "# Global Review\n";
    const source = createContext(sourceFiles, gistClient);
    await uploadBundle(source.ctx, {
      profile: "default",
      scope: "project",
      agent: "claude-code",
      skills: ["code-review"],
      yes: true
    });
    await uploadBundle(source.ctx, {
      profile: "default",
      scope: "global",
      agent: "claude-code",
      skills: ["code-review"],
      yes: true
    });
    const targetFiles = createDummyAgentConfigFixture();
    targetFiles["/repo/.claude/skills/code-review/SKILL.md"] = "# Existing Project\n";
    const target = createContext(targetFiles, gistClient);

    await expect(copyOrMoveItem(target.ctx, {
      operation: "copy",
      from: "gist",
      to: "project",
      profile: "default",
      agent: "claude-code",
      kind: "skill",
      name: "code-review",
      yes: true
    })).rejects.toThrow("Remote item name is ambiguous: code-review");

    expect(target.volume.readFileSync("/repo/.claude/skills/code-review/SKILL.md", "utf8")).toBe("# Existing Project\n");
    expect(() => target.volume.statSync("/home/user/.agent-stash/backups")).toThrow();
  });

  it("moves one Gist skill to project after local write succeeds", async () => {
    const gistClient = new InMemoryGistClient();
    gistClient.seed({ id: "gist-default", htmlUrl: "https://gist.github.com/gist-default", files: {} });
    const source = createContext(createDummyAgentConfigFixture(), gistClient);
    await uploadBundle(source.ctx, {
      profile: "default",
      scope: "global",
      agent: "claude-code",
      skills: ["global-only"],
      yes: true
    });
    const targetFiles = createDummyAgentConfigFixture();
    delete targetFiles["/repo/.claude/skills/global-only/SKILL.md"];
    const target = createContext(targetFiles, gistClient);

    await copyOrMoveItem(target.ctx, {
      operation: "move",
      from: "gist",
      to: "project",
      profile: "default",
      agent: "claude-code",
      kind: "skill",
      name: "global-only",
      yes: true
    });

    expect(target.volume.readFileSync("/repo/.claude/skills/global-only/SKILL.md", "utf8")).toBe("# Global Only\n");
    expect(gistClient.updateCalls.at(-1)?.input.files[gistFilenameForBundlePath("skills/global/claude-code/global-only/SKILL.md")]).toBeNull();
    const record = await gistClient.read("gist-default");
    const manifest = parseManifest(record.files["agent-stash.json"]!.content);
    expect(manifest.items.map((item) => item.id)).not.toContain("global:skill:claude-code:global-only");
  });

  it("moves one Gist skill to project without rereading the Gist after local writes", async () => {
    class CorruptSecondReadGistClient extends InMemoryGistClient {
      corruptAfterReadCount = 0;

      override async read(gistId: string) {
        if (this.readCalls.length >= this.corruptAfterReadCount) {
          this.readCalls.push(gistId);
          return { id: gistId, htmlUrl: `https://gist.github.com/${gistId}`, files: {} };
        }
        return super.read(gistId);
      }
    }
    const gistClient = new CorruptSecondReadGistClient();
    gistClient.seed({ id: "gist-default", htmlUrl: "https://gist.github.com/gist-default", files: {} });
    const source = createContext(createDummyAgentConfigFixture(), gistClient);
    await uploadBundle(source.ctx, {
      profile: "default",
      scope: "global",
      agent: "claude-code",
      skills: ["global-only"],
      yes: true
    });
    gistClient.readCalls.length = 0;
    gistClient.corruptAfterReadCount = 1;
    const targetFiles = createDummyAgentConfigFixture();
    delete targetFiles["/repo/.claude/skills/global-only/SKILL.md"];
    const target = createContext(targetFiles, gistClient);

    await copyOrMoveItem(target.ctx, {
      operation: "move",
      from: "gist",
      to: "project",
      profile: "default",
      agent: "claude-code",
      kind: "skill",
      name: "global-only",
      yes: true
    });

    expect(gistClient.readCalls).toEqual(["gist-default"]);
    expect(target.volume.readFileSync("/repo/.claude/skills/global-only/SKILL.md", "utf8")).toBe("# Global Only\n");
    expect(gistClient.updateCalls.at(-1)?.input.files[gistFilenameForBundlePath("skills/global/claude-code/global-only/SKILL.md")]).toBeNull();
  });

  it("moves one Gist hook to project without overwriting an existing matching local hook", async () => {
    const gistClient = new InMemoryGistClient();
    gistClient.seed({ id: "gist-default", htmlUrl: "https://gist.github.com/gist-default", files: {} });
    const sourceFiles = {
      ...createDummyAgentConfigFixture(),
      "/repo/.claude/settings.json": JSON.stringify({
        hooks: {
          PostToolUse: [
            {
              matcher: "Write|Edit",
              hooks: [{ type: "command", command: "remote hook" }]
            }
          ]
        }
      }, null, 2)
    };
    const source = createContext(sourceFiles, gistClient);
    await uploadBundle(source.ctx, {
      profile: "default",
      scope: "project",
      agent: "claude-code",
      hooks: ["PostToolUse"],
      yes: true
    });
    const targetFiles = {
      ...createDummyAgentConfigFixture(),
      "/repo/.claude/settings.json": JSON.stringify({
        hooks: {
          PostToolUse: [
            {
              matcher: "Write|Edit",
              hooks: [{ type: "command", command: "local sentinel" }]
            }
          ]
        }
      }, null, 2)
    };
    const target = createContext(targetFiles, gistClient);

    await copyOrMoveItem(target.ctx, {
      operation: "move",
      from: "gist",
      to: "project",
      profile: "default",
      agent: "claude-code",
      kind: "hook",
      name: "PostToolUse-Write-Edit-001-001",
      yes: true
    });

    const localHooks = await loadInventory(target.ctx, {
      scope: "project",
      agent: "claude-code",
      kind: "hook"
    });
    const settings = JSON.parse(target.volume.readFileSync("/repo/.claude/settings.json", "utf8") as string) as {
      hooks?: { PostToolUse?: Array<{ hooks?: Array<{ command?: string }> }> };
    };
    const record = await gistClient.read("gist-default");
    const manifest = parseManifest(record.files["agent-stash.json"]!.content);

    expect(localHooks.map((item) => item.name)).toEqual([
      "PostToolUse-Write-Edit-001-001",
      "PostToolUse-Write-Edit-001-002"
    ]);
    expect(settings.hooks?.PostToolUse?.[0]?.hooks?.map((hook) => hook.command)).toEqual([
      "remote hook",
      "local sentinel"
    ]);
    expect(manifest.items.map((item) => item.name)).not.toContain("PostToolUse-Write-Edit-001-001");
  });

  it("copies one project skill to an existing profile Gist", async () => {
    const gistClient = new InMemoryGistClient();
    gistClient.seed({ id: "gist-default", htmlUrl: "https://gist.github.com/gist-default", files: {} });
    const { ctx } = createContext(createDummyAgentConfigFixture(), gistClient);

    const result = await copyOrMoveItem(ctx, {
      operation: "copy",
      from: "project",
      to: "gist",
      profile: "default",
      agent: "claude-code",
      kind: "skill",
      name: "code-review",
      yes: true
    });

    expect(result.item.id).toBe("project:skill:claude-code:code-review");
    expect(gistClient.updateCalls.at(-1)?.input.files[gistFilenameForBundlePath("skills/project/claude-code/code-review/SKILL.md")]).toEqual({
      content: "# Code Review\n"
    });
    expect(gistClient.updateCalls.at(-1)?.input.files["agent-stash.json"]?.content).toContain("code-review");
  });

  it("removes pre-existing files when copying to a Gist without a manifest", async () => {
    const gistClient = new InMemoryGistClient();
    gistClient.seed({
      id: "gist-default",
      htmlUrl: "https://gist.github.com/gist-default",
      files: {
        "seed.txt": { filename: "seed.txt", content: "not an agent-stash bundle\n" }
      }
    });
    const { ctx } = createContext(createDummyAgentConfigFixture(), gistClient);

    await copyOrMoveItem(ctx, {
      operation: "copy",
      from: "project",
      to: "gist",
      profile: "default",
      agent: "claude-code",
      kind: "skill",
      name: "code-review",
      yes: true
    });

    const record = await gistClient.read("gist-default");
    const manifest = parseManifest(record.files["agent-stash.json"]!.content);
    expect(gistClient.updateCalls.at(-1)?.input.files["seed.txt"]).toBeNull();
    expect(record.files["seed.txt"]).toBeUndefined();
    expect(manifest.items.map((item) => item.name)).toEqual(["code-review"]);
  });

  it("moves one split hook to a Gist without renaming remaining local hooks", async () => {
    const gistClient = new InMemoryGistClient();
    gistClient.seed({ id: "gist-default", htmlUrl: "https://gist.github.com/gist-default", files: {} });
    const files = {
      ...createDummyAgentConfigFixture(),
      "/repo/.claude/settings.json": JSON.stringify({
        hooks: {
          PostToolUse: [
            {
              matcher: "Write|Edit",
              hooks: [
                { type: "command", command: "first local command" },
                { type: "command", command: "second local command" }
              ]
            }
          ]
        }
      }, null, 2)
    };
    const { ctx, volume } = createContext(files, gistClient);

    await copyOrMoveItem(ctx, {
      operation: "move",
      from: "project",
      to: "gist",
      profile: "default",
      agent: "claude-code",
      kind: "hook",
      name: "PostToolUse-Write-Edit-001-001",
      yes: true
    });

    const localHooks = await loadInventory(ctx, {
      scope: "project",
      agent: "claude-code",
      kind: "hook"
    });
    const record = await gistClient.read("gist-default");
    const manifest = parseManifest(record.files["agent-stash.json"]!.content);
    const settings = JSON.parse(volume.readFileSync("/repo/.claude/settings.json", "utf8") as string) as {
      hooks?: { PostToolUse?: Array<{ hooks?: Array<{ command?: string }> }> };
    };
    expect(localHooks.map((item) => item.name)).toEqual(["PostToolUse-Write-Edit-001-002"]);
    expect(manifest.items.map((item) => item.name)).toEqual(["PostToolUse-Write-Edit-001-001"]);
    expect(settings.hooks?.PostToolUse?.[0]?.hooks?.map((hook) => hook.command)).toEqual(["second local command"]);
  });
});

function updateRemoteHookFragment(
  record: Awaited<ReturnType<InMemoryGistClient["read"]>>,
  fragmentPath: string,
  fragmentValue: unknown
): void {
  const fragment = `${JSON.stringify(fragmentValue, null, 2)}\n`;
  const manifest = parseManifest(record.files["agent-stash.json"]!.content);
  const item = manifest.items.find((candidate) => candidate.files.some((file) => file.path === fragmentPath))!;
  item.files[0] = {
    ...item.files[0]!,
    size: Buffer.byteLength(fragment, "utf8"),
    sha256: sha256(fragment)
  };
  item.contentHash = hashFiles(item.files);
  record.files["agent-stash.json"] = {
    filename: "agent-stash.json",
    content: serializeManifest(manifest)
  };
  const gistFilename = gistFilenameForBundlePath(fragmentPath);
  record.files[gistFilename] = { filename: gistFilename, content: fragment };
}
