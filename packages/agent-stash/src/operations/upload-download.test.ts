import { describe, expect, it, vi } from "vitest";
import { Volume, createFsFromVolume } from "memfs";
import { gistFilenameForBundlePath } from "../bundle.js";
import { hashFiles, sha256 } from "../hash.js";
import { parseManifest, serializeManifest } from "../manifest.js";
import { uploadBundle } from "./upload.js";
import { downloadBundle } from "./download.js";
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

  it("downloads one hook command without replacing the rest of the event", async () => {
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
