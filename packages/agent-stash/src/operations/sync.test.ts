import { describe, expect, it, vi } from "vitest";
import { Volume, createFsFromVolume } from "memfs";
import { gistFilenameForBundlePath } from "../bundle.js";
import { uploadBundle } from "./upload.js";
import { syncBundle } from "./sync.js";
import { parseManifest, serializeManifest } from "../manifest.js";
import { hashFiles, sha256 } from "../hash.js";
import { InMemoryGistClient } from "../test-support/in-memory-gist-client.js";
import { createDummyAgentConfigFixture, dummyCwd, dummyHome, fixedDate } from "../test-support/dummy-config.js";
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

    expect(result.uploaded.map((item) => item.name)).toEqual(["PreToolUse", "Stop", "commit-helper", "project-only"]);
    expect(gistClient.updateCalls.at(-1)?.input.files[gistFilenameForBundlePath("skills/project/claude-code/project-only/SKILL.md")]).toBeDefined();
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
    delete record.files[gistFilenameForBundlePath("hooks/project/claude-code/PreToolUse.json")];
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
    expect(result.deletedLocal.map((item) => item.name)).toEqual(["PreToolUse"]);
    expect(result.backupId).toMatch(/^backup-/);
    expect(settings.permissions).toEqual({ allow: ["Bash(npm test)"] });
    expect(settings.hooks?.PreToolUse).toBeUndefined();
    expect(settings.hooks?.Stop).toEqual([{ hooks: [{ type: "command", command: "echo done" }] }]);
    expect(
      target.volume.readFileSync(`/home/user/.agent-stash/backups/${result.backupId}/files/repo/.claude/settings.json`, "utf8")
    ).toBe(originalSettings);
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
