import { describe, expect, it, vi } from "vitest";
import { Volume, createFsFromVolume } from "memfs";
import { createArchiveEntryFilter, exportArchive, importArchive, validateArchiveEntry, validateArchiveEntryPath } from "./archive.js";
import { uploadBundle } from "./upload.js";
import { hashFiles, sha256 } from "../hash.js";
import { InMemoryArchiveCodec } from "../fixtures/in-memory-archive-codec.js";
import { InMemoryGistClient } from "../fixtures/in-memory-gist-client.js";
import { parseManifest, serializeManifest } from "../manifest.js";
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

function createContext(files = createDummyAgentConfigFixture(), archiveCodec = new InMemoryArchiveCodec()): {
  ctx: AgentStashContext;
  archiveCodec: InMemoryArchiveCodec;
  volume: Volume;
} {
  const volume = Volume.fromJSON(files, "/");
  return {
    archiveCodec,
    volume,
    ctx: {
      cwd: dummyCwd,
      homeDir: dummyHome,
      fs: createFsFromVolume(volume).promises as unknown as AgentStashFileSystem,
      archiveCodec,
      now: () => fixedDate
    }
  };
}

describe("archive operations", () => {
  it("accepts tar directory entries while rejecting traversal entries", () => {
    expect(() => validateArchiveEntryPath("hooks/")).not.toThrow();
    expect(() => validateArchiveEntryPath("./skills/project/claude-code/code-review/")).not.toThrow();
    expect(() => validateArchiveEntryPath("../escape")).toThrow(/traversal/);
  });

  it("rejects tar link entries before extraction", () => {
    expect(() => validateArchiveEntry("skills/project/claude-code/code-review/SKILL.md", { type: "File" })).not.toThrow();
    expect(() => validateArchiveEntry("skills/project/claude-code/code-review", { type: "Directory" })).not.toThrow();
    expect(() => validateArchiveEntry("skills/link", { type: "SymbolicLink" })).toThrow(
      "Archive contains unsupported entry type SymbolicLink: skills/link"
    );
    expect(() => validateArchiveEntry("skills/link", { type: "Link" })).toThrow(
      "Archive contains unsupported entry type Link: skills/link"
    );
  });

  it("captures tar filter validation errors without throwing from the filter callback", () => {
    const entryFilter = createArchiveEntryFilter();

    expect(entryFilter.filter("skills/link", { type: "SymbolicLink" })).toBe(false);
    expect(() => entryFilter.assertValid()).toThrow(
      "Archive contains unsupported entry type SymbolicLink: skills/link"
    );
  });

  it("rejects invalid archive scopes before doing work", async () => {
    const { ctx, archiveCodec } = createContext();

    await expect(exportArchive(ctx, {
      outputPath: "/archives/project.tar.gz",
      scope: "workspace" as "project",
      agent: "claude-code"
    })).rejects.toThrow("Invalid scope: workspace. Expected project or global.");
    await expect(importArchive(ctx, {
      inputPath: "/archives/project.tar.gz",
      scope: "workspace" as "project",
      agent: "claude-code",
      yes: true
    })).rejects.toThrow("Invalid scope: workspace. Expected project or global.");
    expect(archiveCodec.archives.has("/archives/project.tar.gz")).toBe(false);
  });

  it("rejects invalid import agents before reading an archive", async () => {
    const archiveCodec = new InMemoryArchiveCodec();
    let readCount = 0;
    archiveCodec.read = async (inputPath) => {
      readCount += 1;
      throw new Error(`Unexpected archive read: ${inputPath}`);
    };
    const { ctx } = createContext(createDummyAgentConfigFixture(), archiveCodec);

    await expect(importArchive(ctx, {
      inputPath: "/archives/project.tar.gz",
      scope: "project",
      agent: "not-an-agent",
      yes: true
    })).rejects.toThrow("Unknown agent: not-an-agent");

    expect(readCount).toBe(0);
  });

  it("rejects invalid remote export agents before reading a Gist", async () => {
    const archiveCodec = new InMemoryArchiveCodec();
    const gistClient = new InMemoryGistClient();
    gistClient.seed({ id: "gist-default", htmlUrl: "https://gist.github.com/gist-default", files: {} });
    const { ctx, archiveCodec: targetArchiveCodec } = createContext(createDummyAgentConfigFixture(), archiveCodec);
    ctx.gistClient = gistClient;

    await expect(exportArchive(ctx, {
      outputPath: "/archives/remote.tar.gz",
      profile: "default",
      agent: "not-an-agent"
    })).rejects.toThrow("Unknown agent: not-an-agent");

    expect(gistClient.readCalls).toHaveLength(0);
    expect(targetArchiveCodec.archives.has("/archives/remote.tar.gz")).toBe(false);
  });

  it("rejects missing remote export targets before creating a default Gist client", async () => {
    const { ctx, archiveCodec } = createContext();

    await expect(exportArchive(ctx, {
      outputPath: "/archives/remote.tar.gz"
    })).rejects.toThrow("Export requires --scope and --agent for local archives, or a profile/--gist for remote archives.");

    expect(archiveCodec.archives.has("/archives/remote.tar.gz")).toBe(false);
  });

  it("rejects invalid local export profiles before writing an archive", async () => {
    const { ctx, archiveCodec } = createContext();

    await expect(exportArchive(ctx, {
      outputPath: "/archives/project.tar.gz",
      profile: "../escape",
      scope: "project",
      agent: "claude-code"
    })).rejects.toThrow("Invalid profile name: ../escape");

    expect(archiveCodec.archives.has("/archives/project.tar.gz")).toBe(false);
  });

  it("exports local project items without GitHub access", async () => {
    const { ctx, archiveCodec } = createContext();

    const result = await exportArchive(ctx, {
      outputPath: "/archives/project.tar.gz",
      profile: "snapshot",
      scope: "project",
      agent: "claude-code"
    });

    const archive = archiveCodec.archives.get("/archives/project.tar.gz");
    expect(result.exported.map((item) => item.id)).toEqual([
      "project:hook:claude-code:PreToolUse-Bash-001-001",
      "project:hook:claude-code:Stop-all-tools-001-001",
      "project:skill:claude-code:code-review",
      "project:skill:claude-code:commit-helper",
      "project:skill:claude-code:project-only"
    ]);
    expect(archive?.["agent-stash.json"]).toContain('"profile": "snapshot"');
    expect(archive?.["skills/project/claude-code/code-review/SKILL.md"]).toBe("# Code Review\n");
  });

  it("imports archive items and creates a backup before overwriting", async () => {
    const archiveCodec = new InMemoryArchiveCodec();
    const source = createContext(createDummyAgentConfigFixture(), archiveCodec);
    await exportArchive(source.ctx, {
      outputPath: "/archives/project.tar.gz",
      scope: "project",
      agent: "claude-code"
    });
    const targetFiles = createDummyAgentConfigFixture();
    targetFiles["/repo/.claude/skills/code-review/SKILL.md"] = "# Existing\n";
    const target = createContext(targetFiles, archiveCodec);

    const result = await importArchive(target.ctx, {
      inputPath: "/archives/project.tar.gz",
      scope: "project",
      agent: "claude-code",
      yes: true
    });

    expect(result.imported.map((item) => item.id)).toContain("project:skill:claude-code:code-review");
    expect(result.backupId).toMatch(/^backup-/);
    expect(target.volume.readFileSync("/repo/.claude/skills/code-review/SKILL.md", "utf8")).toBe("# Code Review\n");
    expect(
      target.volume.readFileSync(`/home/user/.agent-stash/backups/${result.backupId}/files/repo/.claude/skills/code-review/SKILL.md`, "utf8")
    ).toBe("# Existing\n");
  });

  it("skips imported archive skills that are ignored locally before creating a backup", async () => {
    const archiveCodec = new InMemoryArchiveCodec();
    const source = createContext(createDummyAgentConfigFixture(), archiveCodec);
    await exportArchive(source.ctx, {
      outputPath: "/archives/project.tar.gz",
      scope: "project",
      agent: "claude-code"
    });
    const archive = archiveCodec.archives.get("/archives/project.tar.gz")!;
    const manifest = parseManifest(archive["agent-stash.json"]!);
    manifest.items = manifest.items.filter((item) => item.id === "project:skill:claude-code:code-review");
    archiveCodec.archives.set("/archives/project.tar.gz", {
      "agent-stash.json": serializeManifest(manifest),
      "skills/project/claude-code/code-review/SKILL.md": archive["skills/project/claude-code/code-review/SKILL.md"]!
    });
    const targetFiles = createDummyAgentConfigFixture();
    targetFiles["/repo/.agent-stashignore"] = ".claude/skills/code-review/**\n";
    delete targetFiles["/repo/.claude/skills/code-review/SKILL.md"];
    const target = createContext(targetFiles, archiveCodec);

    const result = await importArchive(target.ctx, {
      inputPath: "/archives/project.tar.gz",
      scope: "project",
      agent: "claude-code",
      yes: true
    });

    expect(result.imported).toEqual([]);
    expect(result.backupId).toBeUndefined();
    expect(() => target.volume.statSync("/repo/.claude/skills/code-review/SKILL.md")).toThrow();
    expect(() => target.volume.statSync("/home/user/.agent-stash/backups")).toThrow();
  });

  it("imports archive items using an agent alias", async () => {
    const archiveCodec = new InMemoryArchiveCodec();
    const source = createContext(createDummyAgentConfigFixture(), archiveCodec);
    await exportArchive(source.ctx, {
      outputPath: "/archives/project.tar.gz",
      scope: "project",
      agent: "claude-code"
    });
    const targetFiles = createDummyAgentConfigFixture();
    delete targetFiles["/repo/.claude/skills/code-review/SKILL.md"];
    const target = createContext(targetFiles, archiveCodec);

    const result = await importArchive(target.ctx, {
      inputPath: "/archives/project.tar.gz",
      scope: "project",
      agent: "claude",
      yes: true
    });

    expect(result.imported.map((item) => item.id)).toContain("project:skill:claude-code:code-review");
    expect(target.volume.readFileSync("/repo/.claude/skills/code-review/SKILL.md", "utf8")).toBe("# Code Review\n");
  });

  it("validates every selected archive item before writing any local item", async () => {
    const archiveCodec = new InMemoryArchiveCodec();
    const source = createContext(createDummyAgentConfigFixture(), archiveCodec);
    await exportArchive(source.ctx, {
      outputPath: "/archives/project.tar.gz",
      scope: "project",
      agent: "claude-code"
    });
    const archive = archiveCodec.archives.get("/archives/project.tar.gz")!;
    const manifest = parseManifest(archive["agent-stash.json"]!);
    const skill = manifest.items.find((item) => item.name === "code-review")!;
    const hook = manifest.items.find((item) => item.name === "PreToolUse-Bash-001-001")!;
    const skillContent = "# Imported Review\n";
    const hookContent = `${JSON.stringify({ hooks: {} }, null, 2)}\n`;
    skill.files[0] = {
      ...skill.files[0]!,
      size: Buffer.byteLength(skillContent, "utf8"),
      sha256: sha256(skillContent)
    };
    skill.contentHash = hashFiles(skill.files);
    hook.files[0] = {
      ...hook.files[0]!,
      size: Buffer.byteLength(hookContent, "utf8"),
      sha256: sha256(hookContent)
    };
    hook.contentHash = hashFiles(hook.files);
    manifest.items = [skill, hook];
    const trackedPaths = new Set([skill.files[0]!.path, hook.files[0]!.path, "agent-stash.json"]);
    for (const filePath of Object.keys(archive)) {
      if (!trackedPaths.has(filePath)) {
        delete archive[filePath];
      }
    }
    archive["agent-stash.json"] = serializeManifest(manifest);
    archive["skills/project/claude-code/code-review/SKILL.md"] = skillContent;
    archive["hooks/project/claude-code/PreToolUse-Bash-001-001.json"] = hookContent;
    const targetFiles = createDummyAgentConfigFixture();
    targetFiles["/repo/.claude/skills/code-review/SKILL.md"] = "# Existing Review\n";
    const target = createContext(targetFiles, archiveCodec);

    await expect(importArchive(target.ctx, {
      inputPath: "/archives/project.tar.gz",
      scope: "project",
      agent: "claude-code",
      yes: true
    })).rejects.toThrow("Hook fragment PreToolUse-Bash-001-001 must contain hook event PreToolUse-Bash-001-001.");
    expect(target.volume.readFileSync("/repo/.claude/skills/code-review/SKILL.md", "utf8")).toBe("# Existing Review\n");
  });

  it("rejects malformed existing hook settings before creating an import backup", async () => {
    const archiveCodec = new InMemoryArchiveCodec();
    const source = createContext(createDummyAgentConfigFixture(), archiveCodec);
    await exportArchive(source.ctx, {
      outputPath: "/archives/project.tar.gz",
      scope: "project",
      agent: "claude-code"
    });
    const targetFiles = createDummyAgentConfigFixture();
    targetFiles["/repo/.claude/skills/code-review/SKILL.md"] = "# Existing Review\n";
    targetFiles["/repo/.claude/settings.json"] = "{";
    const target = createContext(targetFiles, archiveCodec);

    await expect(importArchive(target.ctx, {
      inputPath: "/archives/project.tar.gz",
      scope: "project",
      agent: "claude-code",
      yes: true
    })).rejects.toThrow("Malformed hooks in /repo/.claude/settings.json");

    expect(target.volume.readFileSync("/repo/.claude/skills/code-review/SKILL.md", "utf8")).toBe("# Existing Review\n");
    expect(target.volume.readFileSync("/repo/.claude/settings.json", "utf8")).toBe("{");
    expect(() => target.volume.statSync("/home/user/.agent-stash/backups")).toThrow();
  });

  it("rejects malformed archive manifests before creating an import backup", async () => {
    const archiveCodec = new InMemoryArchiveCodec();
    archiveCodec.archives.set("/archives/bad.tar.gz", {
      "agent-stash.json": "{"
    });
    const targetFiles = createDummyAgentConfigFixture();
    targetFiles["/repo/.claude/skills/code-review/SKILL.md"] = "# Existing Review\n";
    const target = createContext(targetFiles, archiveCodec);

    await expect(importArchive(target.ctx, {
      inputPath: "/archives/bad.tar.gz",
      scope: "project",
      agent: "claude-code",
      yes: true
    })).rejects.toThrow("Malformed agent-stash manifest.");

    expect(target.volume.readFileSync("/repo/.claude/skills/code-review/SKILL.md", "utf8")).toBe("# Existing Review\n");
    expect(() => target.volume.statSync("/home/user/.agent-stash/backups")).toThrow();
  });

  it("exports remote profile items using an agent alias", async () => {
    const archiveCodec = new InMemoryArchiveCodec();
    const gistClient = new InMemoryGistClient();
    gistClient.seed({ id: "gist-default", htmlUrl: "https://gist.github.com/gist-default", files: {} });
    const source = createContext(createDummyAgentConfigFixture(), archiveCodec);
    source.ctx.gistClient = gistClient;
    await uploadBundle(source.ctx, {
      profile: "default",
      scope: "project",
      agent: "claude-code",
      skills: ["code-review"],
      yes: true
    });

    const result = await exportArchive(source.ctx, {
      outputPath: "/archives/remote.tar.gz",
      profile: "default",
      agent: "claude"
    });

    expect(result.exported.map((item) => item.id)).toEqual(["project:skill:claude-code:code-review"]);
    expect(archiveCodec.archives.get("/archives/remote.tar.gz")?.["skills/project/claude-code/code-review/SKILL.md"]).toBe(
      "# Code Review\n"
    );
  });

  it("exports profile Gist archives with scope and agent filters instead of local inventory", async () => {
    const archiveCodec = new InMemoryArchiveCodec();
    const gistClient = new InMemoryGistClient();
    gistClient.seed({ id: "gist-default", htmlUrl: "https://gist.github.com/gist-default", files: {} });
    const source = createContext(createDummyAgentConfigFixture(), archiveCodec);
    source.ctx.gistClient = gistClient;
    await uploadBundle(source.ctx, {
      profile: "default",
      scope: "project",
      agent: "claude-code",
      skills: ["code-review"],
      yes: true
    });
    const target = createContext({}, archiveCodec);
    target.ctx.gistClient = gistClient;
    target.volume.mkdirSync("/home/user/.agent-stash", { recursive: true });
    target.volume.writeFileSync(
      "/home/user/.agent-stash/config.json",
      JSON.stringify({ profiles: { default: { gistId: "gist-default" } } }, null, 2)
    );

    const result = await exportArchive(target.ctx, {
      outputPath: "/archives/profile-gist.tar.gz",
      profile: "default",
      scope: "project",
      agent: "claude-code"
    });

    expect(result.exported.map((item) => item.id)).toEqual(["project:skill:claude-code:code-review"]);
    expect(archiveCodec.archives.get("/archives/profile-gist.tar.gz")?.["skills/project/claude-code/code-review/SKILL.md"]).toBe(
      "# Code Review\n"
    );
  });

  it("exports explicit Gist archives with scope and agent filters instead of local inventory", async () => {
    const archiveCodec = new InMemoryArchiveCodec();
    const gistClient = new InMemoryGistClient();
    gistClient.seed({ id: "gist-default", htmlUrl: "https://gist.github.com/gist-default", files: {} });
    const source = createContext(createDummyAgentConfigFixture(), archiveCodec);
    source.ctx.gistClient = gistClient;
    await uploadBundle(source.ctx, {
      profile: "default",
      scope: "project",
      agent: "claude-code",
      skills: ["code-review"],
      yes: true
    });
    const targetFiles = createDummyAgentConfigFixture();
    targetFiles["/repo/.claude/skills/code-review/SKILL.md"] = "# Local Different\n";
    const target = createContext(targetFiles, archiveCodec);
    target.ctx.gistClient = gistClient;

    const result = await exportArchive(target.ctx, {
      outputPath: "/archives/explicit-gist.tar.gz",
      gist: "gist-default",
      scope: "project",
      agent: "claude-code"
    });

    expect(result.exported.map((item) => item.id)).toEqual(["project:skill:claude-code:code-review"]);
    expect(gistClient.readCalls).toContain("gist-default");
    expect(archiveCodec.archives.get("/archives/explicit-gist.tar.gz")?.["skills/project/claude-code/code-review/SKILL.md"]).toBe(
      "# Code Review\n"
    );
  });

  it("rejects path traversal before importing any item", async () => {
    const archiveCodec = new InMemoryArchiveCodec();
    archiveCodec.archives.set("/archives/bad.tar.gz", {
      "agent-stash.json": JSON.stringify({
        schemaVersion: 1,
        createdAt: fixedDate.toISOString(),
        updatedAt: fixedDate.toISOString(),
        items: []
      }),
      "../escape": "bad"
    });
    const { ctx, volume } = createContext(createDummyAgentConfigFixture(), archiveCodec);

    await expect(
      importArchive(ctx, {
        inputPath: "/archives/bad.tar.gz",
        scope: "project",
        agent: "claude-code",
        yes: true
      })
    ).rejects.toThrow(/traversal/);
    expect(volume.readFileSync("/repo/.claude/skills/code-review/SKILL.md", "utf8")).toBe("# Code Review\n");
  });

  it("rejects untracked archive files before importing any item", async () => {
    const archiveCodec = new InMemoryArchiveCodec();
    const source = createContext(createDummyAgentConfigFixture(), archiveCodec);
    await exportArchive(source.ctx, {
      outputPath: "/archives/project.tar.gz",
      scope: "project",
      agent: "claude-code"
    });
    const archive = archiveCodec.archives.get("/archives/project.tar.gz")!;
    archive["skills/project/claude-code/code-review/extra.md"] = "extra\n";
    const targetFiles = createDummyAgentConfigFixture();
    targetFiles["/repo/.claude/skills/code-review/SKILL.md"] = "# Existing Review\n";
    const target = createContext(targetFiles, archiveCodec);

    await expect(importArchive(target.ctx, {
      inputPath: "/archives/project.tar.gz",
      scope: "project",
      agent: "claude-code",
      yes: true
    })).rejects.toThrow("Archive contains untracked file skills/project/claude-code/code-review/extra.md");
    expect(target.volume.readFileSync("/repo/.claude/skills/code-review/SKILL.md", "utf8")).toBe("# Existing Review\n");
    expect(() => target.volume.statSync("/home/user/.agent-stash/backups")).toThrow();
  });
});
