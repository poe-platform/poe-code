import { describe, expect, it, vi } from "vitest";
import { Volume, createFsFromVolume } from "memfs";
import { gistFilenameForBundlePath } from "./bundle.js";
import {
  buildBrowseExplorerConfig,
  buildBrowseModel,
  buildBrowseTwoPaneConfig,
  renderBrowse,
  runBrowseAction
} from "./browse.js";
import { hashFiles, sha256 } from "./hash.js";
import { parseManifest, serializeManifest } from "./manifest.js";
import { uploadBundle } from "./operations/upload.js";
import { InMemoryGistClient } from "./test-support/in-memory-gist-client.js";
import { createDummyAgentConfigFixture, dummyCwd, dummyHome, fixedDate } from "./test-support/dummy-config.js";
import type { AgentStashContext, AgentStashFileSystem } from "./types.js";

vi.mock("./gist-client.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./gist-client.js")>();
  return {
    ...actual,
    createDefaultGistClient: vi.fn(async () => {
      throw new Error("default Gist client should not be created");
    })
  };
});

function createHarness(): { ctx: AgentStashContext; volume: Volume; gistClient: InMemoryGistClient } {
  const volume = Volume.fromJSON(createDummyAgentConfigFixture(), "/");
  const gistClient = new InMemoryGistClient();
  gistClient.seed({ id: "gist-default", htmlUrl: "https://gist.github.com/gist-default", files: {} });
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

describe("browse", () => {
  it("builds a project to global browse model from local inventory", async () => {
    const model = await buildBrowseModel(createHarness().ctx, {
      scope: "project",
      agent: "claude-code"
    });

    expect(model.left.title).toBe("Project: claude-code");
    expect(model.left.items.map((item) => item.name)).toContain("code-review");
    expect(model.left.items.map((item) => item.name)).toContain("PreToolUse");
    expect(model.right.title).toBe("Global: claude-code");
    expect(model.right.items.map((item) => item.name)).toContain("global-only");
  });

  it("builds a global to project browse model from local inventory", async () => {
    const model = await buildBrowseModel(createHarness().ctx, {
      scope: "global",
      agent: "claude-code"
    });

    expect(model.left.title).toBe("Global: claude-code");
    expect(model.left.items.map((item) => item.name)).toContain("global-only");
    expect(model.right.title).toBe("Project: claude-code");
    expect(model.right.items.map((item) => item.name)).toContain("project-only");
  });

  it("rejects invalid browse scopes before reading inventory", async () => {
    await expect(buildBrowseModel(createHarness().ctx, {
      scope: "workspace" as "project",
      agent: "claude-code"
    })).rejects.toThrow("Invalid scope: workspace. Expected project or global.");
  });

  it("renders a profile-backed Gist pane", async () => {
    const { ctx } = createHarness();
    await uploadBundle(ctx, {
      profile: "default",
      scope: "project",
      agent: "claude-code",
      skills: ["code-review"],
      yes: true
    });

    const model = await buildBrowseModel(ctx, {
      profile: "default",
      scope: "project",
      agent: "claude-code"
    });
    const rendered = renderBrowse(model);

    expect(model.right.title).toBe("Gist default: claude-code");
    expect(model.right.items).toHaveLength(1);
    expect(rendered).toContain("Project: claude-code");
    expect(rendered).toContain("Gist default: claude-code");
    expect(rendered).toContain("code-review");
    expect(rendered).toContain("c copy");
    expect(rendered).toContain("s sync");
  });

  it("rejects missing browse Gist profiles before creating a default Gist client", async () => {
    const { ctx } = createHarness();
    ctx.gistClient = undefined;

    await expect(buildBrowseModel(ctx, {
      profile: "missing",
      scope: "project",
      agent: "claude-code"
    })).rejects.toThrow("Profile does not have a Gist: missing");
  });

  it("routes copy actions through the SDK from the active pane to the other pane", async () => {
    const { ctx, volume } = createHarness();

    const result = await runBrowseAction(ctx, {
      action: "copy",
      selectedIds: ["project:skill:claude-code:code-review"],
      scope: "project",
      agent: "claude-code",
      yes: true
    });

    expect(result.copied?.map((copy) => copy.item.id)).toEqual(["global:skill:claude-code:code-review"]);
    expect(volume.readFileSync("/home/user/.claude/skills/code-review/SKILL.md", "utf8")).toBe("# Code Review\n");
  });

  it("rejects invalid browse actions before loading panes", async () => {
    const { ctx, gistClient } = createHarness();

    await expect(runBrowseAction(ctx, {
      action: "delete" as "copy",
      selectedIds: ["project:skill:claude-code:code-review"],
      scope: "project",
      agent: "claude-code",
      yes: true
    })).rejects.toThrow("Invalid browse action: delete");

    expect(gistClient.readCalls).toHaveLength(0);
    expect(gistClient.updateCalls).toHaveLength(0);
  });

  it("routes upload actions through the SDK for selected local items", async () => {
    const { ctx, gistClient } = createHarness();

    const result = await runBrowseAction(ctx, {
      action: "upload",
      profile: "default",
      selectedIds: ["project:skill:claude-code:code-review"],
      scope: "project",
      agent: "claude-code",
      yes: true
    });

    expect(result.uploaded?.uploaded.map((item) => item.id)).toEqual(["project:skill:claude-code:code-review"]);
    expect(gistClient.updateCalls.at(-1)?.input.files[gistFilenameForBundlePath("skills/project/claude-code/code-review/SKILL.md")]).toEqual({
      content: "# Code Review\n"
    });
  });

  it("rejects stale selected browse ids before writing", async () => {
    const { ctx, gistClient } = createHarness();

    await expect(runBrowseAction(ctx, {
      action: "upload",
      profile: "default",
      selectedIds: [
        "project:skill:claude-code:code-review",
        "project:skill:claude-code:missing"
      ],
      scope: "project",
      agent: "claude-code",
      yes: true
    })).rejects.toThrow("Selected browse item not found: project:skill:claude-code:missing");

    expect(gistClient.updateCalls).toHaveLength(0);
  });

  it("routes download actions from a Gist pane to the local pane", async () => {
    const { ctx, volume } = createHarness();
    await uploadBundle(ctx, {
      profile: "default",
      scope: "project",
      agent: "claude-code",
      skills: ["code-review"],
      yes: true
    });
    await ctx.fs.rm?.("/repo/.claude/skills/code-review", { recursive: true, force: true });

    const result = await runBrowseAction(ctx, {
      action: "download",
      profile: "default",
      fromPane: "right",
      selectedIds: ["project:skill:claude-code:code-review"],
      scope: "project",
      agent: "claude-code",
      yes: true
    });

    expect(Array.isArray(result.downloaded)).toBe(true);
    expect(volume.readFileSync("/repo/.claude/skills/code-review/SKILL.md", "utf8")).toBe("# Code Review\n");
  });

  it("routes local-pane download actions for only the selected items", async () => {
    const { ctx, volume } = createHarness();
    await uploadBundle(ctx, {
      profile: "default",
      scope: "project",
      agent: "claude-code",
      skills: ["code-review", "commit-helper"],
      yes: true
    });
    await ctx.fs.rm?.("/repo/.claude/skills/commit-helper", { recursive: true, force: true });
    await ctx.fs.writeFile("/repo/.claude/skills/code-review/SKILL.md", "# Local Review\n", { encoding: "utf8" });

    const result = await runBrowseAction(ctx, {
      action: "download",
      profile: "default",
      fromPane: "left",
      selectedIds: ["project:skill:claude-code:code-review"],
      scope: "project",
      agent: "claude-code",
      yes: true
    });

    expect(Array.isArray(result.downloaded)).toBe(false);
    expect(volume.readFileSync("/repo/.claude/skills/code-review/SKILL.md", "utf8")).toBe("# Code Review\n");
    expect(() => volume.statSync("/repo/.claude/skills/commit-helper/SKILL.md")).toThrow();
  });

  it("routes move actions from a local pane to a Gist pane", async () => {
    const { ctx, volume, gistClient } = createHarness();

    const result = await runBrowseAction(ctx, {
      action: "move",
      profile: "default",
      selectedIds: ["project:skill:claude-code:project-only"],
      scope: "project",
      agent: "claude-code",
      yes: true
    });

    expect(result.moved?.map((move) => move.item.id)).toEqual(["project:skill:claude-code:project-only"]);
    expect(() => volume.statSync("/repo/.claude/skills/project-only")).toThrow();
    expect(gistClient.updateCalls.at(-1)?.input.files[gistFilenameForBundlePath("skills/project/claude-code/project-only/SKILL.md")]).toEqual({
      content: "# Project Only\n"
    });
  });

  it("routes sync actions for only the selected items", async () => {
    const { ctx, gistClient } = createHarness();
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
    await ctx.fs.writeFile("/repo/.claude/skills/code-review/SKILL.md", "# Local Change\n", {
      encoding: "utf8"
    });
    const record = await gistClient.read("gist-default");
    const manifest = parseManifest(record.files["agent-stash.json"]!.content);
    const item = manifest.items.find((candidate) => candidate.name === "code-review")!;
    const remoteContent = "# Remote Change\n";
    item.files[0] = {
      ...item.files[0]!,
      size: Buffer.byteLength(remoteContent, "utf8"),
      sha256: sha256(remoteContent)
    };
    item.contentHash = hashFiles(item.files);
    record.files["agent-stash.json"] = {
      filename: "agent-stash.json",
      content: serializeManifest(manifest)
    };
    const remotePath = gistFilenameForBundlePath("skills/project/claude-code/code-review/SKILL.md");
    record.files[remotePath] = {
      filename: remotePath,
      content: remoteContent
    };
    gistClient.seed(record);

    const result = await runBrowseAction(ctx, {
      action: "sync",
      profile: "default",
      selectedIds: ["project:skill:claude-code:code-review"],
      scope: "project",
      agent: "claude-code",
      onConflict: "local",
      yes: true
    });

    expect(result.synced?.uploaded.map((syncItem) => syncItem.name)).toEqual(["code-review"]);
    expect(gistClient.updateCalls.at(-1)?.input.files[gistFilenameForBundlePath("skills/project/claude-code/project-only/SKILL.md")]).toBeUndefined();
  });

  it("builds an explorer config with pane rows and action keybindings", async () => {
    const { ctx } = createHarness();
    const calls: Array<{ action: string; selectedIds: string[]; fromPane?: string }> = [];
    const config = buildBrowseExplorerConfig(ctx, {
      scope: "project",
      agent: "claude-code",
      runAction: async (_ctx, options) => {
        calls.push({
          action: options.action,
          selectedIds: options.selectedIds,
          fromPane: options.fromPane
        });
        return {};
      }
    });

    const rows = await config.rows();
    const projectRow = rows.find((row) => row.id === "left:project:skill:claude-code:code-review")!;
    const globalRow = rows.find((row) => row.id === "right:global:skill:claude-code:global-only")!;

    expect(config.title).toBe("agent-stash browse");
    expect(projectRow.group).toBe("Project: claude-code");
    expect(globalRow.group).toBe("Global: claude-code");
    expect(config.actions.map((action) => [action.id, action.key])).toContainEqual(["copy", "c"]);

    await config.actions.find((action) => action.id === "copy")!.handler({
      row: projectRow,
      rows: [projectRow],
      filter: "",
      refresh: async () => undefined,
      suspendAnd: async (fn) => fn(),
      toast: () => undefined,
      confirm: async () => true,
      exit: () => undefined
    });

    expect(calls).toEqual([{
      action: "copy",
      selectedIds: ["project:skill:claude-code:code-review"],
      fromPane: "left"
    }]);
  });

  it("builds a two-pane TUI config whose actions route active pane rows", async () => {
    const { ctx } = createHarness();
    const calls: Array<{ action: string; selectedIds: string[]; fromPane?: string }> = [];
    const config = buildBrowseTwoPaneConfig(ctx, {
      scope: "project",
      agent: "claude-code",
      runAction: async (_ctx, options) => {
        calls.push({
          action: options.action,
          selectedIds: options.selectedIds,
          fromPane: options.fromPane
        });
        return {};
      }
    });

    const leftRows = await config.panes[0].rows();
    const projectRow = leftRows.find((row) => row.id === "project:skill:claude-code:code-review")!;

    expect(config.panes[0].title).toBe("Project: claude-code");
    expect(config.panes[1].title).toBe("Global: claude-code");
    expect(config.actions.map((action) => [action.id, action.key])).toContainEqual(["sync", "s"]);

    await config.actions.find((action) => action.id === "sync")!.handler({
      activePane: {
        id: "left",
        title: "Project: claude-code",
        rows: leftRows,
        cursor: 0,
        selected: new Set([projectRow.id]),
        filter: "",
        emptyHint: "No items"
      },
      inactivePane: {
        id: "right",
        title: "Global: claude-code",
        rows: [],
        cursor: 0,
        selected: new Set(),
        filter: "",
        emptyHint: "No items"
      },
      row: projectRow,
      rows: [projectRow],
      refresh: async () => undefined,
      suspendAnd: async (fn) => fn(),
      toast: () => undefined,
      exit: () => undefined
    });

    expect(calls).toEqual([{
      action: "sync",
      selectedIds: ["project:skill:claude-code:code-review"],
      fromPane: "left"
    }]);
  });

  it("titles the two-pane source pane from the selected scope", () => {
    const { ctx } = createHarness();
    const config = buildBrowseTwoPaneConfig(ctx, {
      scope: "global",
      agent: "claude-code"
    });

    expect(config.panes[0].title).toBe("Global: claude-code");
    expect(config.panes[1].title).toBe("Project: claude-code");
  });
});
