import { describe, expect, it, vi } from "vitest";
import { Volume, createFsFromVolume } from "memfs";
import { gistFilenameForBundlePath } from "../bundle.js";
import { uploadBundle } from "./upload.js";
import { downloadBundle } from "./download.js";
import { syncBundle } from "./sync.js";
import { parseManifest, serializeManifest } from "../manifest.js";
import { hashFiles, sha256 } from "../hash.js";
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

function createContext(files = createDummyAgentConfigFixture(), gistClient = new InMemoryGistClient()): {
  ctx: AgentStashContext;
  volume: Volume;
  gistClient: InMemoryGistClient;
} {
  const volume = Volume.fromJSON(files, "/");
  if (!gistClient.records.has("gist-default")) {
    gistClient.seed({ id: "gist-default", htmlUrl: "https://gist.github.com/gist-default", files: {} });
  }
  return {
    volume,
    gistClient,
    ctx: {
      cwd: dummyCwd,
      homeDir: dummyHome,
      fs: createFsFromVolume(volume).promises as unknown as AgentStashFileSystem,
      gistClient,
      now: () => fixedDate
    }
  };
}

describe("sync", () => {
  it("rejects invalid sync scope and conflict policy before doing work", async () => {
    const { ctx, gistClient } = createContext();

    await expect(syncBundle(ctx, {
      profile: "default",
      scope: "workspace" as "project",
      agent: "claude-code",
      onConflict: "fail",
      yes: true
    })).rejects.toThrow("Invalid scope: workspace. Expected project or global.");
    await expect(syncBundle(ctx, {
      profile: "default",
      scope: "project",
      agent: "claude-code",
      onConflict: "merge" as "fail",
      yes: true
    })).rejects.toThrow("Invalid conflict policy: merge. Expected ask, local, remote, newer, or fail.");
    expect(gistClient.readCalls).toHaveLength(0);
    expect(gistClient.updateCalls).toHaveLength(0);
  });

  it("rejects invalid sync agents before reading a Gist", async () => {
    const { ctx, gistClient } = createContext();

    await expect(syncBundle(ctx, {
      profile: "default",
      scope: "project",
      agent: "missing-agent",
      onConflict: "fail",
      yes: true
    })).rejects.toThrow("Unknown agent: missing-agent");
    expect(gistClient.readCalls).toHaveLength(0);
    expect(gistClient.updateCalls).toHaveLength(0);
  });

  it("rejects missing sync Gist targets before creating a default Gist client", async () => {
    const { ctx } = createContext();
    ctx.gistClient = undefined;

    await expect(syncBundle(ctx, {
      scope: "project",
      agent: "claude-code",
      onConflict: "fail",
      yes: true
    })).rejects.toThrow("A profile with a Gist or --gist is required.");
  });

  it("uploads local-only items", async () => {
    const { ctx, gistClient } = createContext();
    const upload = await uploadBundle(ctx, {
      profile: "default",
      scope: "project",
      agent: "claude-code",
      skills: ["code-review"],
      yes: true
    });
    await ctx.fs.mkdir("/home/user/.agent-stash/cache", { recursive: true });
    await ctx.fs.writeFile("/home/user/.agent-stash/cache/default.manifest.json", `${JSON.stringify(upload.manifest, null, 2)}\n`, {
      encoding: "utf8"
    });

    const result = await syncBundle(ctx, {
      profile: "default",
      scope: "project",
      agent: "claude-code",
      onConflict: "fail",
      yes: true
    });

    expect(result.uploaded.map((item) => item.name)).toEqual(["PreToolUse-Bash-001-001", "Stop-all-tools-001-001", "commit-helper", "project-only"]);
    expect(gistClient.updateCalls.at(-1)?.input.files[gistFilenameForBundlePath("skills/project/claude-code/project-only/SKILL.md")]).toBeDefined();
  });

  it("replaces existing non-agent-stash Gist files during sync", async () => {
    const gistClient = new InMemoryGistClient();
    gistClient.seed({
      id: "gist-default",
      htmlUrl: "https://gist.github.com/gist-default",
      files: {
        "seed.txt": { filename: "seed.txt", content: "not an agent-stash bundle\n" }
      }
    });
    const { ctx } = createContext(createDummyAgentConfigFixture(), gistClient);

    const result = await syncBundle(ctx, {
      profile: "default",
      scope: "global",
      agent: "claude-code",
      hooks: ["Stop"],
      onConflict: "fail",
      yes: true
    });

    const record = await gistClient.read("gist-default");
    const manifest = parseManifest(record.files["agent-stash.json"]!.content);
    expect(result.uploaded.map((item) => item.name)).toEqual(["Stop-all-tools-001-001"]);
    expect(manifest.items.map((item) => item.name)).toEqual(["Stop-all-tools-001-001"]);
    expect(record.files["seed.txt"]).toBeUndefined();
    expect(gistClient.updateCalls.at(-1)?.input.files["seed.txt"]).toBeNull();
  });

  it("replaces legacy event-level remote hooks with split hook items during sync", async () => {
    const gistClient = new InMemoryGistClient();
    const legacyContent = `${JSON.stringify({
      hooks: {
        PostToolUse: [{ matcher: "Write|Edit", hooks: [{ type: "command", command: "legacy chunk" }] }]
      }
    }, null, 2)}\n`;
    const legacyFile = {
      path: "hooks/project/claude-code/PostToolUse.json",
      size: Buffer.byteLength(legacyContent, "utf8"),
      sha256: sha256(legacyContent)
    };
    const legacyItem = {
      id: "project:hook:claude-code:PostToolUse",
      kind: "hook" as const,
      agentId: "claude-code",
      name: "PostToolUse",
      scope: "project" as const,
      path: legacyFile.path,
      files: [legacyFile],
      updatedAt: fixedDate.toISOString(),
      contentHash: hashFiles([legacyFile])
    };
    gistClient.seed({
      id: "gist-default",
      htmlUrl: "https://gist.github.com/gist-default",
      files: {
        "agent-stash.json": {
          filename: "agent-stash.json",
          content: serializeManifest({
            schemaVersion: 1,
            profile: "default",
            createdAt: fixedDate.toISOString(),
            updatedAt: fixedDate.toISOString(),
            items: [legacyItem]
          })
        },
        [gistFilenameForBundlePath(legacyFile.path)]: {
          filename: gistFilenameForBundlePath(legacyFile.path),
          content: legacyContent
        }
      }
    });
    const files = {
      ...createDummyAgentConfigFixture(),
      "/repo/.claude/settings.json": JSON.stringify({
        hooks: {
          PostToolUse: [
            { matcher: "Write|Edit", hooks: [{ type: "command", command: "split replacement" }] }
          ]
        }
      }, null, 2)
    };
    const { ctx } = createContext(files, gistClient);
    const traces: Array<{ event: string; [key: string]: unknown }> = [];
    ctx.trace = async (record) => {
      traces.push(record);
    };

    const result = await syncBundle(ctx, {
      profile: "default",
      scope: "project",
      agent: "claude-code",
      hooks: ["PostToolUse"],
      onConflict: "local",
      yes: true
    });

    const record = await gistClient.read("gist-default");
    const manifest = parseManifest(record.files["agent-stash.json"]!.content);
    expect(result.uploaded.map((item) => item.id)).toEqual(["project:hook:claude-code:PostToolUse-Write-Edit-001-001"]);
    expect(result.downloaded).toEqual([]);
    expect(manifest.items.map((item) => item.id)).toEqual(["project:hook:claude-code:PostToolUse-Write-Edit-001-001"]);
    expect(record.files[gistFilenameForBundlePath("hooks/project/claude-code/PostToolUse.json")]).toBeUndefined();
    expect(traces.find((record) => record.event === "sync.legacyHookChunksRemoved")?.items).toEqual([
      {
        id: "project:hook:claude-code:PostToolUse",
        kind: "hook",
        scope: "project",
        agentId: "claude-code",
        name: "PostToolUse"
      }
    ]);
  });

  it("rejects selected sync items that are absent locally and remotely", async () => {
    const { ctx, gistClient } = createContext();
    await uploadBundle(ctx, {
      profile: "default",
      scope: "project",
      agent: "claude-code",
      skills: ["code-review"],
      yes: true
    });

    await expect(syncBundle(ctx, {
      profile: "default",
      scope: "project",
      agent: "claude-code",
      skills: ["missing-skill"],
      onConflict: "fail",
      yes: true
    })).rejects.toThrow("Selected skill not found: missing-skill");
    expect(gistClient.updateCalls).toHaveLength(1);
  });

  it("rejects selected remote sync items that are ignored locally before writing", async () => {
    const gistClient = new InMemoryGistClient();
    const source = createContext(createDummyAgentConfigFixture(), gistClient);
    await uploadBundle(source.ctx, {
      profile: "default",
      scope: "project",
      agent: "claude-code",
      skills: ["code-review"],
      yes: true
    });
    const files = createDummyAgentConfigFixture();
    files["/repo/.agent-stashignore"] = ".claude/skills/code-review/**\n";
    delete files["/repo/.claude/skills/code-review/SKILL.md"];
    const target = createContext(files, gistClient);

    await expect(syncBundle(target.ctx, {
      profile: "default",
      scope: "project",
      agent: "claude-code",
      skills: ["code-review"],
      onConflict: "remote",
      yes: true
    })).rejects.toThrow("Selected skill not found: code-review");

    expect(() => target.volume.statSync("/repo/.claude/skills/code-review/SKILL.md")).toThrow();
  });

  it("rejects malformed baseline manifests before sync writes", async () => {
    const gistClient = new InMemoryGistClient();
    const source = createContext(createDummyAgentConfigFixture(), gistClient);
    await uploadBundle(source.ctx, {
      profile: "default",
      scope: "project",
      agent: "claude-code",
      skills: ["code-review"],
      yes: true
    });
    const files = createDummyAgentConfigFixture();
    files["/home/user/.agent-stash/cache/default.manifest.json"] = "{";
    files["/repo/.claude/skills/code-review/SKILL.md"] = "# Local Change\n";
    const target = createContext(files, gistClient);

    await expect(syncBundle(target.ctx, {
      profile: "default",
      scope: "project",
      agent: "claude-code",
      onConflict: "local",
      yes: true
    })).rejects.toThrow("Malformed baseline manifest for profile default.");

    expect(target.volume.readFileSync("/repo/.claude/skills/code-review/SKILL.md", "utf8")).toBe("# Local Change\n");
    expect(gistClient.updateCalls).toHaveLength(1);
    expect(() => target.volume.statSync("/home/user/.agent-stash/backups")).toThrow();
  });

  it("rejects malformed remote manifests before sync writes", async () => {
    const gistClient = new InMemoryGistClient();
    gistClient.seed({
      id: "gist-default",
      htmlUrl: "https://gist.github.com/gist-default",
      files: {
        "agent-stash.json": {
          filename: "agent-stash.json",
          content: "{"
        }
      }
    });
    const files = createDummyAgentConfigFixture();
    files["/repo/.claude/skills/code-review/SKILL.md"] = "# Local Change\n";
    const target = createContext(files, gistClient);

    await expect(syncBundle(target.ctx, {
      profile: "default",
      scope: "project",
      agent: "claude-code",
      onConflict: "local",
      yes: true
    })).rejects.toThrow("Malformed agent-stash manifest.");

    expect(target.volume.readFileSync("/repo/.claude/skills/code-review/SKILL.md", "utf8")).toBe("# Local Change\n");
    expect(gistClient.updateCalls).toHaveLength(0);
    expect(() => target.volume.statSync("/home/user/.agent-stash/backups")).toThrow();
  });

  it("removes stale remote files when uploading a changed existing item", async () => {
    const files = createDummyAgentConfigFixture();
    files["/repo/.claude/skills/code-review/OLD.md"] = "old remote file\n";
    const { ctx, gistClient } = createContext(files);
    const upload = await uploadBundle(ctx, {
      profile: "default",
      scope: "project",
      agent: "claude-code",
      skills: ["code-review"],
      yes: true
    });
    await ctx.fs.mkdir("/home/user/.agent-stash/cache", { recursive: true });
    await ctx.fs.writeFile("/home/user/.agent-stash/cache/default.manifest.json", serializeManifest(upload.manifest), {
      encoding: "utf8"
    });
    await ctx.fs.rm?.("/repo/.claude/skills/code-review/OLD.md", { force: true });
    await ctx.fs.writeFile("/repo/.claude/skills/code-review/SKILL.md", "# Updated Local\n", {
      encoding: "utf8"
    });

    await syncBundle(ctx, {
      profile: "default",
      scope: "project",
      agent: "claude-code",
      skills: ["code-review"],
      onConflict: "local",
      yes: true
    });

    const stalePath = gistFilenameForBundlePath("skills/project/claude-code/code-review/OLD.md");
    expect(gistClient.updateCalls.at(-1)?.input.files[stalePath]).toBeNull();
    expect((await gistClient.read("gist-default")).files[stalePath]).toBeUndefined();
  });

  it("preserves remote manifest metadata when syncing local-only items through an explicit Gist", async () => {
    const { ctx, gistClient } = createContext();
    const upload = await uploadBundle(ctx, {
      profile: "default",
      scope: "project",
      agent: "claude-code",
      skills: ["code-review"],
      yes: true
    });
    ctx.now = () => new Date("2026-01-02T03:05:00.000Z");

    await syncBundle(ctx, {
      gist: "gist-default",
      scope: "project",
      agent: "claude-code",
      skills: ["project-only"],
      onConflict: "local",
      yes: true
    });

    const record = await gistClient.read("gist-default");
    const manifest = parseManifest(record.files["agent-stash.json"]!.content);
    expect(manifest.profile).toBe("default");
    expect(manifest.createdAt).toBe(upload.manifest.createdAt);
    expect(manifest.updatedAt).toBe("2026-01-02T03:05:00.000Z");
    expect(manifest.items.map((item) => item.name)).toEqual(["code-review", "project-only"]);
  });

  it("does not write profile baselines when syncing through an explicit Gist override", async () => {
    const gistClient = new InMemoryGistClient();
    gistClient.seed({ id: "gist-default", htmlUrl: "https://gist.github.com/gist-default", files: {} });
    gistClient.seed({ id: "gist-other", htmlUrl: "https://gist.github.com/gist-other", files: {} });
    const source = createContext(createDummyAgentConfigFixture(), gistClient);
    const upload = await uploadBundle(source.ctx, {
      profile: "default",
      scope: "project",
      agent: "claude-code",
      skills: ["code-review"],
      yes: true
    });
    await uploadBundle(source.ctx, {
      gist: "gist-other",
      scope: "project",
      agent: "claude-code",
      skills: ["project-only"],
      yes: true
    });
    const files = createDummyAgentConfigFixture();
    files["/home/user/.agent-stash/cache/default.manifest.json"] = serializeManifest(upload.manifest);
    const target = createContext(files, gistClient);

    await syncBundle(target.ctx, {
      profile: "default",
      gist: "gist-other",
      scope: "project",
      agent: "claude-code",
      skills: ["project-only"],
      onConflict: "remote",
      yes: true
    });

    const baseline = parseManifest(target.volume.readFileSync("/home/user/.agent-stash/cache/default.manifest.json", "utf8") as string);
    expect(baseline.items.map((item) => item.name)).toEqual(["code-review"]);
  });

  it("does not refresh unselected profile baselines during filtered sync", async () => {
    const gistClient = new InMemoryGistClient();
    const source = createContext(createDummyAgentConfigFixture(), gistClient);
    const upload = await uploadBundle(source.ctx, {
      profile: "default",
      scope: "project",
      agent: "claude-code",
      skills: ["code-review"],
      yes: true
    });
    const originalCodeReview = upload.manifest.items.find((item) => item.name === "code-review")!;
    const record = await gistClient.read("gist-default");
    const remoteManifest = parseManifest(record.files["agent-stash.json"]!.content);
    const remoteCodeReview = remoteManifest.items.find((item) => item.name === "code-review")!;
    const remoteContent = "# Remote Change\n";
    remoteCodeReview.files[0] = {
      ...remoteCodeReview.files[0]!,
      size: Buffer.byteLength(remoteContent, "utf8"),
      sha256: sha256(remoteContent)
    };
    remoteCodeReview.contentHash = hashFiles(remoteCodeReview.files);
    record.files["agent-stash.json"] = {
      filename: "agent-stash.json",
      content: serializeManifest(remoteManifest)
    };
    const remotePath = gistFilenameForBundlePath("skills/project/claude-code/code-review/SKILL.md");
    record.files[remotePath] = {
      filename: remotePath,
      content: remoteContent
    };
    gistClient.seed(record);
    const files = createDummyAgentConfigFixture();
    files["/home/user/.agent-stash/cache/default.manifest.json"] = serializeManifest(upload.manifest);
    const target = createContext(files, gistClient);

    await syncBundle(target.ctx, {
      profile: "default",
      scope: "project",
      agent: "claude-code",
      skills: ["project-only"],
      onConflict: "fail",
      yes: true
    });

    const baseline = parseManifest(target.volume.readFileSync("/home/user/.agent-stash/cache/default.manifest.json", "utf8") as string);
    expect(baseline.items.find((item) => item.name === "code-review")?.contentHash).toBe(originalCodeReview.contentHash);
    expect(baseline.items.map((item) => item.name)).toEqual(["code-review", "project-only"]);
  });

  it("fails on both-changed conflicts before writing local files", async () => {
    const gistClient = new InMemoryGistClient();
    const source = createContext(createDummyAgentConfigFixture(), gistClient);
    const upload = await uploadBundle(source.ctx, {
      profile: "default",
      scope: "project",
      agent: "claude-code",
      skills: ["code-review"],
      yes: true
    });
    await source.ctx.fs.mkdir("/home/user/.agent-stash/cache", { recursive: true });
    await source.ctx.fs.writeFile(
      "/home/user/.agent-stash/cache/default.manifest.json",
      `${JSON.stringify(upload.manifest, null, 2)}\n`,
      { encoding: "utf8" }
    );

    const files = createDummyAgentConfigFixture();
    files["/repo/.claude/skills/code-review/SKILL.md"] = "# Local Change\n";
    files["/home/user/.agent-stash/cache/default.manifest.json"] = JSON.stringify(upload.manifest, null, 2);
    const target = createContext(files, gistClient);
    const record = await gistClient.read("gist-default");
    const remoteManifest = parseManifest(record.files["agent-stash.json"]!.content);
    const remoteItem = remoteManifest.items.find((item) => item.name === "code-review")!;
    const remoteContent = "# Remote Change\n";
    remoteItem.files[0] = {
      ...remoteItem.files[0]!,
      size: Buffer.byteLength(remoteContent, "utf8"),
      sha256: sha256(remoteContent)
    };
    remoteItem.contentHash = hashFiles(remoteItem.files);
    record.files["agent-stash.json"] = {
      filename: "agent-stash.json",
      content: serializeManifest(remoteManifest)
    };
    const remotePath = gistFilenameForBundlePath("skills/project/claude-code/code-review/SKILL.md");
    record.files[remotePath] = {
      filename: remotePath,
      content: remoteContent
    };
    gistClient.seed(record);

    const result = await syncBundle(target.ctx, {
      profile: "default",
      scope: "project",
      agent: "claude-code",
      onConflict: "fail",
      yes: true
    });

    expect(result.conflicts.map((item) => item.name)).toContain("code-review");
    expect(target.volume.readFileSync("/repo/.claude/skills/code-review/SKILL.md", "utf8")).toBe("# Local Change\n");
  });

  it("backs up local files before downloading a remote-only change", async () => {
    const gistClient = new InMemoryGistClient();
    const source = createContext(createDummyAgentConfigFixture(), gistClient);
    const upload = await uploadBundle(source.ctx, {
      profile: "default",
      scope: "project",
      agent: "claude-code",
      skills: ["code-review"],
      yes: true
    });
    const files = createDummyAgentConfigFixture();
    files["/home/user/.agent-stash/cache/default.manifest.json"] = JSON.stringify(upload.manifest, null, 2);
    const target = createContext(files, gistClient);
    const record = await gistClient.read("gist-default");
    const remoteContent = "# Remote Change\n";
    const remoteManifest = parseManifest(record.files["agent-stash.json"]!.content);
    const remoteItem = remoteManifest.items.find((item) => item.name === "code-review")!;
    remoteItem.files[0] = {
      ...remoteItem.files[0]!,
      size: Buffer.byteLength(remoteContent, "utf8"),
      sha256: sha256(remoteContent)
    };
    remoteItem.contentHash = hashFiles(remoteItem.files);
    record.files["agent-stash.json"] = {
      filename: "agent-stash.json",
      content: serializeManifest(remoteManifest)
    };
    const remotePath = gistFilenameForBundlePath("skills/project/claude-code/code-review/SKILL.md");
    record.files[remotePath] = {
      filename: remotePath,
      content: remoteContent
    };
    gistClient.seed(record);

    const result = await syncBundle(target.ctx, {
      profile: "default",
      scope: "project",
      agent: "claude-code",
      onConflict: "fail",
      yes: true
    });

    expect(result.downloaded.map((item) => item.name)).toEqual(["code-review"]);
    expect(result.backupId).toMatch(/^backup-/);
    expect(target.volume.readFileSync("/repo/.claude/skills/code-review/SKILL.md", "utf8")).toBe(remoteContent);
    expect(
      target.volume.readFileSync(`/home/user/.agent-stash/backups/${result.backupId}/files/repo/.claude/skills/code-review/SKILL.md`, "utf8")
    ).toBe("# Code Review\n");
  });

  it("rejects corrupted remote file contents before sync downloads", async () => {
    const gistClient = new InMemoryGistClient();
    const source = createContext(createDummyAgentConfigFixture(), gistClient);
    const upload = await uploadBundle(source.ctx, {
      profile: "default",
      scope: "project",
      agent: "claude-code",
      skills: ["code-review"],
      yes: true
    });
    const files = createDummyAgentConfigFixture();
    files["/home/user/.agent-stash/cache/default.manifest.json"] = JSON.stringify(upload.manifest, null, 2);
    files["/repo/.claude/skills/code-review/SKILL.md"] = "# Existing Local\n";
    const target = createContext(files, gistClient);
    const record = await gistClient.read("gist-default");
    const remoteContent = "# Remote Change\n";
    const remoteManifest = parseManifest(record.files["agent-stash.json"]!.content);
    const remoteItem = remoteManifest.items.find((item) => item.name === "code-review")!;
    remoteItem.files[0] = {
      ...remoteItem.files[0]!,
      size: Buffer.byteLength(remoteContent, "utf8"),
      sha256: sha256(remoteContent)
    };
    remoteItem.contentHash = hashFiles(remoteItem.files);
    record.files["agent-stash.json"] = {
      filename: "agent-stash.json",
      content: serializeManifest(remoteManifest)
    };
    const remotePath = gistFilenameForBundlePath("skills/project/claude-code/code-review/SKILL.md");
    record.files[remotePath] = {
      filename: remotePath,
      content: "# Corrupted Remote\n"
    };
    gistClient.seed(record);

    await expect(syncBundle(target.ctx, {
      profile: "default",
      scope: "project",
      agent: "claude-code",
      onConflict: "remote",
      yes: true
    })).rejects.toThrow(/hash mismatch/);
    expect(target.volume.readFileSync("/repo/.claude/skills/code-review/SKILL.md", "utf8")).toBe("# Existing Local\n");
  });

  it("syncs using an agent alias against canonical manifest items", async () => {
    const gistClient = new InMemoryGistClient();
    const source = createContext(createDummyAgentConfigFixture(), gistClient);
    await uploadBundle(source.ctx, {
      profile: "default",
      scope: "project",
      agent: "claude-code",
      skills: ["code-review"],
      yes: true
    });
    const files = createDummyAgentConfigFixture();
    delete files["/repo/.claude/skills/code-review/SKILL.md"];
    const target = createContext(files, gistClient);

    const result = await syncBundle(target.ctx, {
      profile: "default",
      scope: "project",
      agent: "claude",
      onConflict: "fail",
      yes: true
    });

    expect(result.downloaded.map((item) => item.id)).toEqual(["project:skill:claude-code:code-review"]);
    expect(target.volume.readFileSync("/repo/.claude/skills/code-review/SKILL.md", "utf8")).toBe("# Code Review\n");
  });

  it("treats a remote deletion as a conflict with fail and writes nothing", async () => {
    const gistClient = new InMemoryGistClient();
    const source = createContext(createDummyAgentConfigFixture(), gistClient);
    const upload = await uploadBundle(source.ctx, {
      profile: "default",
      scope: "project",
      agent: "claude-code",
      skills: ["code-review"],
      yes: true
    });
    const files = createDummyAgentConfigFixture();
    files["/home/user/.agent-stash/cache/default.manifest.json"] = JSON.stringify(upload.manifest, null, 2);
    const target = createContext(files, gistClient);
    const record = await gistClient.read("gist-default");
    const remoteManifest = parseManifest(record.files["agent-stash.json"]!.content);
    remoteManifest.items = [];
    record.files["agent-stash.json"] = {
      filename: "agent-stash.json",
      content: serializeManifest(remoteManifest)
    };
    delete record.files[gistFilenameForBundlePath("skills/project/claude-code/code-review/SKILL.md")];
    gistClient.seed(record);

    const result = await syncBundle(target.ctx, {
      profile: "default",
      scope: "project",
      agent: "claude-code",
      onConflict: "fail",
      yes: true
    });

    expect(result.conflicts.map((item) => item.name)).toContain("code-review");
    expect(target.volume.readFileSync("/repo/.claude/skills/code-review/SKILL.md", "utf8")).toBe("# Code Review\n");
  });

  it("applies remote deletion with remote conflict policy after backing up local files", async () => {
    const gistClient = new InMemoryGistClient();
    const source = createContext(createDummyAgentConfigFixture(), gistClient);
    const upload = await uploadBundle(source.ctx, {
      profile: "default",
      scope: "project",
      agent: "claude-code",
      skills: ["code-review"],
      yes: true
    });
    const files = createDummyAgentConfigFixture();
    files["/home/user/.agent-stash/cache/default.manifest.json"] = JSON.stringify(upload.manifest, null, 2);
    const target = createContext(files, gistClient);
    const record = await gistClient.read("gist-default");
    const remoteManifest = parseManifest(record.files["agent-stash.json"]!.content);
    remoteManifest.items = [];
    record.files["agent-stash.json"] = {
      filename: "agent-stash.json",
      content: serializeManifest(remoteManifest)
    };
    delete record.files[gistFilenameForBundlePath("skills/project/claude-code/code-review/SKILL.md")];
    gistClient.seed(record);

    const result = await syncBundle(target.ctx, {
      profile: "default",
      scope: "project",
      agent: "claude-code",
      onConflict: "remote",
      yes: true
    });

    expect(result.deletedLocal.map((item) => item.name)).toEqual(["code-review"]);
    expect(result.backupId).toMatch(/^backup-/);
    expect(() => target.volume.statSync("/repo/.claude/skills/code-review")).toThrow();
    expect(
      target.volume.readFileSync(`/home/user/.agent-stash/backups/${result.backupId}/files/repo/.claude/skills/code-review/SKILL.md`, "utf8")
    ).toBe("# Code Review\n");
  });

  it("applies remote hook deletion without dropping unrelated settings", async () => {
    const gistClient = new InMemoryGistClient();
    const source = createContext(createDummyAgentConfigFixture(), gistClient);
    const upload = await uploadBundle(source.ctx, {
      profile: "default",
      scope: "project",
      agent: "claude-code",
      hooks: ["PreToolUse"],
      yes: true
    });
    const files = createDummyAgentConfigFixture();
    files["/home/user/.agent-stash/cache/default.manifest.json"] = JSON.stringify(upload.manifest, null, 2);
    const originalSettings = files["/repo/.claude/settings.json"]!;
    const target = createContext(files, gistClient);
    const record = await gistClient.read("gist-default");
    const remoteManifest = parseManifest(record.files["agent-stash.json"]!.content);
    remoteManifest.items = [];
    record.files["agent-stash.json"] = {
      filename: "agent-stash.json",
      content: serializeManifest(remoteManifest)
    };
    delete record.files[gistFilenameForBundlePath("hooks/project/claude-code/PreToolUse-Bash-001-001.json")];
    gistClient.seed(record);

    const result = await syncBundle(target.ctx, {
      profile: "default",
      scope: "project",
      agent: "claude-code",
      hooks: ["PreToolUse"],
      onConflict: "remote",
      yes: true
    });

    const settings = JSON.parse(target.volume.readFileSync("/repo/.claude/settings.json", "utf8") as string) as {
      permissions?: unknown;
      hooks?: Record<string, unknown>;
    };
    expect(result.deletedLocal.map((item) => item.name)).toEqual(["PreToolUse-Bash-001-001"]);
    expect(result.backupId).toMatch(/^backup-/);
    expect(settings.permissions).toEqual({ allow: ["Bash(npm test)"] });
    expect(settings.hooks?.PreToolUse).toBeUndefined();
    expect(settings.hooks?.Stop).toEqual([{ hooks: [{ type: "command", command: "echo done" }] }]);
    expect(
      target.volume.readFileSync(`/home/user/.agent-stash/backups/${result.backupId}/files/repo/.claude/settings.json`, "utf8")
    ).toBe(originalSettings);
  });

  it("applies unchanged local hook deletion without prompting when remote deleted it", async () => {
    const gistClient = new InMemoryGistClient();
    const source = createContext(createDummyAgentConfigFixture(), gistClient);
    const upload = await uploadBundle(source.ctx, {
      profile: "default",
      scope: "project",
      agent: "claude-code",
      hooks: ["PreToolUse"],
      yes: true
    });
    const files = createDummyAgentConfigFixture();
    files["/home/user/.agent-stash/cache/default.manifest.json"] = JSON.stringify(upload.manifest, null, 2);
    const target = createContext(files, gistClient);
    const record = await gistClient.read("gist-default");
    const remoteManifest = parseManifest(record.files["agent-stash.json"]!.content);
    remoteManifest.items = [];
    record.files["agent-stash.json"] = {
      filename: "agent-stash.json",
      content: serializeManifest(remoteManifest)
    };
    delete record.files[gistFilenameForBundlePath("hooks/project/claude-code/PreToolUse-Bash-001-001.json")];
    gistClient.seed(record);
    const prompted: string[] = [];

    const result = await syncBundle(target.ctx, {
      profile: "default",
      scope: "project",
      agent: "claude-code",
      hooks: ["PreToolUse"],
      onConflict: "ask",
      yes: true,
      async resolveConflict(conflict) {
        prompted.push(conflict.item.name);
        return "fail";
      }
    });

    const settings = JSON.parse(target.volume.readFileSync("/repo/.claude/settings.json", "utf8") as string) as {
      hooks?: Record<string, unknown>;
    };
    expect(prompted).toEqual([]);
    expect(result.deletedLocal.map((item) => item.name)).toEqual(["PreToolUse-Bash-001-001"]);
    expect(result.conflicts).toEqual([]);
    expect(settings.hooks?.PreToolUse).toBeUndefined();
  });

  it("applies remote deletion for a later hook downloaded by itself", async () => {
    const sourceFiles = {
      ...createDummyAgentConfigFixture(),
      "/repo/.claude/settings.json": JSON.stringify({
        hooks: {
          Stop: [
            { hooks: [{ type: "command", command: "remote first stop" }] },
            { hooks: [{ type: "command", command: "remote second stop" }] }
          ]
        }
      }, null, 2)
    };
    const gistClient = new InMemoryGistClient();
    const source = createContext(sourceFiles, gistClient);
    const upload = await uploadBundle(source.ctx, {
      profile: "default",
      scope: "project",
      agent: "claude-code",
      hooks: ["Stop"],
      yes: true
    });
    const targetFiles = {
      ...createDummyAgentConfigFixture(),
      "/repo/.claude/settings.json": JSON.stringify({
        hooks: {
          Stop: [{ hooks: [{ type: "command", command: "remote second stop" }] }]
        }
      }, null, 2),
      "/home/user/.agent-stash/cache/default.manifest.json": serializeManifest(upload.manifest),
      "/home/user/.agent-stash/hook-origins.json": JSON.stringify({
        version: 1,
        targets: {
          "/repo/.claude/settings.json": {
            Stop: [{ groupIndex: 1, hooks: [0] }]
          }
        }
      }, null, 2)
    };
    const target = createContext(targetFiles, gistClient);
    const record = await gistClient.read("gist-default");
    const remoteManifest = parseManifest(record.files["agent-stash.json"]!.content);
    remoteManifest.items = remoteManifest.items.filter((item) => item.name !== "Stop-all-tools-002-001");
    record.files["agent-stash.json"] = {
      filename: "agent-stash.json",
      content: serializeManifest(remoteManifest)
    };
    delete record.files[gistFilenameForBundlePath("hooks/project/claude-code/Stop-all-tools-002-001.json")];
    gistClient.seed(record);

    const result = await syncBundle(target.ctx, {
      profile: "default",
      scope: "project",
      agent: "claude-code",
      hooks: ["Stop-all-tools-002-001"],
      onConflict: "remote",
      yes: true
    });

    const settings = JSON.parse(target.volume.readFileSync("/repo/.claude/settings.json", "utf8") as string) as {
      hooks?: Record<string, unknown>;
    };
    expect(result.deletedLocal.map((item) => item.name)).toEqual(["Stop-all-tools-002-001"]);
    expect(settings.hooks?.Stop).toBeUndefined();
  });

  it("applies remote deletion after upload and partial download establish the baseline", async () => {
    const sourceFiles = {
      ...createDummyAgentConfigFixture(),
      "/repo/.claude/settings.json": JSON.stringify({
        hooks: {
          Stop: [
            { hooks: [{ type: "command", command: "remote first stop" }] },
            { hooks: [{ type: "command", command: "remote second stop" }] }
          ]
        }
      }, null, 2)
    };
    const gistClient = new InMemoryGistClient();
    const source = createContext(sourceFiles, gistClient);
    await uploadBundle(source.ctx, {
      profile: "default",
      scope: "project",
      agent: "claude-code",
      hooks: ["Stop"],
      yes: true
    });
    const targetFiles = {
      ...createDummyAgentConfigFixture(),
      "/repo/.claude/settings.json": JSON.stringify({ hooks: {} }, null, 2)
    };
    const target = createContext(targetFiles, gistClient);
    await downloadBundle(target.ctx, {
      profile: "default",
      scope: "project",
      agent: "claude-code",
      hooks: ["Stop-all-tools-002-001"],
      yes: true
    });
    const record = await gistClient.read("gist-default");
    const remoteManifest = parseManifest(record.files["agent-stash.json"]!.content);
    remoteManifest.items = remoteManifest.items.filter((item) => item.name !== "Stop-all-tools-002-001");
    record.files["agent-stash.json"] = {
      filename: "agent-stash.json",
      content: serializeManifest(remoteManifest)
    };
    delete record.files[gistFilenameForBundlePath("hooks/project/claude-code/Stop-all-tools-002-001.json")];
    gistClient.seed(record);

    const result = await syncBundle(target.ctx, {
      profile: "default",
      scope: "project",
      agent: "claude-code",
      hooks: ["Stop-all-tools-002-001"],
      onConflict: "remote",
      yes: true
    });

    const settings = JSON.parse(target.volume.readFileSync("/repo/.claude/settings.json", "utf8") as string) as {
      hooks?: Record<string, unknown>;
    };
    expect(result.uploaded).toEqual([]);
    expect(result.deletedLocal.map((item) => item.name)).toEqual(["Stop-all-tools-002-001"]);
    expect(settings.hooks?.Stop).toBeUndefined();
  });

  it("downloads unselected remote hooks during full sync after a selected hook download", async () => {
    const sourceFiles = {
      ...createDummyAgentConfigFixture(),
      "/repo/.claude/settings.json": JSON.stringify({
        hooks: {
          Stop: [
            { hooks: [{ type: "command", command: "remote first stop" }] },
            { hooks: [{ type: "command", command: "remote second stop" }] }
          ]
        }
      }, null, 2)
    };
    const gistClient = new InMemoryGistClient();
    const source = createContext(sourceFiles, gistClient);
    await uploadBundle(source.ctx, {
      profile: "default",
      scope: "project",
      agent: "claude-code",
      hooks: ["Stop"],
      yes: true
    });
    const targetFiles = {
      ...createDummyAgentConfigFixture(),
      "/repo/.claude/settings.json": JSON.stringify({ hooks: {} }, null, 2)
    };
    const target = createContext(targetFiles, gistClient);
    await downloadBundle(target.ctx, {
      profile: "default",
      scope: "project",
      agent: "claude-code",
      hooks: ["Stop-all-tools-002-001"],
      yes: true
    });

    const result = await syncBundle(target.ctx, {
      profile: "default",
      scope: "project",
      agent: "claude-code",
      onConflict: "fail",
      yes: true
    });

    const settings = JSON.parse(target.volume.readFileSync("/repo/.claude/settings.json", "utf8") as string) as {
      hooks?: { Stop?: Array<{ hooks?: Array<{ command?: string }> }> };
    };
    const baseline = parseManifest(target.volume.readFileSync("/home/user/.agent-stash/cache/default.manifest.json", "utf8") as string);
    expect(result.conflicts).toEqual([]);
    expect(result.downloaded.map((item) => item.name)).toEqual(["Stop-all-tools-001-001"]);
    expect(result.unchanged.map((item) => item.name)).toEqual(["Stop-all-tools-002-001"]);
    expect(settings.hooks?.Stop?.map((group) => group.hooks?.[0]?.command)).toEqual([
      "remote first stop",
      "remote second stop"
    ]);
    expect(baseline.items.filter((item) => item.name.startsWith("Stop-")).map((item) => item.name)).toEqual([
      "Stop-all-tools-001-001",
      "Stop-all-tools-002-001"
    ]);
  });

  it("downloads unselected remote hooks during full sync after a selected hook reupload", async () => {
    const sourceFiles = {
      ...createDummyAgentConfigFixture(),
      "/repo/.claude/settings.json": JSON.stringify({
        hooks: {
          Stop: [
            { hooks: [{ type: "command", command: "remote first stop" }] },
            { hooks: [{ type: "command", command: "remote second stop" }] }
          ]
        }
      }, null, 2)
    };
    const gistClient = new InMemoryGistClient();
    const source = createContext(sourceFiles, gistClient);
    await uploadBundle(source.ctx, {
      profile: "default",
      scope: "project",
      agent: "claude-code",
      hooks: ["Stop"],
      yes: true
    });
    const targetFiles = {
      ...createDummyAgentConfigFixture(),
      "/repo/.claude/settings.json": JSON.stringify({ hooks: {} }, null, 2)
    };
    const target = createContext(targetFiles, gistClient);
    await downloadBundle(target.ctx, {
      profile: "default",
      scope: "project",
      agent: "claude-code",
      hooks: ["Stop-all-tools-002-001"],
      yes: true
    });
    await uploadBundle(target.ctx, {
      profile: "default",
      scope: "project",
      agent: "claude-code",
      hooks: ["Stop-all-tools-002-001"],
      yes: true
    });

    const result = await syncBundle(target.ctx, {
      profile: "default",
      scope: "project",
      agent: "claude-code",
      onConflict: "fail",
      yes: true
    });

    const settings = JSON.parse(target.volume.readFileSync("/repo/.claude/settings.json", "utf8") as string) as {
      hooks?: { Stop?: Array<{ hooks?: Array<{ command?: string }> }> };
    };
    const baseline = parseManifest(target.volume.readFileSync("/home/user/.agent-stash/cache/default.manifest.json", "utf8") as string);
    expect(result.conflicts).toEqual([]);
    expect(result.downloaded.map((item) => item.name)).toEqual(["Stop-all-tools-001-001"]);
    expect(result.unchanged.map((item) => item.name)).toEqual(["Stop-all-tools-002-001"]);
    expect(settings.hooks?.Stop?.map((group) => group.hooks?.[0]?.command)).toEqual([
      "remote first stop",
      "remote second stop"
    ]);
    expect(baseline.items.filter((item) => item.name.startsWith("Stop-")).map((item) => item.name)).toEqual([
      "Stop-all-tools-001-001",
      "Stop-all-tools-002-001"
    ]);
  });

  it("rejects local skill deletion before backup when fs.rm is unavailable", async () => {
    const gistClient = new InMemoryGistClient();
    const source = createContext(createDummyAgentConfigFixture(), gistClient);
    const upload = await uploadBundle(source.ctx, {
      profile: "default",
      scope: "project",
      agent: "claude-code",
      skills: ["code-review"],
      yes: true
    });
    const files = createDummyAgentConfigFixture();
    files["/home/user/.agent-stash/cache/default.manifest.json"] = JSON.stringify(upload.manifest, null, 2);
    const target = createContext(files, gistClient);
    target.ctx.fs.rm = undefined;
    const record = await gistClient.read("gist-default");
    const remoteManifest = parseManifest(record.files["agent-stash.json"]!.content);
    remoteManifest.items = [];
    record.files["agent-stash.json"] = {
      filename: "agent-stash.json",
      content: serializeManifest(remoteManifest)
    };
    delete record.files[gistFilenameForBundlePath("skills/project/claude-code/code-review/SKILL.md")];
    gistClient.seed(record);

    await expect(syncBundle(target.ctx, {
      profile: "default",
      scope: "project",
      agent: "claude-code",
      onConflict: "remote",
      yes: true
    })).rejects.toThrow("Filesystem rm support is required to remove skill directory: /repo/.claude/skills/code-review");

    expect(target.volume.readFileSync("/repo/.claude/skills/code-review/SKILL.md", "utf8")).toBe("# Code Review\n");
    expect(() => target.volume.statSync("/home/user/.agent-stash/backups")).toThrow();
  });

  it("applies local deletion with local conflict policy by removing the remote item", async () => {
    const gistClient = new InMemoryGistClient();
    const source = createContext(createDummyAgentConfigFixture(), gistClient);
    const upload = await uploadBundle(source.ctx, {
      profile: "default",
      scope: "project",
      agent: "claude-code",
      skills: ["code-review"],
      yes: true
    });
    const files = createDummyAgentConfigFixture();
    delete files["/repo/.claude/skills/code-review/SKILL.md"];
    files["/home/user/.agent-stash/cache/default.manifest.json"] = JSON.stringify(upload.manifest, null, 2);
    const target = createContext(files, gistClient);

    const result = await syncBundle(target.ctx, {
      profile: "default",
      scope: "project",
      agent: "claude-code",
      onConflict: "local",
      yes: true
    });

    expect(result.deletedRemote.map((item) => item.name)).toEqual(["code-review"]);
    const update = gistClient.updateCalls.at(-1);
    expect(update?.input.files[gistFilenameForBundlePath("skills/project/claude-code/code-review/SKILL.md")]).toBeNull();
    expect(update?.input.files["agent-stash.json"]?.content).not.toContain("code-review");
  });

  it("applies unchanged remote skill deletion without prompting when local deleted it", async () => {
    const gistClient = new InMemoryGistClient();
    const source = createContext(createDummyAgentConfigFixture(), gistClient);
    const upload = await uploadBundle(source.ctx, {
      profile: "default",
      scope: "project",
      agent: "claude-code",
      skills: ["code-review"],
      yes: true
    });
    const files = createDummyAgentConfigFixture();
    delete files["/repo/.claude/skills/code-review/SKILL.md"];
    files["/home/user/.agent-stash/cache/default.manifest.json"] = JSON.stringify(upload.manifest, null, 2);
    const target = createContext(files, gistClient);
    const prompted: string[] = [];

    const result = await syncBundle(target.ctx, {
      profile: "default",
      scope: "project",
      agent: "claude-code",
      onConflict: "ask",
      yes: true,
      async resolveConflict(conflict) {
        prompted.push(conflict.item.name);
        return "fail";
      }
    });

    const update = gistClient.updateCalls.at(-1);
    expect(prompted).toEqual([]);
    expect(result.deletedRemote.map((item) => item.name)).toEqual(["code-review"]);
    expect(result.conflicts).toEqual([]);
    expect(update?.input.files[gistFilenameForBundlePath("skills/project/claude-code/code-review/SKILL.md")]).toBeNull();
  });

  it("flags first-sync differing local and remote items as a conflict with fail", async () => {
    const { target } = await createDivergedSkillScenario();

    const result = await syncBundle(target.ctx, {
      profile: "default",
      scope: "project",
      agent: "claude-code",
      onConflict: "fail",
      yes: true
    });

    expect(result.conflicts.map((item) => item.name)).toContain("code-review");
    expect(target.volume.readFileSync("/repo/.claude/skills/code-review/SKILL.md", "utf8")).toBe("# Local Change\n");
  });

  it("resolves both-changed conflicts with local policy by uploading local content", async () => {
    const { target, gistClient } = await createDivergedSkillScenario({ includeBase: true });

    const result = await syncBundle(target.ctx, {
      profile: "default",
      scope: "project",
      agent: "claude-code",
      onConflict: "local",
      yes: true
    });

    expect(result.uploaded.map((item) => item.name)).toContain("code-review");
    expect(gistClient.updateCalls.at(-1)?.input.files[gistFilenameForBundlePath("skills/project/claude-code/code-review/SKILL.md")]).toEqual({
      content: "# Local Change\n"
    });
  });

  it("resolves both-changed conflicts with remote policy by downloading remote content", async () => {
    const { target } = await createDivergedSkillScenario({ includeBase: true });

    const result = await syncBundle(target.ctx, {
      profile: "default",
      scope: "project",
      agent: "claude-code",
      onConflict: "remote",
      yes: true
    });

    expect(result.downloaded.map((item) => item.name)).toContain("code-review");
    expect(target.volume.readFileSync("/repo/.claude/skills/code-review/SKILL.md", "utf8")).toBe("# Remote Change\n");
  });

  it("resolves hook conflicts with remote policy by replacing the conflicting local hook", async () => {
    const gistClient = new InMemoryGistClient();
    const baseFiles = {
      ...createDummyAgentConfigFixture(),
      "/repo/.claude/settings.json": JSON.stringify({
        hooks: {
          PostToolUse: [
            { matcher: "Write|Edit", hooks: [{ type: "command", command: "base hook" }] }
          ]
        }
      }, null, 2)
    };
    const source = createContext(baseFiles, gistClient);
    const upload = await uploadBundle(source.ctx, {
      profile: "default",
      scope: "project",
      agent: "claude-code",
      hooks: ["PostToolUse-Write-Edit-001-001"],
      yes: true
    });
    const remoteFiles = {
      ...baseFiles,
      "/repo/.claude/settings.json": JSON.stringify({
        hooks: {
          PostToolUse: [
            { matcher: "Write|Edit", hooks: [{ type: "command", command: "remote hook" }] }
          ]
        }
      }, null, 2)
    };
    const remote = createContext(remoteFiles, gistClient);
    await uploadBundle(remote.ctx, {
      profile: "default",
      scope: "project",
      agent: "claude-code",
      hooks: ["PostToolUse-Write-Edit-001-001"],
      yes: true
    });
    const targetFiles = {
      ...baseFiles,
      "/repo/.claude/settings.json": JSON.stringify({
        hooks: {
          PostToolUse: [
            { matcher: "Write|Edit", hooks: [{ type: "command", command: "local hook" }] }
          ]
        }
      }, null, 2),
      "/home/user/.agent-stash/cache/default.manifest.json": serializeManifest(upload.manifest)
    };
    const target = createContext(targetFiles, gistClient);

    const result = await syncBundle(target.ctx, {
      profile: "default",
      scope: "project",
      agent: "claude-code",
      hooks: ["PostToolUse-Write-Edit-001-001"],
      onConflict: "remote",
      yes: true
    });

    const settings = JSON.parse(target.volume.readFileSync("/repo/.claude/settings.json", "utf8") as string) as {
      hooks?: { PostToolUse?: Array<{ hooks?: Array<{ command?: string }> }> };
    };
    expect(result.downloaded.map((item) => item.name)).toEqual(["PostToolUse-Write-Edit-001-001"]);
    expect(settings.hooks?.PostToolUse?.[0]?.hooks?.map((hook) => hook.command)).toEqual(["remote hook"]);
  });

  it("resolves ask conflicts through the injected conflict resolver", async () => {
    const { target } = await createDivergedSkillScenario({ includeBase: true });
    const prompted: string[] = [];

    const result = await syncBundle(target.ctx, {
      profile: "default",
      scope: "project",
      agent: "claude-code",
      onConflict: "ask",
      yes: true,
      async resolveConflict(conflict) {
        prompted.push(conflict.item.name);
        return "remote";
      }
    });

    expect(prompted).toEqual(["code-review"]);
    expect(result.downloaded.map((item) => item.name)).toContain("code-review");
    expect(target.volume.readFileSync("/repo/.claude/skills/code-review/SKILL.md", "utf8")).toBe("# Remote Change\n");
  });

  it("traces sync action hashes for conflict diagnosis without file contents", async () => {
    const { target } = await createDivergedSkillScenario({ includeBase: true });
    const traceRecords: Array<Record<string, unknown>> = [];
    target.ctx.trace = async (record) => {
      traceRecords.push(record);
    };

    await syncBundle(target.ctx, {
      profile: "default",
      scope: "project",
      agent: "claude-code",
      onConflict: "ask",
      yes: true,
      async resolveConflict() {
        return "remote";
      }
    });

    const actions = traceRecords.find((record) => record.event === "sync.actions") as
      | { actions?: Array<Record<string, unknown>> }
      | undefined;
    expect(actions?.actions).toContainEqual(expect.objectContaining({
      action: "download",
      initialAction: "conflict",
      conflictResolution: "remote",
      localId: "project:skill:claude-code:code-review",
      remoteId: "project:skill:claude-code:code-review",
      baseId: "project:skill:claude-code:code-review",
      localHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      remoteHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      baseHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      localUpdatedAt: fixedDate.toISOString(),
      remoteUpdatedAt: "2026-01-02T03:04:06.000Z",
      baseUpdatedAt: fixedDate.toISOString()
    }));
    expect(JSON.stringify(actions)).not.toContain("# Local Change");
    expect(JSON.stringify(actions)).not.toContain("# Remote Change");
  });

  it("rejects invalid interactive conflict resolver decisions", async () => {
    const { target } = await createDivergedSkillScenario({ includeBase: true });

    await expect(syncBundle(target.ctx, {
      profile: "default",
      scope: "project",
      agent: "claude-code",
      onConflict: "ask",
      yes: true,
      async resolveConflict() {
        return "merge" as "fail";
      }
    })).rejects.toThrow("Invalid conflict resolution: merge. Expected local, remote, newer, or fail.");
    expect(target.volume.readFileSync("/repo/.claude/skills/code-review/SKILL.md", "utf8")).toBe("# Local Change\n");
  });

  it("requires a conflict resolver when ask is used", async () => {
    const { target } = await createDivergedSkillScenario({ includeBase: true });

    await expect(syncBundle(target.ctx, {
      profile: "default",
      scope: "project",
      agent: "claude-code",
      onConflict: "ask",
      yes: true
    })).rejects.toThrow("--on-conflict ask requires an interactive conflict resolver.");
  });

  it("resolves both-changed conflicts with newer policy by timestamp", async () => {
    const { target, gistClient } = await createDivergedSkillScenario({ includeBase: true, localNewer: true });

    const result = await syncBundle(target.ctx, {
      profile: "default",
      scope: "project",
      agent: "claude-code",
      onConflict: "newer",
      yes: true
    });

    expect(result.uploaded.map((item) => item.name)).toContain("code-review");
    expect(gistClient.updateCalls.at(-1)?.input.files[gistFilenameForBundlePath("skills/project/claude-code/code-review/SKILL.md")]).toEqual({
      content: "# Local Change\n"
    });
  });

  it("rejects invalid remote timestamps before newer-policy writes", async () => {
    const { target, gistClient } = await createDivergedSkillScenario({ includeBase: true });
    const record = await gistClient.read("gist-default");
    const remoteManifest = parseManifest(record.files["agent-stash.json"]!.content);
    const remoteItem = remoteManifest.items.find((item) => item.name === "code-review")!;
    remoteItem.updatedAt = "not-a-date";
    record.files["agent-stash.json"] = {
      filename: "agent-stash.json",
      content: JSON.stringify(remoteManifest, null, 2)
    };
    gistClient.seed(record);

    await expect(syncBundle(target.ctx, {
      profile: "default",
      scope: "project",
      agent: "claude-code",
      onConflict: "newer",
      yes: true
    })).rejects.toThrow("Invalid manifest item updatedAt: not-a-date");
    expect(target.volume.readFileSync("/repo/.claude/skills/code-review/SKILL.md", "utf8")).toBe("# Local Change\n");
  });
});

async function createDivergedSkillScenario(options: { includeBase?: boolean; localNewer?: boolean } = {}): Promise<{
  gistClient: InMemoryGistClient;
  target: ReturnType<typeof createContext>;
}> {
  const gistClient = new InMemoryGistClient();
  const source = createContext(createDummyAgentConfigFixture(), gistClient);
  const upload = await uploadBundle(source.ctx, {
    profile: "default",
    scope: "project",
    agent: "claude-code",
    skills: ["code-review"],
    yes: true
  });
  const files = createDummyAgentConfigFixture();
  files["/repo/.claude/skills/code-review/SKILL.md"] = "# Local Change\n";
  if (options.includeBase) {
    files["/home/user/.agent-stash/cache/default.manifest.json"] = JSON.stringify(upload.manifest, null, 2);
  }
  const target = createContext(files, gistClient);
  target.ctx.now = () => new Date(options.localNewer ? "2026-01-02T03:04:10.000Z" : fixedDate);
  const record = await gistClient.read("gist-default");
  const remoteContent = "# Remote Change\n";
  const remoteManifest = parseManifest(record.files["agent-stash.json"]!.content);
  const remoteItem = remoteManifest.items.find((item) => item.name === "code-review")!;
  remoteItem.updatedAt = "2026-01-02T03:04:06.000Z";
  remoteItem.files[0] = {
    ...remoteItem.files[0]!,
    size: Buffer.byteLength(remoteContent, "utf8"),
    sha256: sha256(remoteContent)
  };
  remoteItem.contentHash = hashFiles(remoteItem.files);
  record.files["agent-stash.json"] = {
    filename: "agent-stash.json",
    content: serializeManifest(remoteManifest)
  };
  const remotePath = gistFilenameForBundlePath("skills/project/claude-code/code-review/SKILL.md");
  record.files[remotePath] = {
    filename: remotePath,
    content: remoteContent
  };
  gistClient.seed(record);
  return { gistClient, target };
}
