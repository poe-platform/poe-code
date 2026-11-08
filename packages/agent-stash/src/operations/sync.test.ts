import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setTimeout as scheduleTimeout } from "node:timers";
import { Volume, createFsFromVolume } from "memfs";
import { gistFilenameForBundlePath } from "../bundle.js";
import { uploadBundle } from "./upload.js";
import { downloadBundle } from "./download.js";
import { syncBundle } from "./sync.js";
import { parseManifest, serializeManifest } from "../manifest.js";
import { hashFiles, sha256 } from "../hash.js";
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

function cloneGistRecord(record: GistRecord): GistRecord {
  return {
    ...record,
    files: Object.fromEntries(Object.entries(record.files).map(([name, file]) => [name, { ...file }]))
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

  it("updates profile lastPushedAt when sync uploads remote changes", async () => {
    const { ctx, volume } = createContext();
    await uploadBundle(ctx, {
      profile: "default",
      scope: "project",
      agent: "claude-code",
      skills: ["code-review"],
      yes: true
    });
    ctx.now = () => new Date("2026-01-02T03:05:00.000Z");

    const result = await syncBundle(ctx, {
      profile: "default",
      scope: "project",
      agent: "claude-code",
      skills: ["project-only"],
      onConflict: "local",
      yes: true
    });

    const config = JSON.parse(volume.readFileSync("/home/user/.agent-stash/config.json", "utf8") as string);
    expect(result.uploaded.map((item) => item.name)).toEqual(["project-only"]);
    expect(config.profiles.default).toMatchObject({
      gistId: "gist-default",
      lastPushedAt: "2026-01-02T03:05:00.000Z"
    });
  });

  it("updates profile lastPulledAt when sync downloads remote changes", async () => {
    const gistClient = new InMemoryGistClient();
    const source = createContext(createDummyAgentConfigFixture(), gistClient);
    await uploadBundle(source.ctx, {
      profile: "default",
      scope: "project",
      agent: "claude-code",
      skills: ["code-review"],
      yes: true
    });
    const target = createContext(createDummyAgentConfigFixture(), gistClient);
    await downloadBundle(target.ctx, {
      profile: "default",
      scope: "project",
      agent: "claude-code",
      skills: ["code-review"],
      yes: true
    });
    source.volume.writeFileSync("/repo/.claude/skills/code-review/SKILL.md", "# Remote Review\n");
    source.ctx.now = () => new Date("2026-01-02T03:05:00.000Z");
    await syncBundle(source.ctx, {
      profile: "default",
      scope: "project",
      agent: "claude-code",
      skills: ["code-review"],
      onConflict: "local",
      yes: true
    });
    target.ctx.now = () => new Date("2026-01-02T03:06:00.000Z");

    const result = await syncBundle(target.ctx, {
      profile: "default",
      scope: "project",
      agent: "claude-code",
      skills: ["code-review"],
      onConflict: "fail",
      yes: true
    });

    const config = JSON.parse(target.volume.readFileSync("/home/user/.agent-stash/config.json", "utf8") as string);
    expect(result.downloaded.map((item) => item.name)).toEqual(["code-review"]);
    expect(target.volume.readFileSync("/repo/.claude/skills/code-review/SKILL.md", "utf8")).toBe("# Remote Review\n");
    expect(config.profiles.default).toMatchObject({
      gistId: "gist-default",
      lastPulledAt: "2026-01-02T03:06:00.000Z"
    });
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

  it("downloads remote-only split hooks selected by event name from an explicit Gist", async () => {
    const gistClient = new InMemoryGistClient();
    const source = createContext(createDummyAgentConfigFixture(), gistClient);
    await uploadBundle(source.ctx, {
      gist: "gist-default",
      scope: "project",
      agent: "claude-code",
      hooks: ["PreToolUse"],
      yes: true
    });
    const target = createContext({}, gistClient);

    const result = await syncBundle(target.ctx, {
      gist: "gist-default",
      scope: "project",
      agent: "claude-code",
      hooks: ["PreToolUse"],
      onConflict: "fail",
      yes: true
    });

    expect(result.downloaded.map((item) => item.name)).toEqual(["PreToolUse-Bash-001-001"]);
    const settings = JSON.parse(target.volume.readFileSync("/repo/.claude/settings.json", "utf8") as string) as {
      hooks?: Record<string, unknown>;
    };
    expect(settings.hooks?.PreToolUse).toEqual([{ matcher: "Bash", hooks: [{ type: "command", command: "npm test" }] }]);
  });

  it("uses an explicit Gist baseline after filtered download to sync local split hook edits", async () => {
    const gistClient = new InMemoryGistClient();
    const source = createContext(createDummyAgentConfigFixture(), gistClient);
    await uploadBundle(source.ctx, {
      gist: "gist-default",
      scope: "project",
      agent: "claude-code",
      hooks: ["PreToolUse"],
      yes: true
    });
    const target = createContext({}, gistClient);
    await downloadBundle(target.ctx, {
      gist: "gist-default",
      scope: "project",
      agent: "claude-code",
      hooks: ["PreToolUse-Bash-001-001"],
      yes: true
    });
    const settings = JSON.parse(target.volume.readFileSync("/repo/.claude/settings.json", "utf8") as string) as {
      hooks: { PreToolUse: Array<{ matcher: string; hooks: Array<{ type: string; command: string }> }> };
    };
    settings.hooks.PreToolUse[0]!.hooks[0]!.command += "\n# explicit gist baseline sync marker";
    await target.ctx.fs.writeFile("/repo/.claude/settings.json", `${JSON.stringify(settings, null, 2)}\n`, { encoding: "utf8" });

    const result = await syncBundle(target.ctx, {
      gist: "gist-default",
      scope: "project",
      agent: "claude-code",
      hooks: ["PreToolUse-Bash-001-001"],
      onConflict: "fail",
      yes: true
    });

    const record = await gistClient.read("gist-default");
    expect(result.uploaded.map((item) => item.name)).toEqual(["PreToolUse-Bash-001-001"]);
    expect(result.conflicts).toEqual([]);
    expect(record.files[gistFilenameForBundlePath("hooks/project/claude-code/PreToolUse-Bash-001-001.json")]?.content).toContain(
      "explicit gist baseline sync marker"
    );
    expect(target.volume.readFileSync("/home/user/.agent-stash/cache/gist-gist-default.manifest.json", "utf8")).toContain(
      "PreToolUse-Bash-001-001"
    );
  });

  it("uses an explicit Gist upload baseline to apply later remote split hook deletions", async () => {
    const files = {
      ...createDummyAgentConfigFixture(),
      "/repo/.claude/settings.json": JSON.stringify({
        hooks: {
          PreToolUse: [
            { matcher: "Bash", hooks: [{ type: "command", command: "npm test" }] },
            { matcher: "AskUserQuestion", hooks: [{ type: "command", command: "node ask-user-question.js" }] }
          ]
        }
      }, null, 2)
    };
    const gistClient = new InMemoryGistClient();
    const source = createContext(files, gistClient);
    await uploadBundle(source.ctx, {
      gist: "gist-default",
      scope: "project",
      agent: "claude-code",
      hooks: ["PreToolUse"],
      yes: true
    });
    const baseline = parseManifest(source.volume.readFileSync("/home/user/.agent-stash/cache/gist-gist-default.manifest.json", "utf8") as string);
    expect(baseline.items.map((item) => item.name)).toEqual([
      "PreToolUse-AskUserQuestion-002-001",
      "PreToolUse-Bash-001-001"
    ]);

    const remoteDeleter = createContext(files, gistClient);
    await downloadBundle(remoteDeleter.ctx, {
      gist: "gist-default",
      scope: "project",
      agent: "claude-code",
      hooks: ["PreToolUse"],
      yes: true
    });
    await remoteDeleter.ctx.fs.writeFile("/repo/.claude/settings.json", `${JSON.stringify({
      hooks: {
        PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "npm test" }] }]
      }
    }, null, 2)}\n`, { encoding: "utf8" });
    const remoteDelete = await syncBundle(remoteDeleter.ctx, {
      gist: "gist-default",
      scope: "project",
      agent: "claude-code",
      hooks: ["PreToolUse"],
      onConflict: "local",
      yes: true
    });
    expect(remoteDelete.deletedRemote.map((item) => item.name)).toEqual(["PreToolUse-AskUserQuestion-002-001"]);

    const prompted: string[] = [];
    const result = await syncBundle(source.ctx, {
      gist: "gist-default",
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

    const sourceSettings = JSON.parse(source.volume.readFileSync("/repo/.claude/settings.json", "utf8") as string) as {
      hooks?: { PreToolUse?: Array<{ matcher?: string }> };
    };
    expect(prompted).toEqual([]);
    expect(result.deletedLocal.map((item) => item.name)).toEqual(["PreToolUse-AskUserQuestion-002-001"]);
    expect(result.conflicts).toEqual([]);
    expect(sourceSettings.hooks?.PreToolUse?.map((group) => group.matcher)).toEqual(["Bash"]);
  });

  it("retries a stale explicit Gist read before failing selected remote-only split hooks", async () => {
    const gistClient = new StaleReadAfterUpdateGistClient();
    gistClient.seed({
      id: "gist-default",
      htmlUrl: "https://gist.github.com/gist-default",
      files: {
        "README.md": { filename: "README.md", content: "placeholder\n" }
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

    const result = await syncBundle(target.ctx, {
      gist: "gist-default",
      scope: "project",
      agent: "claude-code",
      hooks: ["PreToolUse"],
      onConflict: "fail",
      yes: true
    });

    expect(result.downloaded.map((item) => item.name)).toEqual(["PreToolUse-Bash-001-001"]);
    expect(gistClient.readCalls.filter((id) => id === "gist-default").length).toBeGreaterThanOrEqual(3);
  });

  it("retries stale Gist reads before applying an asked remote conflict winner", async () => {
    const gistClient = new StaleReadAfterUpdateGistClient();
    const postToolUseSettings = {
      hooks: {
        PostToolUse: [
          {
            matcher: "Write|Edit",
            hooks: [
              {
                type: "command",
                command: "npm run sync-skills --silent",
                statusMessage: "Syncing skills..."
              }
            ]
          }
        ]
      }
    };
    const source = createContext({
      ...createDummyAgentConfigFixture(),
      "/repo/.claude/settings.json": JSON.stringify(postToolUseSettings, null, 2)
    }, gistClient);
    await uploadBundle(source.ctx, {
      gist: "gist-default",
      scope: "project",
      agent: "claude-code",
      hooks: ["PostToolUse"],
      yes: true
    });
    await gistClient.read("gist-default");
    const target = createContext({
      ...createDummyAgentConfigFixture(),
      "/repo/.claude/settings.json": JSON.stringify({ hooks: {} }, null, 2)
    }, gistClient);
    await downloadBundle(target.ctx, {
      gist: "gist-default",
      scope: "project",
      agent: "claude-code",
      hooks: ["PostToolUse"],
      yes: true
    });

    const remoteSettings = structuredClone(postToolUseSettings);
    remoteSettings.hooks.PostToolUse[0]!.hooks[0]!.command += " # remote-winner";
    remoteSettings.hooks.PostToolUse[0]!.hooks[0]!.statusMessage = "Remote wins";
    const remote = createContext({
      ...createDummyAgentConfigFixture(),
      "/repo/.claude/settings.json": JSON.stringify(remoteSettings, null, 2)
    }, gistClient);
    remote.ctx.now = () => new Date("2026-01-02T03:04:06.000Z");
    await uploadBundle(remote.ctx, {
      gist: "gist-default",
      scope: "project",
      agent: "claude-code",
      hooks: ["PostToolUse"],
      yes: true
    });
    const localSettings = structuredClone(postToolUseSettings);
    localSettings.hooks.PostToolUse[0]!.hooks[0]!.command += " # local-loser";
    localSettings.hooks.PostToolUse[0]!.hooks[0]!.statusMessage = "Local loses";
    localSettings.env = { KEEP: "1" };
    localSettings.hooks.PreToolUse = [{ matcher: "Bash", hooks: [{ type: "command", command: "echo preserved" }] }];
    target.volume.writeFileSync("/repo/.claude/settings.json", JSON.stringify(localSettings, null, 2));

    const result = await syncBundle(target.ctx, {
      gist: "gist-default",
      scope: "project",
      agent: "claude-code",
      hooks: ["PostToolUse"],
      onConflict: "ask",
      yes: true,
      async resolveConflict() {
        return "remote";
      }
    });

    const settings = JSON.parse(target.volume.readFileSync("/repo/.claude/settings.json", "utf8") as string) as typeof postToolUseSettings;
    expect(result.downloaded.map((item) => item.name)).toEqual(["PostToolUse-Write-Edit-001-001"]);
    expect(settings.hooks.PostToolUse[0]!.hooks[0]).toMatchObject({
      command: "npm run sync-skills --silent # remote-winner",
      statusMessage: "Remote wins"
    });
    expect(settings.env).toEqual({ KEEP: "1" });
    expect(settings.hooks.PreToolUse).toEqual([{ matcher: "Bash", hooks: [{ type: "command", command: "echo preserved" }] }]);
    expect(gistClient.readCalls.filter((id) => id === "gist-default").length).toBeGreaterThanOrEqual(6);
  });

  it("flags local-only hook splits in the same selected remote event as conflicts", async () => {
    const gistClient = new InMemoryGistClient();
    const sourceFiles = {
      ...createDummyAgentConfigFixture(),
      "/repo/.claude/settings.json": JSON.stringify({
        hooks: {
          PreToolUse: [
            { matcher: "EnterPlanMode", hooks: [{ type: "command", command: "remote enter plan" }] },
            { matcher: "AskUserQuestion", hooks: [{ type: "command", command: "remote ask user" }] },
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
            { matcher: "Bash", hooks: [{ type: "command", command: "local pretooluse sentinel" }] }
          ],
          Stop: [
            { hooks: [{ type: "command", command: "local stop sentinel" }] }
          ]
        }
      }, null, 2)
    };
    const target = createContext(targetFiles, gistClient);

    const result = await syncBundle(target.ctx, {
      profile: "default",
      scope: "project",
      agent: "claude-code",
      hooks: ["PreToolUse"],
      onConflict: "fail",
      yes: true
    });

    expect(result.conflicts.map((item) => item.name)).toEqual(["PreToolUse-Bash-001-001"]);
    expect(result.uploaded).toEqual([]);
    expect(result.downloaded).toEqual([]);
    const settings = JSON.parse(target.volume.readFileSync("/repo/.claude/settings.json", "utf8") as string) as {
      hooks?: { PreToolUse?: Array<{ hooks?: Array<{ command?: string }> }> };
    };
    expect(settings.hooks?.PreToolUse?.[0]?.hooks?.[0]?.command).toBe("local pretooluse sentinel");
  });

  it("deletes local-only same-event hook splits with remote conflict policy", async () => {
    const gistClient = new InMemoryGistClient();
    const sourceFiles = {
      ...createDummyAgentConfigFixture(),
      "/repo/.claude/settings.json": JSON.stringify({
        hooks: {
          PreToolUse: [
            { matcher: "EnterPlanMode", hooks: [{ type: "command", command: "remote enter plan" }] },
            { matcher: "AskUserQuestion", hooks: [{ type: "command", command: "remote ask user" }] },
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
            { matcher: "Bash", hooks: [{ type: "command", command: "local pretooluse sentinel" }] }
          ],
          Stop: [
            { hooks: [{ type: "command", command: "local stop sentinel" }] }
          ]
        }
      }, null, 2)
    };
    const target = createContext(targetFiles, gistClient);

    const result = await syncBundle(target.ctx, {
      profile: "default",
      scope: "project",
      agent: "claude-code",
      hooks: ["PreToolUse"],
      onConflict: "remote",
      yes: true
    });

    expect(result.deletedLocal.map((item) => item.name)).toEqual(["PreToolUse-Bash-001-001"]);
    expect(result.uploaded).toEqual([]);
    expect(result.downloaded.map((item) => item.name)).toEqual([
      "PreToolUse-AskUserQuestion-002-001",
      "PreToolUse-Bash-003-001",
      "PreToolUse-Bash-003-002",
      "PreToolUse-EnterPlanMode-001-001"
    ]);
    const settings = JSON.parse(target.volume.readFileSync("/repo/.claude/settings.json", "utf8") as string) as {
      hooks?: Record<string, Array<{ matcher?: string; hooks?: Array<{ command?: string }> }>>;
    };
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

  it("traces sync errors when a Gist read fails", async () => {
    const { ctx, gistClient } = createContext();
    const traces: Array<{ event: string; error?: string }> = [];
    ctx.trace = async (record) => {
      traces.push(record as { event: string; error?: string });
    };
    gistClient.read = vi.fn(async () => {
      throw new Error("read refused");
    });

    await expect(syncBundle(ctx, {
      profile: "default",
      scope: "project",
      agent: "claude-code",
      onConflict: "fail",
      yes: true
    })).rejects.toThrow("read refused");

    expect(traces.at(-1)).toMatchObject({
      event: "sync.error",
      error: "read refused"
    });
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
    expect(traces.find((record) => record.event === "sync.remote.update")).toMatchObject({
      writeFiles: [
        "agent-stash.json",
        gistFilenameForBundlePath("hooks/project/claude-code/PostToolUse-Write-Edit-001-001.json")
      ],
      deleteFiles: [
        gistFilenameForBundlePath("hooks/project/claude-code/PostToolUse.json")
      ]
    });
  });

  it("removes untracked legacy event-level hook chunks during split hook sync", async () => {
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
    expect(result.conflicts).toEqual([]);
    expect(record.files[gistFilenameForBundlePath(legacyPath)]).toBeUndefined();
    expect(manifest.items.map((item) => item.id)).toEqual(["project:hook:claude-code:PostToolUse-Write-Edit-001-001"]);
    expect(traces.find((record) => record.event === "sync.untrackedLegacyHookChunksRemoved")).toMatchObject({
      event: "sync.untrackedLegacyHookChunksRemoved",
      files: [legacyPath]
    });
    expect(traces.find((record) => record.event === "sync.remote.update")).toMatchObject({
      deleteFiles: [
        gistFilenameForBundlePath(legacyPath)
      ]
    });
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

  it("rejects selected remote sync split hooks that are ignored locally before writing", async () => {
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

    await expect(syncBundle(target.ctx, {
      profile: "default",
      scope: "project",
      agent: "claude-code",
      hooks: ["PreToolUse-Bash-001-001"],
      onConflict: "remote",
      yes: true
    })).rejects.toThrow("Selected hook not found: PreToolUse-Bash-001-001");

    expect(() => target.volume.statSync("/repo/.claude/settings.json")).toThrow();
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

  it("does not trace unselected baseline hooks during filtered sync", async () => {
    const files = {
      ...createDummyAgentConfigFixture(),
      "/home/user/.claude/settings.json": JSON.stringify({
        hooks: {
          PostToolUse: [{ hooks: [{ type: "command", command: "remote posttooluse" }] }],
          PostToolUseFailure: [{ hooks: [{ type: "command", command: "remote posttooluse failure" }] }]
        }
      }, null, 2)
    };
    const gistClient = new InMemoryGistClient();
    const target = createContext(files, gistClient);
    await uploadBundle(target.ctx, {
      profile: "default",
      scope: "global",
      agent: "claude-code",
      hooks: ["PostToolUse", "PostToolUseFailure"],
      yes: true
    });
    const record = await gistClient.read("gist-default");
    const failureFilename = gistFilenameForBundlePath("hooks/global/claude-code/PostToolUseFailure-all-tools-001-001.json");
    const failureBefore = record.files[failureFilename]?.content;
    target.volume.writeFileSync("/home/user/.claude/settings.json", JSON.stringify({
      hooks: {
        PostToolUse: [{ hooks: [{ type: "command", command: "local posttooluse" }] }],
        PostToolUseFailure: [{ hooks: [{ type: "command", command: "remote posttooluse failure" }] }]
      }
    }, null, 2));
    const traces: Array<{ event: string; [key: string]: unknown }> = [];
    target.ctx.trace = async (record) => {
      traces.push(record);
    };

    const result = await syncBundle(target.ctx, {
      profile: "default",
      scope: "global",
      agent: "claude-code",
      hooks: ["PostToolUse"],
      onConflict: "fail",
      yes: true
    });

    const updatedRecord = await gistClient.read("gist-default");
    const traceJson = JSON.stringify(traces);
    expect(result.uploaded.map((item) => item.name)).toEqual(["PostToolUse-all-tools-001-001"]);
    expect(traceJson).not.toContain("PostToolUseFailure");
    expect(updatedRecord.files[failureFilename]?.content).toBe(failureBefore);
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
    const traces: Array<{ event: string; [key: string]: unknown }> = [];
    target.ctx.trace = async (record) => {
      traces.push(record);
    };
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
    expect(traces.find((record) => record.event === "local.remove.start")).toMatchObject({
      event: "local.remove.start",
      item: {
        id: "project:hook:claude-code:Stop-all-tools-002-001",
        kind: "hook",
        scope: "project",
        agentId: "claude-code",
        name: "Stop-all-tools-002-001"
      },
      targetPath: "/repo/.claude/settings.json"
    });
    expect(traces.find((record) => record.event === "local.remove.finish")).toMatchObject({
      event: "local.remove.finish",
      item: {
        id: "project:hook:claude-code:Stop-all-tools-002-001",
        kind: "hook",
        scope: "project",
        agentId: "claude-code",
        name: "Stop-all-tools-002-001"
      },
      targetPath: "/repo/.claude/settings.json",
      removedPaths: ["/repo/.claude/settings.json"]
    });
    expect(JSON.stringify(traces)).not.toContain("remote second stop");
  });

  it("applies local deletion for an earlier hook without renumbering surviving hooks", async () => {
    const files = {
      ...createDummyAgentConfigFixture(),
      "/repo/.claude/settings.json": JSON.stringify({
        hooks: {
          Stop: [
            { hooks: [{ type: "command", command: "first local stop" }] },
            { hooks: [{ type: "command", command: "second local stop" }] }
          ]
        }
      }, null, 2)
    };
    const { ctx, volume, gistClient } = createContext(files);
    await uploadBundle(ctx, {
      profile: "default",
      scope: "project",
      agent: "claude-code",
      hooks: ["Stop"],
      yes: true
    });
    volume.writeFileSync("/repo/.claude/settings.json", JSON.stringify({
      hooks: {
        Stop: [
          { hooks: [{ type: "command", command: "second local stop" }] }
        ]
      }
    }, null, 2));
    const prompted: string[] = [];

    const result = await syncBundle(ctx, {
      profile: "default",
      scope: "project",
      agent: "claude-code",
      hooks: ["Stop-all-tools-001-001"],
      onConflict: "ask",
      yes: true,
      async resolveConflict(conflict) {
        prompted.push(conflict.item.name);
        return "fail";
      }
    });

    const settings = JSON.parse(volume.readFileSync("/repo/.claude/settings.json", "utf8") as string) as {
      hooks?: { Stop?: Array<{ hooks: Array<{ command: string }> }> };
    };
    const record = await gistClient.read("gist-default");
    const manifest = parseManifest(record.files["agent-stash.json"]!.content);
    expect(prompted).toEqual([]);
    expect(result.deletedRemote.map((item) => item.name)).toEqual(["Stop-all-tools-001-001"]);
    expect(result.uploaded).toEqual([]);
    expect(settings.hooks?.Stop?.flatMap((group) => group.hooks.map((hook) => hook.command))).toEqual([
      "second local stop"
    ]);
    expect(manifest.items.map((item) => item.name)).toEqual(["Stop-all-tools-002-001"]);
    expect(record.files[gistFilenameForBundlePath("hooks/project/claude-code/Stop-all-tools-001-001.json")]).toBeUndefined();
    expect(record.files[gistFilenameForBundlePath("hooks/project/claude-code/Stop-all-tools-002-001.json")]).toBeDefined();
  });

  it("applies local deletion for an earlier hook after a full download establishes hook origins", async () => {
    const sourceFiles = {
      ...createDummyAgentConfigFixture(),
      "/repo/.claude/settings.json": JSON.stringify({
        hooks: {
          Stop: [
            { hooks: [{ type: "command", command: "first remote stop" }] },
            { hooks: [{ type: "command", command: "second remote stop" }] }
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
      yes: true
    });
    const settings = JSON.parse(target.volume.readFileSync("/repo/.claude/settings.json", "utf8") as string) as {
      hooks: { Stop: Array<{ hooks: Array<{ command: string }> }> };
    };
    settings.hooks.Stop.splice(0, 1);
    target.volume.writeFileSync("/repo/.claude/settings.json", `${JSON.stringify(settings, null, 2)}\n`);
    const prompted: string[] = [];

    const result = await syncBundle(target.ctx, {
      profile: "default",
      scope: "project",
      agent: "claude-code",
      hooks: ["Stop-all-tools-001-001"],
      onConflict: "ask",
      yes: true,
      async resolveConflict(conflict) {
        prompted.push(conflict.item.name);
        return "fail";
      }
    });

    const record = await gistClient.read("gist-default");
    const manifest = parseManifest(record.files["agent-stash.json"]!.content);
    expect(prompted).toEqual([]);
    expect(result.deletedRemote.map((item) => item.name)).toEqual(["Stop-all-tools-001-001"]);
    expect(result.uploaded).toEqual([]);
    expect(settings.hooks.Stop.flatMap((group) => group.hooks.map((hook) => hook.command))).toEqual([
      "second remote stop"
    ]);
    expect(manifest.items.map((item) => item.name)).toEqual(["Stop-all-tools-002-001"]);
    expect(record.files[gistFilenameForBundlePath("hooks/project/claude-code/Stop-all-tools-001-001.json")]).toBeUndefined();
    expect(record.files[gistFilenameForBundlePath("hooks/project/claude-code/Stop-all-tools-002-001.json")]).toBeDefined();
  });

  it("preserves later matcher group identities when an earlier group is deleted and a hook is added", async () => {
    const sourceFiles = {
      ...createDummyAgentConfigFixture(),
      "/repo/.claude/settings.json": JSON.stringify({
        hooks: {
          PreToolUse: [
            {
              matcher: "EnterPlanMode",
              hooks: [{ type: "command", command: "block plan mode" }]
            },
            {
              matcher: "AskUserQuestion",
              hooks: [{ type: "command", command: "block ask user" }]
            },
            {
              matcher: "Bash",
              hooks: [
                { type: "command", command: "block coauthor" },
                { type: "command", command: "block generated by" }
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
      "/repo/.claude/settings.json": JSON.stringify({ hooks: {} }, null, 2)
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
      hooks: { PreToolUse: Array<{ matcher?: string; hooks: Array<{ command: string }> }> };
    };
    settings.hooks.PreToolUse.splice(1, 1);
    settings.hooks.PreToolUse.find((group) => group.matcher === "Bash")?.hooks.push({
      command: "block new bash case"
    });
    target.volume.writeFileSync("/repo/.claude/settings.json", `${JSON.stringify(settings, null, 2)}\n`);

    const result = await syncBundle(target.ctx, {
      profile: "default",
      scope: "project",
      agent: "claude-code",
      hooks: ["PreToolUse"],
      onConflict: "local",
      yes: true
    });

    const record = await gistClient.read("gist-default");
    const manifest = parseManifest(record.files["agent-stash.json"]!.content);
    expect(result.uploaded.map((item) => item.name)).toEqual(["PreToolUse-Bash-003-003"]);
    expect(result.deletedRemote.map((item) => item.name)).toEqual(["PreToolUse-AskUserQuestion-002-001"]);
    expect(result.unchanged.map((item) => item.name).sort()).toEqual([
      "PreToolUse-Bash-003-001",
      "PreToolUse-Bash-003-002",
      "PreToolUse-EnterPlanMode-001-001"
    ]);
    expect(manifest.items.map((item) => item.name).sort()).toEqual([
      "PreToolUse-Bash-003-001",
      "PreToolUse-Bash-003-002",
      "PreToolUse-Bash-003-003",
      "PreToolUse-EnterPlanMode-001-001"
    ]);
    expect(record.files[gistFilenameForBundlePath("hooks/project/claude-code/PreToolUse-AskUserQuestion-002-001.json")]).toBeUndefined();
    expect(record.files[gistFilenameForBundlePath("hooks/project/claude-code/PreToolUse-Bash-003-001.json")]).toBeDefined();
    expect(record.files[gistFilenameForBundlePath("hooks/project/claude-code/PreToolUse-Bash-003-002.json")]).toBeDefined();
    expect(record.files[gistFilenameForBundlePath("hooks/project/claude-code/PreToolUse-Bash-003-003.json")]).toBeDefined();
  });

  it("preserves hook identities when hooks are reordered inside one matcher group", async () => {
    const sourceFiles = {
      ...createDummyAgentConfigFixture(),
      "/repo/.claude/settings.json": JSON.stringify({
        hooks: {
          PreToolUse: [
            {
              matcher: "Bash",
              hooks: [
                { type: "command", command: "first local bash" },
                { type: "command", command: "second local bash" }
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
      "/repo/.claude/settings.json": JSON.stringify({ hooks: {} }, null, 2)
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
      hooks: { PreToolUse: Array<{ matcher?: string; hooks: Array<{ command: string }> }> };
    };
    const bashHooks = settings.hooks.PreToolUse[0]!.hooks;
    settings.hooks.PreToolUse[0]!.hooks = [bashHooks[1]!, bashHooks[0]!];
    target.volume.writeFileSync("/repo/.claude/settings.json", `${JSON.stringify(settings, null, 2)}\n`);

    const result = await syncBundle(target.ctx, {
      profile: "default",
      scope: "project",
      agent: "claude-code",
      hooks: ["PreToolUse"],
      onConflict: "fail",
      yes: true
    });

    const record = await gistClient.read("gist-default");
    const manifest = parseManifest(record.files["agent-stash.json"]!.content);
    const first = record.files[gistFilenameForBundlePath("hooks/project/claude-code/PreToolUse-Bash-001-001.json")]?.content;
    const second = record.files[gistFilenameForBundlePath("hooks/project/claude-code/PreToolUse-Bash-001-002.json")]?.content;
    expect(result.uploaded).toEqual([]);
    expect(result.deletedRemote).toEqual([]);
    expect(result.unchanged.map((item) => item.name).sort()).toEqual([
      "PreToolUse-Bash-001-001",
      "PreToolUse-Bash-001-002"
    ]);
    expect(manifest.items.map((item) => item.name).sort()).toEqual([
      "PreToolUse-Bash-001-001",
      "PreToolUse-Bash-001-002"
    ]);
    expect(first).toContain("first local bash");
    expect(second).toContain("second local bash");
  });

  it("refreshes hook origins after syncing local deletion within a matcher group", async () => {
    const files = {
      ...createDummyAgentConfigFixture(),
      "/repo/.claude/settings.json": JSON.stringify({
        hooks: {
          PreToolUse: [
            {
              matcher: "Bash",
              hooks: [
                { type: "command", command: "first local bash" },
                { type: "command", command: "second local bash" }
              ]
            }
          ]
        }
      }, null, 2)
    };
    const { ctx, volume, gistClient } = createContext(files);
    await uploadBundle(ctx, {
      profile: "default",
      scope: "project",
      agent: "claude-code",
      hooks: ["PreToolUse"],
      yes: true
    });
    volume.writeFileSync("/repo/.claude/settings.json", JSON.stringify({
      hooks: {
        PreToolUse: [
          {
            matcher: "Bash",
            hooks: [{ type: "command", command: "second local bash" }]
          }
        ]
      }
    }, null, 2));

    const result = await syncBundle(ctx, {
      profile: "default",
      scope: "project",
      agent: "claude-code",
      hooks: ["PreToolUse-Bash-001-001"],
      onConflict: "ask",
      yes: true,
      async resolveConflict() {
        return "fail";
      }
    });

    const record = await gistClient.read("gist-default");
    const manifest = parseManifest(record.files["agent-stash.json"]!.content);
    const origins = JSON.parse(volume.readFileSync("/home/user/.agent-stash/hook-origins.json", "utf8") as string) as {
      targets: Record<string, Record<string, Array<{ groupIndex: number; hooks: number[] }>>>;
    };
    expect(result.deletedRemote.map((item) => item.name)).toEqual(["PreToolUse-Bash-001-001"]);
    expect(manifest.items.map((item) => item.name)).toEqual(["PreToolUse-Bash-001-002"]);
    expect(record.files[gistFilenameForBundlePath("hooks/project/claude-code/PreToolUse-Bash-001-001.json")]).toBeUndefined();
    expect(record.files[gistFilenameForBundlePath("hooks/project/claude-code/PreToolUse-Bash-001-002.json")]).toBeDefined();
    expect(origins.targets["/repo/.claude/settings.json"]?.PreToolUse).toEqual([
      expect.objectContaining({ groupIndex: 0, hooks: [1] })
    ]);
  });

  it("applies unchanged local split hook deletion with fail policy", async () => {
    const files = {
      ...createDummyAgentConfigFixture(),
      "/repo/.claude/settings.json": JSON.stringify({
        hooks: {
          PreToolUse: [
            {
              matcher: "Bash",
              hooks: [
                { type: "command", command: "first local bash" },
                { type: "command", command: "second local bash" }
              ]
            }
          ]
        }
      }, null, 2)
    };
    const { ctx, volume, gistClient } = createContext(files);
    await uploadBundle(ctx, {
      profile: "default",
      scope: "project",
      agent: "claude-code",
      hooks: ["PreToolUse"],
      yes: true
    });
    volume.writeFileSync("/repo/.claude/settings.json", JSON.stringify({
      hooks: {
        PreToolUse: [
          {
            matcher: "Bash",
            hooks: [{ type: "command", command: "second local bash" }]
          }
        ]
      }
    }, null, 2));

    const result = await syncBundle(ctx, {
      profile: "default",
      scope: "project",
      agent: "claude-code",
      hooks: ["PreToolUse-Bash-001-001"],
      onConflict: "fail",
      yes: true
    });

    const record = await gistClient.read("gist-default");
    const manifest = parseManifest(record.files["agent-stash.json"]!.content);
    expect(result.deletedRemote.map((item) => item.name)).toEqual(["PreToolUse-Bash-001-001"]);
    expect(result.conflicts).toEqual([]);
    expect(manifest.items.map((item) => item.name)).toEqual(["PreToolUse-Bash-001-002"]);
    expect(record.files[gistFilenameForBundlePath("hooks/project/claude-code/PreToolUse-Bash-001-001.json")]).toBeUndefined();
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
    const unrelated = createContext(createDummyAgentConfigFixture(), gistClient);
    await uploadBundle(unrelated.ctx, {
      profile: "default",
      scope: "project",
      agent: "claude-code",
      skills: ["project-only"],
      yes: true
    });

    const result = await syncBundle(target.ctx, {
      profile: "default",
      scope: "project",
      agent: "claude-code",
      skills: ["code-review"],
      onConflict: "local",
      yes: true
    });

    expect(result.uploaded.map((item) => item.name)).toContain("code-review");
    expect(gistClient.updateCalls.at(-1)?.input.files[gistFilenameForBundlePath("skills/project/claude-code/code-review/SKILL.md")]).toEqual({
      content: "# Local Change\n"
    });
    expect(gistClient.updateCalls.at(-1)?.input.files["agent-stash.json"]).toBeDefined();
    expect(gistClient.updateCalls.at(-1)?.input.files[gistFilenameForBundlePath("skills/project/claude-code/project-only/SKILL.md")]).toBeUndefined();
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
      localUpdatedAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
      remoteUpdatedAt: "2026-01-02T03:04:06.000Z",
      baseUpdatedAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/)
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

  it("uses local file mtimes for newer-policy conflict resolution", async () => {
    const { target } = await createDivergedSkillScenario({ includeBase: true });
    target.ctx.now = () => new Date("2026-01-02T03:05:00.000Z");
    target.volume.utimesSync(
      "/repo/.claude/skills/code-review/SKILL.md",
      new Date("2026-01-02T03:04:04.000Z"),
      new Date("2026-01-02T03:04:04.000Z")
    );

    const result = await syncBundle(target.ctx, {
      profile: "default",
      scope: "project",
      agent: "claude-code",
      onConflict: "newer",
      yes: true
    });

    expect(result.downloaded.map((item) => item.name)).toContain("code-review");
    expect(target.volume.readFileSync("/repo/.claude/skills/code-review/SKILL.md", "utf8")).toBe("# Remote Change\n");
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
