import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setTimeout as scheduleTimeout } from "node:timers";
import { Volume, createFsFromVolume } from "memfs";
import { gistFilenameForBundlePath } from "../bundle.js";
import { hashFiles, sha256 } from "../hash.js";
import { createEmptyManifest, parseManifest, serializeManifest } from "../manifest.js";
import { uploadBundle } from "./upload.js";
import { downloadBundle } from "./download.js";
import { InMemoryGistClient } from "../fixtures/in-memory-gist-client.js";
import { createDummyAgentConfigFixture, dummyCwd, dummyHome, fixedDate } from "../fixtures/dummy-config.js";
import type { AgentStashContext, AgentStashFileSystem, GistRecord, GistWriteInput } from "../types.js";

beforeEach(() => {
  vi.spyOn(globalThis, "setTimeout").mockImplementation((callback, _delay, ...args) =>
    scheduleTimeout(callback, 0, ...args)
  );
});

afterEach(() => vi.restoreAllMocks());

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

class StaleReadAfterUpdateGistClient extends InMemoryGistClient {
  private staleRecord: GistRecord | undefined;

  async update(gistId: string, input: GistWriteInput): Promise<GistRecord> {
    this.staleRecord = await super.read(gistId);
    return super.update(gistId, input);
  }

  async read(gistId: string): Promise<GistRecord> {
    if (this.staleRecord !== undefined) {
      this.readCalls.push(gistId);
      const stale = cloneGistRecord(this.staleRecord);
      this.staleRecord = undefined;
      return stale;
    }
    return super.read(gistId);
  }
}

class StaleSeedReadGistClient extends InMemoryGistClient {
  private staleRecords: GistRecord[] = [];

  seedStaleRecordsThenFresh(staleRecords: GistRecord[], freshRecord: GistRecord): void {
    this.staleRecords = staleRecords.map((record) => cloneGistRecord(record));
    this.seed(freshRecord);
  }

  async read(gistId: string): Promise<GistRecord> {
    const staleRecord = this.staleRecords.shift();
    if (staleRecord !== undefined) {
      this.readCalls.push(gistId);
      return cloneGistRecord(staleRecord);
    }
    return super.read(gistId);
  }
}

function cloneGistRecord(record: GistRecord): GistRecord {
  return {
    ...record,
    files: Object.fromEntries(Object.entries(record.files).map(([name, file]) => [name, { ...file }]))
  };
}

describe("upload/download", () => {
  it("rejects invalid upload and download scopes before doing work", async () => {
    const { ctx, gistClient } = createContext();

    await expect(uploadBundle(ctx, {
      profile: "default",
      scope: "workspace" as "project",
      agent: "claude-code",
      yes: true
    })).rejects.toThrow("Invalid scope: workspace. Expected project or global.");
    await expect(downloadBundle(ctx, {
      profile: "default",
      scope: "workspace" as "project",
      agent: "claude-code",
      yes: true
    })).rejects.toThrow("Invalid scope: workspace. Expected project or global.");
    expect(gistClient.createCalls).toHaveLength(0);
    expect(gistClient.updateCalls).toHaveLength(0);
    expect(gistClient.readCalls).toHaveLength(0);
  });

  it("rejects invalid download agents before reading a Gist", async () => {
    const { ctx, gistClient } = createContext();

    await expect(downloadBundle(ctx, {
      profile: "default",
      scope: "project",
      agent: "missing-agent",
      yes: true
    })).rejects.toThrow("Unknown agent: missing-agent");
    expect(gistClient.readCalls).toHaveLength(0);
    expect(gistClient.updateCalls).toHaveLength(0);
    expect(gistClient.createCalls).toHaveLength(0);
  });

  it("rejects invalid upload profiles with explicit Gists before writing a Gist", async () => {
    const { ctx, gistClient } = createContext();

    await expect(uploadBundle(ctx, {
      profile: "../escape",
      gist: "gist-default",
      scope: "project",
      agent: "claude-code",
      skills: ["code-review"],
      yes: true
    })).rejects.toThrow("Invalid profile name: ../escape");

    expect(gistClient.readCalls).toHaveLength(0);
    expect(gistClient.updateCalls).toHaveLength(0);
    expect(gistClient.createCalls).toHaveLength(0);
  });

  it("rejects invalid download profiles with explicit Gists before reading a Gist", async () => {
    const source = createContext();
    await uploadBundle(source.ctx, {
      profile: "default",
      scope: "project",
      agent: "claude-code",
      skills: ["code-review"],
      yes: true
    });
    const files = createDummyAgentConfigFixture();
    delete files["/repo/.claude/skills/code-review/SKILL.md"];
    const target = createContext(files, source.gistClient);
    source.gistClient.readCalls = [];

    await expect(downloadBundle(target.ctx, {
      profile: "../escape",
      gist: "gist-default",
      scope: "project",
      agent: "claude-code",
      yes: true
    })).rejects.toThrow("Invalid profile name: ../escape");

    expect(source.gistClient.readCalls).toHaveLength(0);
    expect(() => target.volume.statSync("/repo/.claude/skills/code-review/SKILL.md")).toThrow();
    expect(() => target.volume.statSync("/home/user/.agent-stash/backups")).toThrow();
  });

  it("rejects missing download Gist targets before creating a default Gist client", async () => {
    const { ctx } = createContext();
    ctx.gistClient = undefined;

    await expect(downloadBundle(ctx, {
      scope: "project",
      agent: "claude-code",
      yes: true
    })).rejects.toThrow("A profile with a Gist or --gist is required.");
  });

  it("requires yes before uploading remote writes", async () => {
    const { ctx, gistClient } = createContext();

    await expect(uploadBundle(ctx, {
      profile: "default",
      scope: "project",
      agent: "claude-code",
      skills: ["code-review"]
    })).rejects.toThrow("Upload writes require --yes in non-interactive mode.");
    expect(gistClient.createCalls).toHaveLength(0);
    expect(gistClient.updateCalls).toHaveLength(0);
    expect(gistClient.readCalls).toHaveLength(0);
  });

  it("rejects missing selected upload items before writing a Gist", async () => {
    const { ctx, gistClient } = createContext();

    await expect(uploadBundle(ctx, {
      profile: "default",
      scope: "project",
      agent: "claude-code",
      skills: ["missing-skill"],
      yes: true
    })).rejects.toThrow("Selected skill not found: missing-skill");
    expect(gistClient.createCalls).toHaveLength(0);
    expect(gistClient.updateCalls).toHaveLength(0);
    expect(gistClient.readCalls).toHaveLength(0);
  });

  it("rejects local items whose names cannot be represented in a manifest before writing a Gist", async () => {
    const files = createDummyAgentConfigFixture();
    files["/repo/.claude/skills/bad:name/SKILL.md"] = "# Bad\n";
    const { ctx, gistClient } = createContext(files);

    await expect(uploadBundle(ctx, {
      profile: "default",
      scope: "project",
      agent: "claude-code",
      skills: ["bad:name"],
      yes: true
    })).rejects.toThrow("Invalid manifest item name: bad:name");
    expect(gistClient.createCalls).toHaveLength(0);
    expect(gistClient.updateCalls).toHaveLength(0);
    expect(gistClient.readCalls).toHaveLength(0);
  });

  it("uploads selected project Claude skills and hooks to a secret Gist", async () => {
    const { ctx, gistClient } = createContext();
    const result = await uploadBundle(ctx, {
      profile: "new",
      scope: "project",
      agent: "claude-code",
      skills: ["code-review"],
      hooks: ["PreToolUse"],
      yes: true
    });

    expect(result.gistId).toBe("gist-1");
    expect(gistClient.createCalls).toHaveLength(1);
    expect(gistClient.createCalls[0]?.files["agent-stash.json"]).toBeDefined();
    expect(Object.keys(gistClient.createCalls[0]?.files ?? {}).toSorted()).toEqual([
      "agent-stash.json",
      gistFilenameForBundlePath("hooks/project/claude-code/PreToolUse-Bash-001-001.json"),
      gistFilenameForBundlePath("skills/project/claude-code/code-review/SKILL.md")
    ]);
  });

  it("writes a profile baseline after uploading through a profile", async () => {
    const { ctx, volume } = createContext();

    await uploadBundle(ctx, {
      profile: "default",
      scope: "project",
      agent: "claude-code",
      skills: ["code-review"],
      yes: true
    });

    const baseline = parseManifest(volume.readFileSync("/home/user/.agent-stash/cache/default.manifest.json", "utf8") as string);
    expect(baseline.items.map((item) => item.id)).toEqual(["project:skill:claude-code:code-review"]);
  });

  it("writes an explicit Gist baseline after uploading without a profile", async () => {
    const { ctx, volume } = createContext();

    await uploadBundle(ctx, {
      gist: "gist-default",
      scope: "project",
      agent: "claude-code",
      skills: ["code-review"],
      yes: true
    });

    const baseline = parseManifest(volume.readFileSync("/home/user/.agent-stash/cache/gist-gist-default.manifest.json", "utf8") as string);
    expect(baseline.items.map((item) => item.id)).toEqual(["project:skill:claude-code:code-review"]);
  });

  it("uploads each selected hook command as a separate Gist item", async () => {
    const files = {
      ...createDummyAgentConfigFixture(),
      "/repo/.claude/settings.json": JSON.stringify({
        hooks: {
          PostToolUse: [
            {
              matcher: "Write|Edit",
              hooks: [
                { type: "command", command: "jq -r '.tool_input.file_path'" },
                { type: "command", command: "node format.js" }
              ]
            }
          ]
        }
      }, null, 2)
    };
    const { ctx, gistClient } = createContext(files);
    const traces: Array<{ event: string; [key: string]: unknown }> = [];
    ctx.trace = async (record) => {
      traces.push(record);
    };

    const result = await uploadBundle(ctx, {
      profile: "new",
      scope: "project",
      agent: "claude-code",
      hooks: ["PostToolUse"],
      yes: true
    });

    expect(result.uploaded.map((item) => item.id)).toEqual([
      "project:hook:claude-code:PostToolUse-Write-Edit-001-001",
      "project:hook:claude-code:PostToolUse-Write-Edit-001-002"
    ]);
    expect(Object.keys(gistClient.createCalls[0]?.files ?? {}).toSorted()).toEqual([
      "agent-stash.json",
      gistFilenameForBundlePath("hooks/project/claude-code/PostToolUse-Write-Edit-001-001.json"),
      gistFilenameForBundlePath("hooks/project/claude-code/PostToolUse-Write-Edit-001-002.json")
    ]);
    expect(traces.find((record) => record.event === "upload.remote.create")).toMatchObject({
      writeFiles: [
        "agent-stash.json",
        gistFilenameForBundlePath("hooks/project/claude-code/PostToolUse-Write-Edit-001-001.json"),
        gistFilenameForBundlePath("hooks/project/claude-code/PostToolUse-Write-Edit-001-002.json")
      ],
      deleteFiles: []
    });
  });

  it("traces upload errors when a Gist update fails", async () => {
    const { ctx, gistClient } = createContext();
    const traces: Array<{ event: string; error?: string }> = [];
    ctx.trace = async (record) => {
      traces.push(record as { event: string; error?: string });
    };
    gistClient.update = vi.fn(async () => {
      throw new Error("secondary rate limit");
    });

    await expect(uploadBundle(ctx, {
      profile: "default",
      scope: "project",
      agent: "claude-code",
      skills: ["code-review"],
      yes: true
    })).rejects.toThrow("secondary rate limit");

    expect(traces.at(-1)).toMatchObject({
      event: "upload.error",
      error: "secondary rate limit"
    });
  });

  it("traces download errors when a Gist read fails", async () => {
    const { ctx, gistClient } = createContext();
    const traces: Array<{ event: string; error?: string }> = [];
    ctx.trace = async (record) => {
      traces.push(record as { event: string; error?: string });
    };
    gistClient.read = vi.fn(async () => {
      throw new Error("read refused");
    });

    await expect(downloadBundle(ctx, {
      profile: "default",
      scope: "project",
      agent: "claude-code",
      yes: true
    })).rejects.toThrow("read refused");

    expect(traces.at(-1)).toMatchObject({
      event: "download.error",
      error: "read refused"
    });
  });

  it("traces local writes during downloads without file contents", async () => {
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
    const traces: Array<{ event: string; [key: string]: unknown }> = [];
    target.ctx.trace = async (record) => {
      traces.push(record);
    };

    await downloadBundle(target.ctx, {
      profile: "default",
      scope: "project",
      agent: "claude-code",
      skills: ["code-review"],
      yes: true
    });

    expect(traces.find((record) => record.event === "local.write.start")).toMatchObject({
      event: "local.write.start",
      item: {
        id: "project:skill:claude-code:code-review",
        kind: "skill",
        scope: "project",
        agentId: "claude-code",
        name: "code-review"
      },
      targetPath: "/repo/.claude/skills/code-review",
      bundleFiles: ["skills/project/claude-code/code-review/SKILL.md"]
    });
    expect(traces.find((record) => record.event === "local.write.finish")).toMatchObject({
      event: "local.write.finish",
      item: {
        id: "project:skill:claude-code:code-review",
        kind: "skill",
        scope: "project",
        agentId: "claude-code",
        name: "code-review"
      },
      targetPath: "/repo/.claude/skills/code-review",
      writtenPaths: ["/repo/.claude/skills/code-review/SKILL.md"]
    });
    expect(JSON.stringify(traces)).not.toContain("# Code Review");
  });

  it("retries stale non-manifest Gist reads before downloading", async () => {
    const gistClient = new StaleReadAfterUpdateGistClient();
    gistClient.seed({
      id: "gist-default",
      htmlUrl: "https://gist.github.com/gist-default",
      files: {
        "seed.txt": { filename: "seed.txt", content: "placeholder\n" }
      }
    });
    const source = createContext(createDummyAgentConfigFixture(), gistClient);
    await uploadBundle(source.ctx, {
      gist: "gist-default",
      scope: "project",
      agent: "claude-code",
      hooks: ["PreToolUse"],
      yes: true
    });
    const target = createContext({}, gistClient);

    const result = await downloadBundle(target.ctx, {
      gist: "gist-default",
      scope: "project",
      agent: "claude-code",
      hooks: ["PreToolUse"],
      yes: true
    });

    expect(result.downloaded.map((item) => item.name)).toEqual(["PreToolUse-Bash-001-001"]);
    expect(gistClient.readCalls.filter((id) => id === "gist-default").length).toBeGreaterThanOrEqual(3);
  });

  it("retries profile-backed downloads when Gist metadata is fresh but manifest content is stale", async () => {
    vi.useFakeTimers();
    const staleClient = new StaleSeedReadGistClient();
    const freshUpdatedAt = "2026-01-02T03:05:00.000Z";
    const oldSource = createContext(createDummyAgentConfigFixture(), new InMemoryGistClient());
    await uploadBundle(oldSource.ctx, {
      gist: "gist-default",
      scope: "project",
      agent: "claude-code",
      hooks: ["PreToolUse"],
      yes: true
    });
    const oldRecord = await oldSource.gistClient.read("gist-default");
    const freshFiles = createDummyAgentConfigFixture();
    freshFiles["/repo/.claude/settings.json"] = JSON.stringify(
      {
        permissions: { allow: ["Bash(npm test)"] },
        hooks: {
          PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "npm test --fresh" }] }],
          Stop: [{ hooks: [{ type: "command", command: "echo done" }] }]
        }
      },
      null,
      2
    );
    const freshSource = createContext(freshFiles, new InMemoryGistClient());
    freshSource.ctx.now = () => new Date(freshUpdatedAt);
    await uploadBundle(freshSource.ctx, {
      gist: "gist-default",
      scope: "project",
      agent: "claude-code",
      hooks: ["PreToolUse"],
      yes: true
    });
    const freshRecord = await freshSource.gistClient.read("gist-default");
    staleClient.seedStaleRecordsThenFresh([
      { ...oldRecord, updatedAt: freshUpdatedAt }
    ], {
      ...freshRecord,
      updatedAt: freshUpdatedAt
    });
    const target = createContext({
      "/home/user/.agent-stash/config.json": JSON.stringify({ profiles: { default: { gistId: "gist-default" } } }, null, 2),
      "/home/user/.agent-stash/cache/default.manifest.json": oldRecord.files["agent-stash.json"]!.content
    }, staleClient);

    try {
      const downloadPromise = downloadBundle(target.ctx, {
        profile: "default",
        scope: "project",
        agent: "claude-code",
        hooks: ["PreToolUse"],
        yes: true
      });
      await vi.advanceTimersByTimeAsync(500);
      const result = await downloadPromise;

      expect(result.downloaded.map((item) => item.name)).toEqual(["PreToolUse-Bash-001-001"]);
      expect(target.volume.readFileSync("/repo/.claude/settings.json", "utf8")).toContain("npm test --fresh");
      expect(staleClient.readCalls).toEqual(["gist-default", "gist-default"]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("retries downloads when the Gist manifest is older than the local baseline", async () => {
    const staleClient = new StaleSeedReadGistClient();
    const oldSource = createContext(createDummyAgentConfigFixture(), new InMemoryGistClient());
    await uploadBundle(oldSource.ctx, {
      gist: "gist-default",
      scope: "project",
      agent: "claude-code",
      hooks: ["PreToolUse"],
      yes: true
    });
    const oldRecord = await oldSource.gistClient.read("gist-default");
    const freshFiles = createDummyAgentConfigFixture();
    freshFiles["/repo/.claude/settings.json"] = JSON.stringify(
      {
        permissions: { allow: ["Bash(npm test)"] },
        hooks: {
          PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "npm test --fresh-old-metadata" }] }],
          Stop: [{ hooks: [{ type: "command", command: "echo done" }] }]
        }
      },
      null,
      2
    );
    const freshSource = createContext(freshFiles, new InMemoryGistClient());
    freshSource.ctx.now = () => new Date("2026-01-02T03:05:00.000Z");
    await uploadBundle(freshSource.ctx, {
      gist: "gist-default",
      scope: "project",
      agent: "claude-code",
      hooks: ["PreToolUse"],
      yes: true
    });
    const freshRecord = await freshSource.gistClient.read("gist-default");
    staleClient.seedStaleRecordsThenFresh([oldRecord], freshRecord);
    const target = createContext({
      "/home/user/.agent-stash/config.json": JSON.stringify({ profiles: { default: { gistId: "gist-default" } } }, null, 2),
      "/home/user/.agent-stash/cache/default.manifest.json": freshRecord.files["agent-stash.json"]!.content
    }, staleClient);

    const result = await downloadBundle(target.ctx, {
      profile: "default",
      scope: "project",
      agent: "claude-code",
      hooks: ["PreToolUse"],
      yes: true
    });

    expect(result.downloaded.map((item) => item.name)).toEqual(["PreToolUse-Bash-001-001"]);
    expect(target.volume.readFileSync("/repo/.claude/settings.json", "utf8")).toContain("npm test --fresh-old-metadata");
    expect(staleClient.readCalls).toEqual(["gist-default", "gist-default"]);
  });

  it("retries one fresh profile download read when Gist metadata is ahead of manifest content without a baseline", async () => {
    const staleClient = new StaleSeedReadGistClient();
    const oldSource = createContext(createDummyAgentConfigFixture(), new InMemoryGistClient());
    await uploadBundle(oldSource.ctx, {
      gist: "gist-default",
      scope: "project",
      agent: "claude-code",
      hooks: ["PreToolUse"],
      yes: true
    });
    const oldRecord = await oldSource.gistClient.read("gist-default");
    const freshUpdatedAt = "2026-01-02T03:05:00.000Z";
    const freshFiles = createDummyAgentConfigFixture();
    freshFiles["/repo/.claude/settings.json"] = JSON.stringify(
      {
        permissions: { allow: ["Bash(npm test)"] },
        hooks: {
          PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "npm test --fresh-no-baseline" }] }],
          Stop: [{ hooks: [{ type: "command", command: "echo done" }] }]
        }
      },
      null,
      2
    );
    const freshSource = createContext(freshFiles, new InMemoryGistClient());
    freshSource.ctx.now = () => new Date(freshUpdatedAt);
    await uploadBundle(freshSource.ctx, {
      gist: "gist-default",
      scope: "project",
      agent: "claude-code",
      hooks: ["PreToolUse"],
      yes: true
    });
    const freshRecord = await freshSource.gistClient.read("gist-default");
    staleClient.seedStaleRecordsThenFresh([
      { ...oldRecord, updatedAt: freshUpdatedAt }
    ], {
      ...freshRecord,
      updatedAt: freshUpdatedAt
    });
    const target = createContext({
      "/home/user/.agent-stash/config.json": JSON.stringify({ profiles: { default: { gistId: "gist-default" } } }, null, 2)
    }, staleClient);

    const result = await downloadBundle(target.ctx, {
      profile: "default",
      scope: "project",
      agent: "claude-code",
      hooks: ["PreToolUse"],
      yes: true
    });

    expect(result.downloaded.map((item) => item.name)).toEqual(["PreToolUse-Bash-001-001"]);
    expect(target.volume.readFileSync("/repo/.claude/settings.json", "utf8")).toContain("npm test --fresh-no-baseline");
    expect(staleClient.readCalls).toEqual(["gist-default", "gist-default"]);
  });

  it("retries one profile download read without a baseline when Gist metadata is also stale", async () => {
    const staleClient = new StaleSeedReadGistClient();
    const oldSource = createContext(createDummyAgentConfigFixture(), new InMemoryGistClient());
    await uploadBundle(oldSource.ctx, {
      gist: "gist-default",
      scope: "project",
      agent: "claude-code",
      hooks: ["PreToolUse"],
      yes: true
    });
    const oldRecord = await oldSource.gistClient.read("gist-default");
    const freshFiles = createDummyAgentConfigFixture();
    freshFiles["/repo/.claude/settings.json"] = JSON.stringify(
      {
        permissions: { allow: ["Bash(npm test)"] },
        hooks: {
          PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "npm test --fresh-stale-metadata-no-baseline" }] }],
          Stop: [{ hooks: [{ type: "command", command: "echo done" }] }]
        }
      },
      null,
      2
    );
    const freshSource = createContext(freshFiles, new InMemoryGistClient());
    freshSource.ctx.now = () => new Date("2026-01-02T03:05:00.000Z");
    await uploadBundle(freshSource.ctx, {
      gist: "gist-default",
      scope: "project",
      agent: "claude-code",
      hooks: ["PreToolUse"],
      yes: true
    });
    const freshRecord = await freshSource.gistClient.read("gist-default");
    staleClient.seedStaleRecordsThenFresh([oldRecord], freshRecord);
    const target = createContext({
      "/home/user/.agent-stash/config.json": JSON.stringify({ profiles: { default: { gistId: "gist-default" } } }, null, 2)
    }, staleClient);

    const result = await downloadBundle(target.ctx, {
      profile: "default",
      scope: "project",
      agent: "claude-code",
      hooks: ["PreToolUse"],
      yes: true
    });

    expect(result.downloaded.map((item) => item.name)).toEqual(["PreToolUse-Bash-001-001"]);
    expect(target.volume.readFileSync("/repo/.claude/settings.json", "utf8")).toContain("npm test --fresh-stale-metadata-no-baseline");
    expect(staleClient.readCalls).toEqual(["gist-default", "gist-default"]);
  });

  it("retries explicit Gist downloads when stale reads are missing the selected hook", async () => {
    vi.useFakeTimers();
    const staleClient = new StaleSeedReadGistClient();
    const staleRecord: GistRecord = {
      id: "gist-default",
      htmlUrl: "https://gist.github.com/gist-default",
      files: {
        "agent-stash.json": {
          filename: "agent-stash.json",
          content: serializeManifest(createEmptyManifest(fixedDate))
        },
        "seed.txt": { filename: "seed.txt", content: "stale seed\n" }
      }
    };
    const sourceFiles = {
      ...createDummyAgentConfigFixture(),
      "/home/user/.claude/settings.json": JSON.stringify({
        hooks: {
          PostToolUse: [
            { matcher: "*", hooks: [{ type: "command", command: "notify after tool use" }] }
          ]
        }
      }, null, 2)
    };
    const freshSource = createContext(sourceFiles, new InMemoryGistClient());
    await uploadBundle(freshSource.ctx, {
      gist: "gist-default",
      scope: "global",
      agent: "claude-code",
      hooks: ["PostToolUse"],
      yes: true
    });
    const freshRecord = await freshSource.gistClient.read("gist-default");
    staleClient.seedStaleRecordsThenFresh([staleRecord, staleRecord], freshRecord);
    const target = createContext({}, staleClient);

    try {
      const downloadPromise = downloadBundle(target.ctx, {
        gist: "gist-default",
        scope: "global",
        agent: "claude-code",
        hooks: ["PostToolUse"],
        yes: true
      });
      await vi.advanceTimersByTimeAsync(500);
      const result = await downloadPromise;

      expect(result.downloaded.map((item) => item.name)).toEqual(["PostToolUse-all-tools-001-001"]);
      expect(target.volume.readFileSync("/home/user/.claude/settings.json", "utf8")).toContain("notify after tool use");
      expect(staleClient.readCalls).toEqual(["gist-default", "gist-default", "gist-default"]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("preserves unmanaged Gist files while retrying stale non-manifest reads before a follow-up upload", async () => {
    const gistClient = new StaleReadAfterUpdateGistClient();
    gistClient.seed({
      id: "gist-default",
      htmlUrl: "https://gist.github.com/gist-default",
      files: {
        "seed.txt": { filename: "seed.txt", content: "placeholder\n" }
      }
    });
    const files = {
      ...createDummyAgentConfigFixture(),
      "/repo/.claude/settings.json": JSON.stringify({
        hooks: {
          SessionStart: [
            { hooks: [{ type: "command", command: "first session command" }] }
          ]
        }
      }, null, 2)
    };
    const source = createContext(files, gistClient);
    await uploadBundle(source.ctx, {
      gist: "gist-default",
      scope: "project",
      agent: "claude-code",
      hooks: ["SessionStart-all-tools-001-001"],
      yes: true
    });
    await source.ctx.fs.writeFile("/repo/.claude/settings.json", JSON.stringify({
      hooks: {
        SessionStart: [
          { hooks: [{ type: "command", command: "updated session command" }] }
        ]
      }
    }, null, 2), { encoding: "utf8" });

    await uploadBundle(source.ctx, {
      gist: "gist-default",
      scope: "project",
      agent: "claude-code",
      hooks: ["SessionStart-all-tools-001-001"],
      yes: true
    });

    await gistClient.read("gist-default");
    const record = await gistClient.read("gist-default");
    expect(record.files["seed.txt"]?.content).toBe("placeholder\n");
    expect(record.files[gistFilenameForBundlePath("hooks/project/claude-code/SessionStart-all-tools-001-001.json")]?.content).toContain("updated session command");
    expect(gistClient.updateCalls.at(-1)?.input.files["seed.txt"]).toBeUndefined();
    expect(gistClient.readCalls.filter((id) => id === "gist-default").length).toBeGreaterThanOrEqual(3);
  });

  it("does not rewrite profile config when uploading through an explicit Gist override", async () => {
    const gistClient = new InMemoryGistClient();
    gistClient.seed({ id: "gist-default", htmlUrl: "https://gist.github.com/gist-default", files: {} });
    gistClient.seed({ id: "gist-other", htmlUrl: "https://gist.github.com/gist-other", files: {} });
    const { ctx, volume } = createContext(createDummyAgentConfigFixture(), gistClient);

    await uploadBundle(ctx, {
      profile: "default",
      gist: "gist-other",
      scope: "project",
      agent: "claude-code",
      skills: ["project-only"],
      yes: true
    });

    const config = JSON.parse(volume.readFileSync("/home/user/.agent-stash/config.json", "utf8") as string) as unknown;
    const record = await gistClient.read("gist-other");
    const manifest = parseManifest(record.files["agent-stash.json"]!.content);
    expect(config).toEqual({ profiles: { default: { gistId: "gist-default" } } });
    expect(manifest.profile).toBeUndefined();
    expect(() => volume.statSync("/home/user/.agent-stash/cache/default.manifest.json")).toThrow();
  });

  it("preserves unmanaged files when initializing an explicit Gist without a manifest", async () => {
    const gistClient = new InMemoryGistClient();
    gistClient.seed({ id: "gist-default", htmlUrl: "https://gist.github.com/gist-default", files: {} });
    gistClient.seed({
      id: "gist-other",
      htmlUrl: "https://gist.github.com/gist-other",
      files: {
        "placeholder.txt": {
          filename: "placeholder.txt",
          content: "temporary\n"
        }
      }
    });
    const files = {
      ...createDummyAgentConfigFixture(),
      "/repo/.claude/settings.json": JSON.stringify({
        hooks: {
          PostToolUse: [
            { matcher: "Write|Edit", hooks: [{ type: "command", command: "format changed file" }] }
          ]
        }
      }, null, 2)
    };
    const { ctx } = createContext(files, gistClient);

    await uploadBundle(ctx, {
      profile: "default",
      gist: "gist-other",
      scope: "project",
      agent: "claude-code",
      hooks: ["PostToolUse"],
      yes: true
    });

    const record = await gistClient.read("gist-other");
    const manifest = parseManifest(record.files["agent-stash.json"]!.content);
    expect(gistClient.updateCalls.at(-1)?.input.files["placeholder.txt"]).toBeUndefined();
    expect(record.files["placeholder.txt"]?.content).toBe("temporary\n");
    expect(manifest.items.map((item) => item.name)).toEqual(["PostToolUse-Write-Edit-001-001"]);
    expect(record.files[gistFilenameForBundlePath("hooks/project/claude-code/PostToolUse-Write-Edit-001-001.json")]).toBeDefined();
  });

  it("does not treat empty selected upload lists as all local items", async () => {
    const { ctx, gistClient } = createContext();

    const result = await uploadBundle(ctx, {
      profile: "default",
      scope: "project",
      agent: "claude-code",
      skills: [],
      yes: true
    });

    expect(result.uploaded).toEqual([]);
    expect(gistClient.updateCalls.at(-1)?.input.files[gistFilenameForBundlePath("skills/project/claude-code/code-review/SKILL.md")]).toBeUndefined();
    expect(gistClient.updateCalls.at(-1)?.input.files["agent-stash.json"]?.content).not.toContain("code-review");
  });

  it("does not create a new Gist for an empty upload selection", async () => {
    const { ctx, gistClient } = createContext();

    await expect(uploadBundle(ctx, {
      scope: "project",
      agent: "claude-code",
      skills: [],
      yes: true
    })).rejects.toThrow("No upload items selected.");

    expect(gistClient.createCalls).toHaveLength(0);
    expect(gistClient.updateCalls).toHaveLength(0);
  });

  it("updates selected items without dropping unrelated remote manifest entries", async () => {
    const { ctx, gistClient } = createContext();
    await uploadBundle(ctx, {
      profile: "default",
      scope: "project",
      agent: "claude-code",
      skills: ["code-review", "commit-helper"],
      yes: true
    });
    await ctx.fs.writeFile("/repo/.claude/skills/code-review/SKILL.md", "# Updated Review\n", {
      encoding: "utf8"
    });

    await uploadBundle(ctx, {
      profile: "default",
      scope: "project",
      agent: "claude-code",
      skills: ["code-review"],
      yes: true
    });

    const updated = await gistClient.read("gist-default");
    expect(updated.files["agent-stash.json"]?.content).toContain("code-review");
    expect(updated.files["agent-stash.json"]?.content).toContain("commit-helper");
    expect(updated.files[gistFilenameForBundlePath("skills/project/claude-code/code-review/SKILL.md")]?.content).toBe(
      "# Updated Review\n"
    );
    expect(updated.files[gistFilenameForBundlePath("skills/project/claude-code/commit-helper/SKILL.md")]?.content).toBe(
      "# Commit Helper\n"
    );
    expect(gistClient.updateCalls.at(-1)?.input.files[gistFilenameForBundlePath("skills/project/claude-code/code-review/SKILL.md")]).toEqual({
      content: "# Updated Review\n"
    });
    expect(gistClient.updateCalls.at(-1)?.input.files[gistFilenameForBundlePath("skills/project/claude-code/commit-helper/SKILL.md")]).toBeUndefined();
  });

  it("removes stale same-scope items during a full upload", async () => {
    const sourceFiles = {
      ...createDummyAgentConfigFixture(),
      "/repo/.claude/settings.json": JSON.stringify({
        hooks: {
          SessionStart: [
            { hooks: [{ type: "command", command: "remote first session" }] },
            { hooks: [{ type: "command", command: "remote second session" }] }
          ],
          Stop: [{ hooks: [{ type: "command", command: "echo done" }] }]
        }
      }, null, 2)
    };
    const gistClient = new InMemoryGistClient();
    const source = createContext(sourceFiles, gistClient);
    await uploadBundle(source.ctx, {
      profile: "default",
      scope: "project",
      agent: "claude-code",
      yes: true
    });
    const targetFiles = {
      ...createDummyAgentConfigFixture(),
      "/repo/.claude/settings.json": JSON.stringify({
        hooks: {
          Stop: [{ hooks: [{ type: "command", command: "echo done" }] }]
        }
      }, null, 2)
    };
    const target = createContext(targetFiles, gistClient);

    await uploadBundle(target.ctx, {
      profile: "default",
      scope: "project",
      agent: "claude-code",
      yes: true
    });

    const record = await gistClient.read("gist-default");
    const manifest = parseManifest(record.files["agent-stash.json"]!.content);
    expect(manifest.items.map((item) => item.id)).not.toContain("project:hook:claude-code:SessionStart-all-tools-001-001");
    expect(manifest.items.map((item) => item.id)).not.toContain("project:hook:claude-code:SessionStart-all-tools-002-001");
    expect(record.files[gistFilenameForBundlePath("hooks/project/claude-code/SessionStart-all-tools-001-001.json")]).toBeUndefined();
    expect(record.files[gistFilenameForBundlePath("hooks/project/claude-code/SessionStart-all-tools-002-001.json")]).toBeUndefined();
    expect(record.files[gistFilenameForBundlePath("hooks/project/claude-code/Stop-all-tools-001-001.json")]?.content).toContain("echo done");
  });

  it("preserves same-event hook splits from another scope during filtered upload", async () => {
    const gistClient = new InMemoryGistClient();
    const source = createContext(createDummyAgentConfigFixture(), gistClient);
    await uploadBundle(source.ctx, {
      profile: "default",
      scope: "project",
      agent: "claude-code",
      hooks: ["Stop"],
      yes: true
    });

    await uploadBundle(source.ctx, {
      profile: "default",
      scope: "global",
      agent: "claude-code",
      hooks: ["Stop"],
      yes: true
    });

    const record = await gistClient.read("gist-default");
    const manifest = parseManifest(record.files["agent-stash.json"]!.content);
    expect(manifest.items.map((item) => item.id)).toEqual([
      "global:hook:claude-code:Stop-all-tools-001-001",
      "project:hook:claude-code:Stop-all-tools-001-001"
    ]);
    expect(record.files[gistFilenameForBundlePath("hooks/global/claude-code/Stop-all-tools-001-001.json")]?.content).toContain("global stop");
    expect(record.files[gistFilenameForBundlePath("hooks/project/claude-code/Stop-all-tools-001-001.json")]?.content).toContain("echo done");
  });

  it("preserves legacy same-event hook chunks from another scope during filtered upload", async () => {
    const gistClient = new InMemoryGistClient();
    const legacyContent = `${JSON.stringify({
      hooks: {
        Stop: [{ hooks: [{ type: "command", command: "project legacy stop" }] }]
      }
    }, null, 2)}\n`;
    const legacyFile = {
      path: "hooks/project/claude-code/Stop.json",
      size: Buffer.byteLength(legacyContent, "utf8"),
      sha256: sha256(legacyContent)
    };
    const legacyItem = {
      id: "project:hook:claude-code:Stop",
      kind: "hook" as const,
      agentId: "claude-code",
      name: "Stop",
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
    const source = createContext(createDummyAgentConfigFixture(), gistClient);

    await uploadBundle(source.ctx, {
      profile: "default",
      scope: "global",
      agent: "claude-code",
      hooks: ["Stop"],
      yes: true
    });

    const record = await gistClient.read("gist-default");
    const manifest = parseManifest(record.files["agent-stash.json"]!.content);
    expect(manifest.items.map((item) => item.id)).toEqual([
      "global:hook:claude-code:Stop-all-tools-001-001",
      "project:hook:claude-code:Stop"
    ]);
    expect(record.files[gistFilenameForBundlePath("hooks/global/claude-code/Stop-all-tools-001-001.json")]?.content).toContain("global stop");
    expect(record.files[gistFilenameForBundlePath("hooks/project/claude-code/Stop.json")]?.content).toContain("project legacy stop");
  });

  it("replaces legacy event-level remote hooks with split hook items during upload", async () => {
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

    await uploadBundle(ctx, {
      profile: "default",
      scope: "project",
      agent: "claude-code",
      hooks: ["PostToolUse"],
      yes: true
    });

    const record = await gistClient.read("gist-default");
    const manifest = parseManifest(record.files["agent-stash.json"]!.content);
    expect(manifest.items.map((item) => item.id)).toEqual(["project:hook:claude-code:PostToolUse-Write-Edit-001-001"]);
    expect(record.files[gistFilenameForBundlePath("hooks/project/claude-code/PostToolUse.json")]).toBeUndefined();
    expect(record.files[gistFilenameForBundlePath("hooks/project/claude-code/PostToolUse-Write-Edit-001-001.json")]?.content).toContain("split replacement");
  });

  it("removes untracked legacy event-level hook chunks when uploading split hook replacements", async () => {
    const gistClient = new InMemoryGistClient();
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

    await uploadBundle(ctx, {
      profile: "default",
      scope: "project",
      agent: "claude-code",
      hooks: ["PostToolUse"],
      yes: true
    });

    const seeded = await gistClient.read("gist-default");
    const legacyPath = "hooks/project/claude-code/PostToolUse.json";
    seeded.files[gistFilenameForBundlePath(legacyPath)] = {
      filename: gistFilenameForBundlePath(legacyPath),
      content: `${JSON.stringify({
        hooks: {
          PostToolUse: [
            { matcher: "Write|Edit", hooks: [{ type: "command", command: "legacy chunk" }] }
          ]
        }
      }, null, 2)}\n`
    };
    gistClient.seed(seeded);

    await uploadBundle(ctx, {
      profile: "default",
      scope: "project",
      agent: "claude-code",
      hooks: ["PostToolUse"],
      yes: true
    });

    const record = await gistClient.read("gist-default");
    expect(record.files[gistFilenameForBundlePath(legacyPath)]).toBeUndefined();
    expect(record.files[gistFilenameForBundlePath("hooks/project/claude-code/PostToolUse-Write-Edit-001-001.json")]?.content).toContain("split replacement");
    expect(gistClient.updateCalls.at(-1)?.input.files[gistFilenameForBundlePath(legacyPath)]).toBeNull();
  });

  it("removes stale split hook items for the same event during event-level upload", async () => {
    const sourceFiles = {
      ...createDummyAgentConfigFixture(),
      "/repo/.claude/settings.json": JSON.stringify({
        hooks: {
          PostToolUse: [
            {
              matcher: "Write|Edit",
              hooks: [
                { type: "command", command: "remote first" },
                { type: "command", command: "remote second" }
              ]
            }
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
              hooks: [
                { type: "command", command: "remote second" }
              ]
            }
          ]
        }
      }, null, 2)
    };
    const target = createContext(targetFiles, gistClient);
    const traces: Array<{ event: string; [key: string]: unknown }> = [];
    target.ctx.trace = async (record) => {
      traces.push(record);
    };

    await uploadBundle(target.ctx, {
      profile: "default",
      scope: "project",
      agent: "claude-code",
      hooks: ["PostToolUse"],
      yes: true
    });

    const record = await gistClient.read("gist-default");
    const manifest = parseManifest(record.files["agent-stash.json"]!.content);
    expect(manifest.items.map((item) => item.id)).toEqual(["project:hook:claude-code:PostToolUse-Write-Edit-001-001"]);
    expect(record.files[gistFilenameForBundlePath("hooks/project/claude-code/PostToolUse-Write-Edit-001-001.json")]?.content).toContain("remote second");
    expect(record.files[gistFilenameForBundlePath("hooks/project/claude-code/PostToolUse-Write-Edit-001-002.json")]).toBeUndefined();
    expect(traces.find((record) => record.event === "upload.staleHookSplitsRemoved")?.items).toEqual([
      {
        id: "project:hook:claude-code:PostToolUse-Write-Edit-001-002",
        kind: "hook",
        scope: "project",
        agentId: "claude-code",
        name: "PostToolUse-Write-Edit-001-002"
      }
    ]);
  });

  it("updates the manifest when event-level upload only deletes a stale split hook", async () => {
    const sourceFiles = {
      ...createDummyAgentConfigFixture(),
      "/repo/.claude/settings.json": JSON.stringify({
        hooks: {
          Stop: [
            { hooks: [{ type: "command", command: "keep stop" }] },
            { hooks: [{ type: "command", command: "remove stop" }] }
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
      "/repo/.claude/settings.json": JSON.stringify({
        hooks: {
          Stop: [
            { hooks: [{ type: "command", command: "keep stop" }] }
          ]
        }
      }, null, 2)
    };
    const target = createContext(targetFiles, gistClient);

    await uploadBundle(target.ctx, {
      profile: "default",
      scope: "project",
      agent: "claude-code",
      hooks: ["Stop"],
      yes: true
    });

    const record = await gistClient.read("gist-default");
    const manifest = parseManifest(record.files["agent-stash.json"]!.content);
    expect(manifest.items.map((item) => item.id)).toEqual(["project:hook:claude-code:Stop-all-tools-001-001"]);
    expect(record.files[gistFilenameForBundlePath("hooks/project/claude-code/Stop-all-tools-001-001.json")]?.content).toContain("keep stop");
    expect(record.files[gistFilenameForBundlePath("hooks/project/claude-code/Stop-all-tools-002-001.json")]).toBeUndefined();
    expect(gistClient.updateCalls.at(-1)?.input.files["agent-stash.json"]).toBeDefined();
    expect(gistClient.updateCalls.at(-1)?.input.files[gistFilenameForBundlePath("hooks/project/claude-code/Stop-all-tools-002-001.json")]).toBeNull();
  });

  it("removes stale split hook items for the same event during split-row upload", async () => {
    const sourceFiles = {
      ...createDummyAgentConfigFixture(),
      "/repo/.claude/settings.json": JSON.stringify({
        hooks: {
          PreToolUse: [
            {
              matcher: "Bash",
              hooks: [
                { type: "command", command: "remote first bash" },
                { type: "command", command: "remote second bash" }
              ]
            }
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
      hooks: ["PreToolUse"],
      yes: true
    });
    const targetFiles = {
      ...createDummyAgentConfigFixture(),
      "/repo/.claude/settings.json": JSON.stringify({
        hooks: {
          PreToolUse: [
            {
              matcher: "Bash",
              hooks: [
                { type: "command", command: "remote first bash" }
              ]
            }
          ]
        }
      }, null, 2)
    };
    const target = createContext(targetFiles, gistClient);
    const traces: Array<{ event: string; [key: string]: unknown }> = [];
    target.ctx.trace = async (record) => {
      traces.push(record);
    };

    await uploadBundle(target.ctx, {
      profile: "default",
      scope: "project",
      agent: "claude-code",
      hooks: ["PreToolUse-Bash-001-001"],
      yes: true
    });

    const record = await gistClient.read("gist-default");
    const manifest = parseManifest(record.files["agent-stash.json"]!.content);
    expect(manifest.items.map((item) => item.id)).toEqual(["project:hook:claude-code:PreToolUse-Bash-001-001"]);
    expect(record.files[gistFilenameForBundlePath("hooks/project/claude-code/PreToolUse-Bash-001-001.json")]?.content).toContain("remote first bash");
    expect(record.files[gistFilenameForBundlePath("hooks/project/claude-code/PreToolUse-Bash-001-002.json")]).toBeUndefined();
    expect(traces.find((record) => record.event === "upload.staleHookSplitsRemoved")?.items).toEqual([
      {
        id: "project:hook:claude-code:PreToolUse-Bash-001-002",
        kind: "hook",
        scope: "project",
        agentId: "claude-code",
        name: "PreToolUse-Bash-001-002"
      }
    ]);
  });

  it("removes stale split hook groups with the same matcher during event-level upload", async () => {
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
      "/repo/.claude/settings.json": JSON.stringify({
        hooks: {
          Stop: [
            { hooks: [{ type: "command", command: "remote first stop" }] }
          ]
        }
      }, null, 2)
    };
    const target = createContext(targetFiles, gistClient);
    const traces: Array<{ event: string; [key: string]: unknown }> = [];
    target.ctx.trace = async (record) => {
      traces.push(record);
    };

    await uploadBundle(target.ctx, {
      profile: "default",
      scope: "project",
      agent: "claude-code",
      hooks: ["Stop"],
      yes: true
    });

    const record = await gistClient.read("gist-default");
    const manifest = parseManifest(record.files["agent-stash.json"]!.content);
    expect(manifest.items.map((item) => item.id)).toEqual(["project:hook:claude-code:Stop-all-tools-001-001"]);
    expect(record.files[gistFilenameForBundlePath("hooks/project/claude-code/Stop-all-tools-001-001.json")]?.content).toContain("remote first stop");
    expect(record.files[gistFilenameForBundlePath("hooks/project/claude-code/Stop-all-tools-002-001.json")]).toBeUndefined();
    expect(traces.find((record) => record.event === "upload.staleHookSplitsRemoved")?.items).toEqual([
      {
        id: "project:hook:claude-code:Stop-all-tools-002-001",
        kind: "hook",
        scope: "project",
        agentId: "claude-code",
        name: "Stop-all-tools-002-001"
      }
    ]);
  });

  it("removes stale split hook items when the selected event no longer exists locally", async () => {
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
    const traces: Array<{ event: string; [key: string]: unknown }> = [];
    target.ctx.trace = async (record) => {
      traces.push(record);
    };

    const result = await uploadBundle(target.ctx, {
      profile: "default",
      scope: "project",
      agent: "claude-code",
      hooks: ["Stop"],
      yes: true
    });

    const record = await gistClient.read("gist-default");
    const manifest = parseManifest(record.files["agent-stash.json"]!.content);
    expect(result.uploaded).toEqual([]);
    expect(manifest.items).toEqual([]);
    expect(record.files[gistFilenameForBundlePath("hooks/project/claude-code/Stop-all-tools-001-001.json")]).toBeUndefined();
    expect(record.files[gistFilenameForBundlePath("hooks/project/claude-code/Stop-all-tools-002-001.json")]).toBeUndefined();
    expect(traces.find((record) => record.event === "upload.staleHookSplitsRemoved")?.items).toEqual([
      {
        id: "project:hook:claude-code:Stop-all-tools-001-001",
        kind: "hook",
        scope: "project",
        agentId: "claude-code",
        name: "Stop-all-tools-001-001"
      },
      {
        id: "project:hook:claude-code:Stop-all-tools-002-001",
        kind: "hook",
        scope: "project",
        agentId: "claude-code",
        name: "Stop-all-tools-002-001"
      }
    ]);
  });

  it("does not fail successful uploads when GitHub returns a sparse write response", async () => {
    class SparseWriteResponseGistClient extends InMemoryGistClient {
      override async update(gistId: string, input: Parameters<InMemoryGistClient["update"]>[1]) {
        const updated = await super.update(gistId, input);
        return { ...updated, files: {} };
      }
    }
    const gistClient = new SparseWriteResponseGistClient();
    gistClient.seed({ id: "gist-default", htmlUrl: "https://gist.github.com/gist-default", files: {} });
    const { ctx } = createContext(createDummyAgentConfigFixture(), gistClient);

    const result = await uploadBundle(ctx, {
      profile: "default",
      scope: "project",
      agent: "claude-code",
      skills: ["code-review"],
      yes: true
    });

    const stored = await gistClient.read("gist-default");
    expect(result.uploaded.map((item) => item.id)).toEqual(["project:skill:claude-code:code-review"]);
    expect(result.manifest.items.map((item) => item.id)).toEqual(["project:skill:claude-code:code-review"]);
    expect(stored.files["agent-stash.json"]?.content).toContain("code-review");
  });

  it("downloads remote skills and deep-merges hook fragments without dropping unrelated settings", async () => {
    const gistClient = new InMemoryGistClient();
    const source = createContext(createDummyAgentConfigFixture(), gistClient);
    await uploadBundle(source.ctx, {
      profile: "default",
      scope: "project",
      agent: "claude-code",
      skills: ["code-review"],
      hooks: ["PreToolUse"],
      yes: true
    });
    const files = createDummyAgentConfigFixture();
    delete files["/repo/.claude/skills/code-review/SKILL.md"];
    files["/repo/.claude/settings.json"] = JSON.stringify({ model: "keep" }, null, 2);
    const target = createContext(files, gistClient);

    const result = await downloadBundle(target.ctx, {
      profile: "default",
      scope: "project",
      agent: "claude-code",
      yes: true
    });

    expect(result.downloaded.map((item) => item.id)).toEqual([
      "project:hook:claude-code:PreToolUse-Bash-001-001",
      "project:skill:claude-code:code-review"
    ]);
    expect(target.volume.readFileSync("/repo/.claude/skills/code-review/SKILL.md", "utf8")).toBe("# Code Review\n");
    const settings = JSON.parse(target.volume.readFileSync("/repo/.claude/settings.json", "utf8") as string) as {
      model?: string;
      hooks?: Record<string, unknown>;
    };
    expect(settings.model).toBe("keep");
    expect(settings.hooks?.PreToolUse).toBeDefined();
    expect(result.backupId).toMatch(/^backup-/);
  });

  it("downloads exact hook fragments without overwriting unrelated same-event local groups", async () => {
    const sourceFiles = {
      ...createDummyAgentConfigFixture(),
      "/repo/.claude/settings.json": JSON.stringify({
        hooks: {
          PreToolUse: [{
            matcher: "Bash",
            hooks: [{ type: "command", command: "remote pretooluse" }]
          }]
        }
      }, null, 2)
    };
    const gistClient = new InMemoryGistClient();
    const source = createContext(sourceFiles, gistClient);
    await uploadBundle(source.ctx, {
      profile: "default",
      scope: "project",
      agent: "claude-code",
      hooks: ["PreToolUse"],
      yes: true
    });
    const targetFiles = {
      ...createDummyAgentConfigFixture(),
      "/repo/.claude/settings.json": JSON.stringify({
        hooks: {
          PreToolUse: [{
            matcher: "Bash(agent-stash-preserve-existing)",
            hooks: [{ type: "command", command: "local pretooluse" }]
          }]
        }
      }, null, 2)
    };
    const target = createContext(targetFiles, gistClient);

    await downloadBundle(target.ctx, {
      profile: "default",
      scope: "project",
      agent: "claude-code",
      hooks: ["PreToolUse-Bash-001-001"],
      yes: true
    });

    const settings = JSON.parse(target.volume.readFileSync("/repo/.claude/settings.json", "utf8") as string) as {
      hooks?: { PreToolUse?: Array<{ matcher?: string; hooks?: Array<{ command?: string }> }> };
    };
    expect(settings.hooks?.PreToolUse?.map((group) => ({
      matcher: group.matcher,
      commands: group.hooks?.map((hook) => hook.command)
    }))).toEqual([
      { matcher: "Bash", commands: ["remote pretooluse"] },
      { matcher: "Bash(agent-stash-preserve-existing)", commands: ["local pretooluse"] }
    ]);
  });

  it("replaces local hook event groups during event-level filtered download", async () => {
    const sourceFiles = {
      ...createDummyAgentConfigFixture(),
      "/repo/.claude/settings.json": JSON.stringify({
        hooks: {
          PreToolUse: [
            {
              matcher: "EnterPlanMode",
              hooks: [{ type: "command", command: "remote enter plan" }]
            },
            {
              matcher: "AskUserQuestion",
              hooks: [{ type: "command", command: "remote ask user" }]
            },
            {
              matcher: "Bash",
              hooks: [
                { type: "command", command: "remote bash first" },
                { type: "command", command: "remote bash second" }
              ]
            }
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
      hooks: ["PreToolUse"],
      yes: true
    });
    const targetFiles = {
      ...createDummyAgentConfigFixture(),
      "/repo/.claude/settings.json": JSON.stringify({
        env: {
          KEEP: "yes"
        },
        statusLine: {
          type: "command",
          command: "echo local-status"
        },
        hooks: {
          PreToolUse: [
            {
              matcher: "Bash",
              hooks: [{ type: "command", command: "local pretooluse sentinel" }]
            }
          ],
          Stop: [
            {
              hooks: [{ type: "command", command: "local stop sentinel" }]
            }
          ]
        }
      }, null, 2)
    };
    const target = createContext(targetFiles, gistClient);

    await downloadBundle(target.ctx, {
      profile: "default",
      scope: "project",
      agent: "claude-code",
      hooks: ["PreToolUse"],
      yes: true
    });

    const settings = JSON.parse(target.volume.readFileSync("/repo/.claude/settings.json", "utf8") as string) as {
      env?: { KEEP?: string };
      statusLine?: { command?: string };
      hooks?: Record<string, Array<{ matcher?: string; hooks?: Array<{ command?: string }> }>>;
    };
    expect(settings.env?.KEEP).toBe("yes");
    expect(settings.statusLine?.command).toBe("echo local-status");
    expect(settings.hooks?.Stop?.[0]?.hooks?.[0]?.command).toBe("local stop sentinel");
    expect(settings.hooks?.PreToolUse?.map((group) => ({
      matcher: group.matcher,
      commands: group.hooks?.map((hook) => hook.command)
    }))).toEqual([
      { matcher: "EnterPlanMode", commands: ["remote enter plan"] },
      { matcher: "AskUserQuestion", commands: ["remote ask user"] },
      { matcher: "Bash", commands: ["remote bash first", "remote bash second"] }
    ]);
  });

  it("replaces local hook event groups during full download", async () => {
    const sourceFiles = {
      ...createDummyAgentConfigFixture(),
      "/repo/.claude/settings.json": JSON.stringify({
        hooks: {
          PreToolUse: [
            {
              matcher: "EnterPlanMode",
              hooks: [{ type: "command", command: "remote enter plan" }]
            },
            {
              matcher: "AskUserQuestion",
              hooks: [{ type: "command", command: "remote ask user" }]
            },
            {
              matcher: "Bash",
              hooks: [
                { type: "command", command: "remote bash first" },
                { type: "command", command: "remote bash second" }
              ]
            }
          ],
          Stop: [
            {
              hooks: [{ type: "command", command: "remote stop" }]
            }
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
      hooks: ["PreToolUse", "Stop"],
      yes: true
    });
    const targetFiles = {
      ...createDummyAgentConfigFixture(),
      "/repo/.claude/settings.json": JSON.stringify({
        env: {
          KEEP: "yes"
        },
        hooks: {
          PreToolUse: [
            {
              matcher: "Bash",
              hooks: [{ type: "command", command: "local pretooluse sentinel" }]
            }
          ],
          UserPromptSubmit: [
            {
              hooks: [{ type: "command", command: "local userprompt sentinel" }]
            }
          ]
        }
      }, null, 2)
    };
    const target = createContext(targetFiles, gistClient);

    await downloadBundle(target.ctx, {
      profile: "default",
      scope: "project",
      agent: "claude-code",
      yes: true
    });

    const settings = JSON.parse(target.volume.readFileSync("/repo/.claude/settings.json", "utf8") as string) as {
      env?: { KEEP?: string };
      hooks?: Record<string, Array<{ matcher?: string; hooks?: Array<{ command?: string }> }>>;
    };
    expect(settings.env?.KEEP).toBe("yes");
    expect(settings.hooks?.UserPromptSubmit?.[0]?.hooks?.[0]?.command).toBe("local userprompt sentinel");
    expect(settings.hooks?.Stop?.map((group) => group.hooks?.map((hook) => hook.command))).toEqual([
      ["remote stop"]
    ]);
    expect(settings.hooks?.PreToolUse?.map((group) => ({
      matcher: group.matcher,
      commands: group.hooks?.map((hook) => hook.command)
    }))).toEqual([
      { matcher: "EnterPlanMode", commands: ["remote enter plan"] },
      { matcher: "AskUserQuestion", commands: ["remote ask user"] },
      { matcher: "Bash", commands: ["remote bash first", "remote bash second"] }
    ]);
  });

  it("backs up a hook settings file once when downloading multiple hook fragments", async () => {
    const sourceFiles = {
      ...createDummyAgentConfigFixture(),
      "/repo/.claude/settings.json": JSON.stringify({
        hooks: {
          PostToolUse: [
            {
              matcher: "Write|Edit",
              hooks: [
                { type: "command", command: "remote first" },
                { type: "command", command: "remote second" }
              ]
            }
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
      hooks: ["PostToolUse"],
      yes: true
    });
    const targetFiles = {
      ...createDummyAgentConfigFixture(),
      "/repo/.claude/settings.json": JSON.stringify({
        hooks: {
          PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "local hook" }] }]
        }
      }, null, 2)
    };
    const target = createContext(targetFiles, gistClient);

    const result = await downloadBundle(target.ctx, {
      profile: "default",
      scope: "project",
      agent: "claude-code",
      hooks: ["PostToolUse"],
      yes: true
    });

    const backup = JSON.parse(target.volume.readFileSync(`/home/user/.agent-stash/backups/${result.backupId}/backup.json`, "utf8") as string) as {
      affectedPaths?: string[];
      files?: Array<{ sourcePath?: string }>;
    };
    expect(result.downloaded.map((item) => item.name)).toEqual([
      "PostToolUse-Write-Edit-001-001",
      "PostToolUse-Write-Edit-001-002"
    ]);
    expect(backup.affectedPaths).toEqual(["/repo/.claude/settings.json"]);
    expect(backup.files?.map((file) => file.sourcePath)).toEqual(["/repo/.claude/settings.json"]);
  });

  it("writes a profile baseline after downloading through a profile", async () => {
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

    await downloadBundle(target.ctx, {
      profile: "default",
      scope: "project",
      agent: "claude-code",
      skills: ["code-review"],
      yes: true
    });

    const baseline = parseManifest(target.volume.readFileSync("/home/user/.agent-stash/cache/default.manifest.json", "utf8") as string);
    expect(baseline.items.map((item) => item.id)).toEqual(["project:skill:claude-code:code-review"]);
  });

  it("downloads one hook command into an untracked event by updating the matching local split position", async () => {
    const sourceFiles = {
      ...createDummyAgentConfigFixture(),
      "/repo/.claude/settings.json": JSON.stringify({
        hooks: {
          PostToolUse: [
            {
              matcher: "Write|Edit",
              hooks: [
                { type: "command", command: "remote first" },
                { type: "command", command: "remote second" }
              ]
            }
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
      hooks: ["PostToolUse-Write-Edit-001-002"],
      yes: true
    });
    const targetFiles = {
      ...createDummyAgentConfigFixture(),
      "/repo/.claude/settings.json": JSON.stringify({
        model: "keep",
        hooks: {
          PostToolUse: [
            {
              matcher: "Write|Edit",
              hooks: [
                { type: "command", command: "local first" },
                { type: "command", command: "local second" },
                { type: "command", command: "local third" }
              ]
            }
          ]
        }
      }, null, 2)
    };
    const target = createContext(targetFiles, gistClient);

    await downloadBundle(target.ctx, {
      profile: "default",
      scope: "project",
      agent: "claude-code",
      hooks: ["PostToolUse-Write-Edit-001-002"],
      yes: true
    });

    const settings = JSON.parse(target.volume.readFileSync("/repo/.claude/settings.json", "utf8") as string) as {
      model?: string;
      hooks?: { PostToolUse?: Array<{ matcher?: string; hooks?: Array<{ command?: string }> }> };
    };
    expect(settings.model).toBe("keep");
    expect(settings.hooks?.PostToolUse?.[0]?.hooks?.map((hook) => hook.command)).toEqual([
      "local first",
      "remote second",
      "local third"
    ]);
  });

  it("updates a previously downloaded hook command in place", async () => {
    const sourceFiles = {
      ...createDummyAgentConfigFixture(),
      "/repo/.claude/settings.json": JSON.stringify({
        hooks: {
          PostToolUse: [
            {
              matcher: "Write|Edit",
              hooks: [
                { type: "command", command: "remote first" }
              ]
            }
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
      hooks: ["PostToolUse-Write-Edit-001-001"],
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
      hooks: ["PostToolUse-Write-Edit-001-001"],
      yes: true
    });

    source.volume.writeFileSync("/repo/.claude/settings.json", JSON.stringify({
      hooks: {
        PostToolUse: [
          {
            matcher: "Write|Edit",
            hooks: [
              { type: "command", command: "remote changed" }
            ]
          }
        ]
      }
    }, null, 2));
    await uploadBundle(source.ctx, {
      profile: "default",
      scope: "project",
      agent: "claude-code",
      hooks: ["PostToolUse-Write-Edit-001-001"],
      yes: true
    });
    await downloadBundle(target.ctx, {
      profile: "default",
      scope: "project",
      agent: "claude-code",
      hooks: ["PostToolUse-Write-Edit-001-001"],
      yes: true
    });

    const settings = JSON.parse(target.volume.readFileSync("/repo/.claude/settings.json", "utf8") as string) as {
      hooks?: { PostToolUse?: Array<{ hooks?: Array<{ command?: string }> }> };
    };
    expect(settings.hooks?.PostToolUse?.[0]?.hooks?.map((hook) => hook.command)).toEqual(["remote changed"]);
  });

  it("replaces a same-position local split hook when downloading one fragment without origin metadata", async () => {
    const files = {
      ...createDummyAgentConfigFixture(),
      "/repo/.claude/settings.json": JSON.stringify({
        hooks: {
          PostToolUse: [
            {
              matcher: "Write|Edit",
              hooks: [
                { type: "command", command: "local first" },
                { type: "command", command: "local second" }
              ]
            }
          ]
        }
      }, null, 2)
    };
    const gistClient = new InMemoryGistClient();
    const source = createContext(files, gistClient);
    await uploadBundle(source.ctx, {
      profile: "default",
      scope: "project",
      agent: "claude-code",
      hooks: ["PostToolUse"],
      yes: true
    });
    const record = await gistClient.read("gist-default");
    updateRemoteHookFragment(record, "hooks/project/claude-code/PostToolUse-Write-Edit-001-002.json", {
      agentStash: { hookEvent: "PostToolUse", groupIndex: 0, hookIndex: 1 },
      hooks: {
        PostToolUse: [
          {
            matcher: "Write|Edit",
            hooks: [{ type: "command", command: "remote changed second" }]
          }
        ]
      }
    });
    gistClient.seed(record);

    await downloadBundle(source.ctx, {
      profile: "default",
      scope: "project",
      agent: "claude-code",
      hooks: ["PostToolUse-Write-Edit-001-002"],
      yes: true
    });

    const settings = JSON.parse(source.volume.readFileSync("/repo/.claude/settings.json", "utf8") as string) as {
      hooks?: { PostToolUse?: Array<{ hooks?: Array<{ command?: string }> }> };
    };
    expect(settings.hooks?.PostToolUse?.[0]?.hooks?.map((hook) => hook.command)).toEqual([
      "local first",
      "remote changed second"
    ]);
  });

  it("updates an existing same-identity split hook without duplicating it when downloading into current hooks", async () => {
    const sourceFiles = {
      ...createDummyAgentConfigFixture(),
      "/repo/.claude/settings.json": JSON.stringify({
        hooks: {
          Stop: [
            { hooks: [{ type: "command", command: "remote changed first stop" }] }
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
      hooks: ["Stop-all-tools-001-001"],
      yes: true
    });
    const targetFiles = {
      ...createDummyAgentConfigFixture(),
      "/repo/.claude/settings.json": JSON.stringify({
        hooks: {
          Stop: [
            { hooks: [{ type: "command", command: "local original first stop" }] },
            { hooks: [{ type: "command", command: "local second stop" }] }
          ],
          UserPromptSubmit: [
            { hooks: [{ type: "command", command: "local prompt" }] }
          ]
        }
      }, null, 2)
    };
    const target = createContext(targetFiles, gistClient);

    await downloadBundle(target.ctx, {
      profile: "default",
      scope: "project",
      agent: "claude-code",
      hooks: ["Stop-all-tools-001-001"],
      yes: true
    });

    const settings = JSON.parse(target.volume.readFileSync("/repo/.claude/settings.json", "utf8") as string) as {
      hooks?: {
        Stop?: Array<{ hooks?: Array<{ command?: string }> }>;
        UserPromptSubmit?: Array<{ hooks?: Array<{ command?: string }> }>;
      };
    };
    expect(settings.hooks?.Stop?.map((group) => group.hooks?.map((hook) => hook.command))).toEqual([
      ["remote changed first stop"],
      ["local second stop"]
    ]);
    expect(settings.hooks?.UserPromptSubmit?.[0]?.hooks?.map((hook) => hook.command)).toEqual(["local prompt"]);
  });

  it("downloads one hook command by replacing the matching same-index local split hook", async () => {
    const sourceFiles = {
      ...createDummyAgentConfigFixture(),
      "/repo/.claude/settings.json": JSON.stringify({
        hooks: {
          PostToolUse: [
            {
              matcher: "Write|Edit",
              hooks: [
                { type: "command", command: "remote first" }
              ]
            }
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
      hooks: ["PostToolUse-Write-Edit-001-001"],
      yes: true
    });
    const targetFiles = {
      ...createDummyAgentConfigFixture(),
      "/repo/.claude/settings.json": JSON.stringify({
        hooks: {
          PostToolUse: [
            {
              matcher: "Write|Edit",
              hooks: [
                { type: "command", command: "local sentinel" }
              ]
            }
          ]
        }
      }, null, 2)
    };
    const target = createContext(targetFiles, gistClient);

    await downloadBundle(target.ctx, {
      profile: "default",
      scope: "project",
      agent: "claude-code",
      hooks: ["PostToolUse-Write-Edit-001-001"],
      yes: true
    });

    const settings = JSON.parse(target.volume.readFileSync("/repo/.claude/settings.json", "utf8") as string) as {
      hooks?: { PostToolUse?: Array<{ matcher?: string; hooks?: Array<{ command?: string }> }> };
    };
    expect(settings.hooks?.PostToolUse?.[0]?.hooks?.map((hook) => hook.command)).toEqual(["remote first"]);
  });

  it("downloads one later hook command into an empty local group without placeholder hooks", async () => {
    const sourceFiles = {
      ...createDummyAgentConfigFixture(),
      "/repo/.claude/settings.json": JSON.stringify({
        hooks: {
          PostToolUse: [
            {
              matcher: "Write|Edit",
              hooks: [
                { type: "command", command: "remote first" },
                { type: "command", command: "remote second" }
              ]
            }
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
      hooks: ["PostToolUse-Write-Edit-001-002"],
      yes: true
    });
    const targetFiles = {
      ...createDummyAgentConfigFixture(),
      "/repo/.claude/settings.json": JSON.stringify({
        model: "keep",
        hooks: {
          Stop: [{ hooks: [{ type: "command", command: "local stop" }] }]
        }
      }, null, 2)
    };
    const target = createContext(targetFiles, gistClient);

    await downloadBundle(target.ctx, {
      profile: "default",
      scope: "project",
      agent: "claude-code",
      hooks: ["PostToolUse-Write-Edit-001-002"],
      yes: true
    });

    const settings = JSON.parse(target.volume.readFileSync("/repo/.claude/settings.json", "utf8") as string) as {
      model?: string;
      hooks?: { PostToolUse?: Array<{ matcher?: string; hooks?: Array<{ command?: string }> }> };
    };
    expect(settings.model).toBe("keep");
    expect(settings.hooks?.PostToolUse?.[0]?.hooks).toEqual([
      { type: "command", command: "remote second" }
    ]);
  });

  it("preserves a later same-matcher hook group when an earlier group is downloaded afterward", async () => {
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
      "/repo/.claude/settings.json": JSON.stringify({
        hooks: {}
      }, null, 2)
    };
    const target = createContext(targetFiles, gistClient);

    await downloadBundle(target.ctx, {
      profile: "default",
      scope: "project",
      agent: "claude-code",
      hooks: ["Stop-all-tools-002-001"],
      yes: true
    });
    await downloadBundle(target.ctx, {
      profile: "default",
      scope: "project",
      agent: "claude-code",
      hooks: ["Stop-all-tools-001-001"],
      yes: true
    });

    const settings = JSON.parse(target.volume.readFileSync("/repo/.claude/settings.json", "utf8") as string) as {
      hooks?: { Stop?: Array<{ hooks?: Array<{ command?: string }> }> };
    };
    expect(settings.hooks?.Stop?.map((group) => group.hooks?.map((hook) => hook.command))).toEqual([
      ["remote first stop"],
      ["remote second stop"]
    ]);
  });

  it("preserves a later hook command in the same group when an earlier command is downloaded afterward", async () => {
    const sourceFiles = {
      ...createDummyAgentConfigFixture(),
      "/repo/.claude/settings.json": JSON.stringify({
        hooks: {
          SessionStart: [
            {
              hooks: [
                { type: "command", command: "remote first session" },
                { type: "command", command: "remote second session" }
              ]
            }
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
      hooks: ["SessionStart"],
      yes: true
    });
    const targetFiles = {
      ...createDummyAgentConfigFixture(),
      "/repo/.claude/settings.json": JSON.stringify({
        hooks: {}
      }, null, 2)
    };
    const target = createContext(targetFiles, gistClient);

    await downloadBundle(target.ctx, {
      profile: "default",
      scope: "project",
      agent: "claude-code",
      hooks: ["SessionStart-all-tools-001-002"],
      yes: true
    });
    await downloadBundle(target.ctx, {
      profile: "default",
      scope: "project",
      agent: "claude-code",
      hooks: ["SessionStart-all-tools-001-001"],
      yes: true
    });

    const settings = JSON.parse(target.volume.readFileSync("/repo/.claude/settings.json", "utf8") as string) as {
      hooks?: { SessionStart?: Array<{ hooks?: Array<{ command?: string }> }> };
    };
    expect(settings.hooks?.SessionStart?.[0]?.hooks?.map((hook) => hook.command)).toEqual([
      "remote first session",
      "remote second session"
    ]);
  });

  it("keeps the original split hook identity when uploading a later hook downloaded by itself", async () => {
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
      "/repo/.claude/settings.json": JSON.stringify({
        hooks: {}
      }, null, 2)
    };
    const target = createContext(targetFiles, gistClient);
    await downloadBundle(target.ctx, {
      profile: "default",
      scope: "project",
      agent: "claude-code",
      hooks: ["Stop-all-tools-002-001"],
      yes: true
    });
    const localSettings = JSON.parse(target.volume.readFileSync("/repo/.claude/settings.json", "utf8") as string) as {
      hooks: { Stop: Array<{ hooks: Array<{ command: string }> }> };
    };
    localSettings.hooks.Stop[0]!.hooks[0]!.command = "local changed second stop";
    target.volume.writeFileSync("/repo/.claude/settings.json", `${JSON.stringify(localSettings, null, 2)}\n`);

    const result = await uploadBundle(target.ctx, {
      profile: "default",
      scope: "project",
      agent: "claude-code",
      hooks: ["Stop-all-tools-002-001"],
      yes: true
    });

    const record = await gistClient.read("gist-default");
    const first = record.files[gistFilenameForBundlePath("hooks/project/claude-code/Stop-all-tools-001-001.json")]?.content;
    const second = record.files[gistFilenameForBundlePath("hooks/project/claude-code/Stop-all-tools-002-001.json")]?.content;
    expect(result.uploaded.map((item) => item.name)).toEqual(["Stop-all-tools-002-001"]);
    expect(first).toContain("remote first stop");
    expect(second).toContain("local changed second stop");
  });

  it("rejects hook fragments that modify a different hook event before writing", async () => {
    const gistClient = new InMemoryGistClient();
    const source = createContext(createDummyAgentConfigFixture(), gistClient);
    await uploadBundle(source.ctx, {
      profile: "default",
      scope: "project",
      agent: "claude-code",
      hooks: ["PreToolUse"],
      yes: true
    });
    const record = await gistClient.read("gist-default");
    const fragmentPath = "hooks/project/claude-code/PreToolUse-Bash-001-001.json";
    updateRemoteHookFragment(record, fragmentPath, {
      hooks: {
        PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "npm test" }] }],
        Stop: [{ hooks: [{ type: "command", command: "malicious" }] }]
      }
    });
    gistClient.seed(record);
    const files = createDummyAgentConfigFixture();
    const before = files["/repo/.claude/settings.json"];
    const target = createContext(files, gistClient);

    await expect(downloadBundle(target.ctx, {
      profile: "default",
      scope: "project",
      agent: "claude-code",
      yes: true
    })).rejects.toThrow("Hook fragment PreToolUse-Bash-001-001 cannot modify hook event Stop.");
    expect(target.volume.readFileSync("/repo/.claude/settings.json", "utf8")).toBe(before);
  });

  it("rejects hook fragments that omit their own hook event before writing", async () => {
    const gistClient = new InMemoryGistClient();
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
    const files = createDummyAgentConfigFixture();
    const before = files["/repo/.claude/settings.json"];
    const target = createContext(files, gistClient);

    await expect(downloadBundle(target.ctx, {
      profile: "default",
      scope: "project",
      agent: "claude-code",
      yes: true
    })).rejects.toThrow("Hook fragment PreToolUse-Bash-001-001 must contain hook event PreToolUse-Bash-001-001.");
    expect(target.volume.readFileSync("/repo/.claude/settings.json", "utf8")).toBe(before);
  });

  it("rejects malformed hook fragment JSON before writing", async () => {
    const gistClient = new InMemoryGistClient();
    const source = createContext(createDummyAgentConfigFixture(), gistClient);
    await uploadBundle(source.ctx, {
      profile: "default",
      scope: "project",
      agent: "claude-code",
      hooks: ["PreToolUse"],
      yes: true
    });
    const record = await gistClient.read("gist-default");
    updateRemoteHookFragmentContent(record, "hooks/project/claude-code/PreToolUse-Bash-001-001.json", "{");
    gistClient.seed(record);
    const files = createDummyAgentConfigFixture();
    const before = files["/repo/.claude/settings.json"];
    const target = createContext(files, gistClient);

    await expect(downloadBundle(target.ctx, {
      profile: "default",
      scope: "project",
      agent: "claude-code",
      yes: true
    })).rejects.toThrow("Malformed hook fragment for PreToolUse-Bash-001-001.");
    expect(target.volume.readFileSync("/repo/.claude/settings.json", "utf8")).toBe(before);
    expect(() => target.volume.statSync("/home/user/.agent-stash/backups")).toThrow();
  });

  it("rejects hook fragments whose own event is malformed before writing", async () => {
    const gistClient = new InMemoryGistClient();
    const source = createContext(createDummyAgentConfigFixture(), gistClient);
    await uploadBundle(source.ctx, {
      profile: "default",
      scope: "project",
      agent: "claude-code",
      hooks: ["PreToolUse"],
      yes: true
    });
    const record = await gistClient.read("gist-default");
    updateRemoteHookFragment(record, "hooks/project/claude-code/PreToolUse-Bash-001-001.json", {
      hooks: { PreToolUse: { matcher: "Bash" } }
    });
    gistClient.seed(record);
    const files = createDummyAgentConfigFixture();
    const before = files["/repo/.claude/settings.json"];
    const target = createContext(files, gistClient);

    await expect(downloadBundle(target.ctx, {
      profile: "default",
      scope: "project",
      agent: "claude-code",
      yes: true
    })).rejects.toThrow("Malformed hook fragment for PreToolUse-Bash-001-001.");
    expect(target.volume.readFileSync("/repo/.claude/settings.json", "utf8")).toBe(before);
  });

  it("rejects hook fragments that are not objects before writing", async () => {
    const gistClient = new InMemoryGistClient();
    const source = createContext(createDummyAgentConfigFixture(), gistClient);
    await uploadBundle(source.ctx, {
      profile: "default",
      scope: "project",
      agent: "claude-code",
      hooks: ["PreToolUse"],
      yes: true
    });
    const record = await gistClient.read("gist-default");
    updateRemoteHookFragment(record, "hooks/project/claude-code/PreToolUse-Bash-001-001.json", null);
    gistClient.seed(record);
    const files = createDummyAgentConfigFixture();
    const before = files["/repo/.claude/settings.json"];
    const target = createContext(files, gistClient);

    await expect(downloadBundle(target.ctx, {
      profile: "default",
      scope: "project",
      agent: "claude-code",
      yes: true
    })).rejects.toThrow("Malformed hook fragment for PreToolUse-Bash-001-001.");
    expect(target.volume.readFileSync("/repo/.claude/settings.json", "utf8")).toBe(before);
    expect(() => target.volume.statSync("/home/user/.agent-stash/backups")).toThrow();
  });

  it("rejects malformed existing hook config before creating a backup", async () => {
    const gistClient = new InMemoryGistClient();
    const source = createContext(createDummyAgentConfigFixture(), gistClient);
    await uploadBundle(source.ctx, {
      profile: "default",
      scope: "project",
      agent: "claude-code",
      hooks: ["PreToolUse"],
      yes: true
    });
    const files = createDummyAgentConfigFixture();
    files["/repo/.claude/settings.json"] = "{";
    const target = createContext(files, gistClient);

    await expect(downloadBundle(target.ctx, {
      profile: "default",
      scope: "project",
      agent: "claude-code",
      yes: true
    })).rejects.toThrow();

    expect(target.volume.readFileSync("/repo/.claude/settings.json", "utf8")).toBe("{");
    expect(() => target.volume.statSync("/home/user/.agent-stash/backups")).toThrow();
  });

  it("rejects existing hook configs with malformed hooks before creating a backup", async () => {
    const gistClient = new InMemoryGistClient();
    const source = createContext(createDummyAgentConfigFixture(), gistClient);
    await uploadBundle(source.ctx, {
      profile: "default",
      scope: "project",
      agent: "claude-code",
      hooks: ["PreToolUse"],
      yes: true
    });
    const files = createDummyAgentConfigFixture();
    const malformedSettings = `${JSON.stringify({ hooks: [] }, null, 2)}\n`;
    files["/repo/.claude/settings.json"] = malformedSettings;
    const target = createContext(files, gistClient);

    await expect(downloadBundle(target.ctx, {
      profile: "default",
      scope: "project",
      agent: "claude-code",
      yes: true
    })).rejects.toThrow("Malformed hooks in /repo/.claude/settings.json");

    expect(target.volume.readFileSync("/repo/.claude/settings.json", "utf8")).toBe(malformedSettings);
    expect(() => target.volume.statSync("/home/user/.agent-stash/backups")).toThrow();
  });

  it("replaces local skill directories so stale files are removed on download", async () => {
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
    files["/repo/.claude/skills/code-review/OLD.md"] = "stale\n";
    const target = createContext(files, gistClient);

    await downloadBundle(target.ctx, {
      profile: "default",
      scope: "project",
      agent: "claude-code",
      yes: true
    });

    expect(target.volume.readFileSync("/repo/.claude/skills/code-review/SKILL.md", "utf8")).toBe("# Code Review\n");
    expect(() => target.volume.statSync("/repo/.claude/skills/code-review/OLD.md")).toThrow();
  });

  it("rejects replacing existing skill directories before backup when fs.rm is unavailable", async () => {
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
    files["/repo/.claude/skills/code-review/OLD.md"] = "stale\n";
    const target = createContext(files, gistClient);
    target.ctx.fs.rm = undefined;

    await expect(downloadBundle(target.ctx, {
      profile: "default",
      scope: "project",
      agent: "claude-code",
      yes: true
    })).rejects.toThrow("Filesystem rm support is required to replace skill directory: /repo/.claude/skills/code-review");

    expect(target.volume.readFileSync("/repo/.claude/skills/code-review/SKILL.md", "utf8")).toBe("# Code Review\n");
    expect(target.volume.readFileSync("/repo/.claude/skills/code-review/OLD.md", "utf8")).toBe("stale\n");
    expect(() => target.volume.statSync("/home/user/.agent-stash/backups")).toThrow();
  });

  it("refuses to download through a symlinked skill parent directory", async () => {
    const gistClient = new InMemoryGistClient();
    const source = createContext(createDummyAgentConfigFixture(), gistClient);
    await uploadBundle(source.ctx, {
      profile: "default",
      scope: "project",
      agent: "claude-code",
      skills: ["code-review"],
      yes: true
    });
    const target = createContext({
      "/home/user/.agent-stash/config.json": JSON.stringify({ profiles: { default: { gistId: "gist-default" } } }, null, 2)
    }, gistClient);
    target.volume.mkdirSync("/repo/.claude", { recursive: true });
    target.volume.mkdirSync("/outside/skills", { recursive: true });
    target.volume.symlinkSync("/outside/skills", "/repo/.claude/skills");

    await expect(downloadBundle(target.ctx, {
      profile: "default",
      scope: "project",
      agent: "claude-code",
      yes: true
    })).rejects.toThrow("Refusing to write through symbolic link: /repo/.claude/skills");

    expect(() => target.volume.statSync("/outside/skills/code-review/SKILL.md")).toThrow();
  });

  it("rejects corrupted remote file contents before writing downloads", async () => {
    const gistClient = new InMemoryGistClient();
    const source = createContext(createDummyAgentConfigFixture(), gistClient);
    await uploadBundle(source.ctx, {
      profile: "default",
      scope: "project",
      agent: "claude-code",
      skills: ["code-review"],
      yes: true
    });
    const record = await gistClient.read("gist-default");
    const encodedPath = gistFilenameForBundlePath("skills/project/claude-code/code-review/SKILL.md");
    record.files[encodedPath] = {
      filename: encodedPath,
      content: "# Corrupted Remote\n"
    };
    gistClient.seed(record);
    const files = createDummyAgentConfigFixture();
    files["/repo/.claude/skills/code-review/SKILL.md"] = "# Existing Local\n";
    const target = createContext(files, gistClient);

    await expect(downloadBundle(target.ctx, {
      profile: "default",
      scope: "project",
      agent: "claude-code",
      yes: true
    })).rejects.toThrow(/hash mismatch/);
    expect(target.volume.readFileSync("/repo/.claude/skills/code-review/SKILL.md", "utf8")).toBe("# Existing Local\n");
  });

  it("rejects duplicate decoded remote bundle paths before writing downloads", async () => {
    const gistClient = new InMemoryGistClient();
    const source = createContext(createDummyAgentConfigFixture(), gistClient);
    await uploadBundle(source.ctx, {
      profile: "default",
      scope: "project",
      agent: "claude-code",
      skills: ["code-review"],
      yes: true
    });
    const record = await gistClient.read("gist-default");
    const bundlePath = "skills/project/claude-code/code-review/SKILL.md";
    record.files[bundlePath] = {
      filename: bundlePath,
      content: "# Shadow Copy\n"
    };
    gistClient.seed(record);
    const files = createDummyAgentConfigFixture();
    files["/repo/.claude/skills/code-review/SKILL.md"] = "# Existing Local\n";
    const target = createContext(files, gistClient);

    await expect(downloadBundle(target.ctx, {
      profile: "default",
      scope: "project",
      agent: "claude-code",
      yes: true
    })).rejects.toThrow(`Duplicate Gist bundle path: ${bundlePath}`);
    expect(target.volume.readFileSync("/repo/.claude/skills/code-review/SKILL.md", "utf8")).toBe("# Existing Local\n");
    expect(() => target.volume.statSync("/home/user/.agent-stash/backups")).toThrow();
  });

  it("rejects invalid encoded remote filenames before writing downloads", async () => {
    const gistClient = new InMemoryGistClient();
    const source = createContext(createDummyAgentConfigFixture(), gistClient);
    await uploadBundle(source.ctx, {
      profile: "default",
      scope: "project",
      agent: "claude-code",
      skills: ["code-review"],
      yes: true
    });
    const invalidFilename = "%E0%A4%A";
    const record = await gistClient.read("gist-default");
    record.files[invalidFilename] = {
      filename: invalidFilename,
      content: "invalid\n"
    };
    gistClient.seed(record);
    const files = createDummyAgentConfigFixture();
    files["/repo/.claude/skills/code-review/SKILL.md"] = "# Existing Local\n";
    const target = createContext(files, gistClient);

    await expect(downloadBundle(target.ctx, {
      profile: "default",
      scope: "project",
      agent: "claude-code",
      yes: true
    })).rejects.toThrow(`Invalid encoded Gist filename: ${invalidFilename}`);
    expect(target.volume.readFileSync("/repo/.claude/skills/code-review/SKILL.md", "utf8")).toBe("# Existing Local\n");
    expect(() => target.volume.statSync("/home/user/.agent-stash/backups")).toThrow();
  });

  it("rejects malformed remote manifests before writing downloads", async () => {
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
    files["/repo/.claude/skills/code-review/SKILL.md"] = "# Existing Local\n";
    const target = createContext(files, gistClient);

    await expect(downloadBundle(target.ctx, {
      profile: "default",
      scope: "project",
      agent: "claude-code",
      yes: true
    })).rejects.toThrow("Malformed agent-stash manifest.");

    expect(target.volume.readFileSync("/repo/.claude/skills/code-review/SKILL.md", "utf8")).toBe("# Existing Local\n");
    expect(gistClient.updateCalls).toHaveLength(0);
    expect(() => target.volume.statSync("/home/user/.agent-stash/backups")).toThrow();
  });

  it("rejects untracked remote bundle files before writing downloads", async () => {
    const gistClient = new InMemoryGistClient();
    const source = createContext(createDummyAgentConfigFixture(), gistClient);
    await uploadBundle(source.ctx, {
      profile: "default",
      scope: "project",
      agent: "claude-code",
      skills: ["code-review"],
      yes: true
    });
    const record = await gistClient.read("gist-default");
    const extraPath = "skills/project/claude-code/code-review/extra.md";
    const extraGistPath = gistFilenameForBundlePath(extraPath);
    record.files[extraGistPath] = {
      filename: extraGistPath,
      content: "extra\n"
    };
    gistClient.seed(record);
    const files = createDummyAgentConfigFixture();
    files["/repo/.claude/skills/code-review/SKILL.md"] = "# Existing Local\n";
    const target = createContext(files, gistClient);

    await expect(downloadBundle(target.ctx, {
      profile: "default",
      scope: "project",
      agent: "claude-code",
      yes: true
    })).rejects.toThrow(`Remote bundle contains untracked file ${extraPath}`);
    expect(target.volume.readFileSync("/repo/.claude/skills/code-review/SKILL.md", "utf8")).toBe("# Existing Local\n");
    expect(() => target.volume.statSync("/home/user/.agent-stash/backups")).toThrow();
  });

  it("downloads by raw Gist id without a stored profile", async () => {
    const gistClient = new InMemoryGistClient();
    const source = createContext(createDummyAgentConfigFixture(), gistClient);
    await uploadBundle(source.ctx, {
      gist: "gist-default",
      scope: "project",
      agent: "claude-code",
      skills: ["code-review"],
      yes: true
    });
    const files = createDummyAgentConfigFixture();
    delete files["/repo/.claude/skills/code-review/SKILL.md"];
    delete files["/home/user/.agent-stash/config.json"];
    const target = createContext(files, gistClient);

    const result = await downloadBundle(target.ctx, {
      gist: "gist-default",
      scope: "project",
      agent: "claude-code",
      yes: true
    });

    expect(result.downloaded.map((item) => item.id)).toEqual(["project:skill:claude-code:code-review"]);
    expect(target.volume.readFileSync("/repo/.claude/skills/code-review/SKILL.md", "utf8")).toBe("# Code Review\n");
  });

  it("does not rewrite profile config when downloading through an explicit Gist override", async () => {
    const gistClient = new InMemoryGistClient();
    gistClient.seed({ id: "gist-default", htmlUrl: "https://gist.github.com/gist-default", files: {} });
    gistClient.seed({ id: "gist-other", htmlUrl: "https://gist.github.com/gist-other", files: {} });
    const source = createContext(createDummyAgentConfigFixture(), gistClient);
    await uploadBundle(source.ctx, {
      gist: "gist-other",
      scope: "project",
      agent: "claude-code",
      skills: ["project-only"],
      yes: true
    });
    const files = createDummyAgentConfigFixture();
    delete files["/repo/.claude/skills/project-only/SKILL.md"];
    const target = createContext(files, gistClient);

    const result = await downloadBundle(target.ctx, {
      profile: "default",
      gist: "gist-other",
      scope: "project",
      agent: "claude-code",
      skills: ["project-only"],
      yes: true
    });

    const config = JSON.parse(target.volume.readFileSync("/home/user/.agent-stash/config.json", "utf8") as string) as unknown;
    expect(result.downloaded.map((item) => item.id)).toEqual(["project:skill:claude-code:project-only"]);
    expect(config).toEqual({ profiles: { default: { gistId: "gist-default" } } });
  });

  it("downloads only explicitly selected skills", async () => {
    const gistClient = new InMemoryGistClient();
    const source = createContext(createDummyAgentConfigFixture(), gistClient);
    await uploadBundle(source.ctx, {
      profile: "default",
      scope: "project",
      agent: "claude-code",
      skills: ["code-review", "commit-helper"],
      yes: true
    });
    const files = createDummyAgentConfigFixture();
    delete files["/repo/.claude/skills/code-review/SKILL.md"];
    delete files["/repo/.claude/skills/commit-helper/SKILL.md"];
    const target = createContext(files, gistClient);

    const result = await downloadBundle(target.ctx, {
      profile: "default",
      scope: "project",
      agent: "claude-code",
      skills: ["code-review"],
      yes: true
    });

    expect(result.downloaded.map((item) => item.id)).toEqual(["project:skill:claude-code:code-review"]);
    expect(target.volume.readFileSync("/repo/.claude/skills/code-review/SKILL.md", "utf8")).toBe("# Code Review\n");
    expect(() => target.volume.statSync("/repo/.claude/skills/commit-helper/SKILL.md")).toThrow();
  });

  it("rejects selected remote download skills that are ignored locally before writing", async () => {
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

    await expect(downloadBundle(target.ctx, {
      profile: "default",
      scope: "project",
      agent: "claude-code",
      skills: ["code-review"],
      yes: true
    })).rejects.toThrow("Selected skill not found: code-review");

    expect(() => target.volume.statSync("/repo/.claude/skills/code-review/SKILL.md")).toThrow();
    expect(() => target.volume.statSync("/home/user/.agent-stash/backups")).toThrow();
  });

  it("rejects selected remote download split hooks that are ignored locally before writing", async () => {
    const gistClient = new InMemoryGistClient();
    const source = createContext(createDummyAgentConfigFixture(), gistClient);
    await uploadBundle(source.ctx, {
      profile: "default",
      scope: "project",
      agent: "claude-code",
      hooks: ["PreToolUse"],
      yes: true
    });
    const files = createDummyAgentConfigFixture();
    files["/repo/.agent-stashignore"] = "hooks/project/claude-code/PreToolUse-Bash-001-001.json\n";
    delete files["/repo/.claude/settings.json"];
    const target = createContext(files, gistClient);

    await expect(downloadBundle(target.ctx, {
      profile: "default",
      scope: "project",
      agent: "claude-code",
      hooks: ["PreToolUse-Bash-001-001"],
      yes: true
    })).rejects.toThrow("Selected hook not found: PreToolUse-Bash-001-001");

    expect(() => target.volume.statSync("/repo/.claude/settings.json")).toThrow();
    expect(() => target.volume.statSync("/home/user/.agent-stash/backups")).toThrow();
  });

  it("rejects missing selected download skills before local writes or profile updates", async () => {
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
    files["/repo/.claude/skills/code-review/SKILL.md"] = "# Existing Local\n";
    files["/home/user/.agent-stash/config.json"] = JSON.stringify({ profiles: { default: { gistId: "gist-default" } } }, null, 2);
    const target = createContext(files, gistClient);

    await expect(downloadBundle(target.ctx, {
      profile: "default",
      scope: "project",
      agent: "claude-code",
      skills: ["missing"],
      yes: true
    })).rejects.toThrow("Selected skill not found: missing");

    expect(target.volume.readFileSync("/repo/.claude/skills/code-review/SKILL.md", "utf8")).toBe("# Existing Local\n");
    expect(target.volume.readFileSync("/home/user/.agent-stash/config.json", "utf8")).toBe(files["/home/user/.agent-stash/config.json"]);
    expect(() => target.volume.statSync("/home/user/.agent-stash/backups")).toThrow();
  });

  it("downloads by Gist URL without a stored profile", async () => {
    const gistClient = new InMemoryGistClient();
    const source = createContext(createDummyAgentConfigFixture(), gistClient);
    await uploadBundle(source.ctx, {
      gist: "gist-default",
      scope: "project",
      agent: "claude-code",
      skills: ["code-review"],
      yes: true
    });
    const files = createDummyAgentConfigFixture();
    delete files["/repo/.claude/skills/code-review/SKILL.md"];
    delete files["/home/user/.agent-stash/config.json"];
    const target = createContext(files, gistClient);

    const result = await downloadBundle(target.ctx, {
      gist: "https://gist.github.com/kjopek/gist-default",
      scope: "project",
      agent: "claude-code",
      yes: true
    });

    expect(result.downloaded.map((item) => item.id)).toEqual(["project:skill:claude-code:code-review"]);
    expect(target.volume.readFileSync("/repo/.claude/skills/code-review/SKILL.md", "utf8")).toBe("# Code Review\n");
  });

  it("downloads using an agent alias against canonical manifest items", async () => {
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

    const result = await downloadBundle(target.ctx, {
      profile: "default",
      scope: "project",
      agent: "claude",
      yes: true
    });

    expect(result.downloaded.map((item) => item.id)).toEqual(["project:skill:claude-code:code-review"]);
    expect(target.volume.readFileSync("/repo/.claude/skills/code-review/SKILL.md", "utf8")).toBe("# Code Review\n");
  });

  it("downloads global-scope skills under the user config root", async () => {
    const gistClient = new InMemoryGistClient();
    const source = createContext(createDummyAgentConfigFixture(), gistClient);
    await uploadBundle(source.ctx, {
      profile: "default",
      scope: "global",
      agent: "claude-code",
      skills: ["global-only"],
      yes: true
    });
    const files = createDummyAgentConfigFixture();
    delete files["/home/user/.claude/skills/global-only/SKILL.md"];
    const target = createContext(files, gistClient);

    const result = await downloadBundle(target.ctx, {
      profile: "default",
      scope: "global",
      agent: "claude-code",
      yes: true
    });

    expect(result.downloaded.map((item) => item.id)).toEqual(["global:skill:claude-code:global-only"]);
    expect(target.volume.readFileSync("/home/user/.claude/skills/global-only/SKILL.md", "utf8")).toBe("# Global Only\n");
  });
});

function updateRemoteHookFragment(
  record: Awaited<ReturnType<InMemoryGistClient["read"]>>,
  fragmentPath: string,
  fragmentValue: unknown
): void {
  const fragment = `${JSON.stringify(fragmentValue, null, 2)}\n`;
  updateRemoteHookFragmentContent(record, fragmentPath, fragment);
}

function updateRemoteHookFragmentContent(
  record: Awaited<ReturnType<InMemoryGistClient["read"]>>,
  fragmentPath: string,
  fragment: string
): void {
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
