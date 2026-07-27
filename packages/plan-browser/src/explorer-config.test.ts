import { describe, expect, it, vi } from "vitest";
import { Volume, createFsFromVolume } from "memfs";
import type { ActionContext, Row } from "toolcraft-design";
import { buildPlanExplorerConfig } from "./explorer-config.js";
import type { ActionFs, DiscoveryFs, PlanEntry } from "./types.js";

function createMemFs(files: Record<string, string> = {}): ActionFs & DiscoveryFs {
  const volume = Volume.fromJSON(files, "/");
  return createFsFromVolume(volume).promises as unknown as ActionFs & DiscoveryFs;
}

function plan(overrides: Partial<PlanEntry> = {}): PlanEntry {
  return {
    path: "docs/plans/feature.md",
    absolutePath: "/repo/docs/plans/feature.md",
    kind: "plan",
    typeLabel: "Plan",
    detail: "design doc",
    format: "markdown",
    title: "Feature",
    updatedAt: 1,
    readiness: "draft",
    ...overrides
  };
}

function actionContext(row: Row, overrides: Partial<ActionContext<void>> = {}): ActionContext<void> {
  return {
    row,
    rows: [row],
    filter: "",
    refresh: vi.fn(async () => undefined),
    suspendAnd: vi.fn(async (fn) => fn()),
    toast: vi.fn(),
    confirm: vi.fn(async () => true),
    promptText: vi.fn(async () => null),
    exit: vi.fn(),
    ...overrides
  };
}

describe("buildPlanExplorerConfig", () => {
  it("maps plan entries to explorer rows and refreshes from onRefresh through the builder callback", async () => {
    const initial = plan({
      path: "docs/plans/feature.md",
      absolutePath: "/repo/docs/plans/feature.md",
      kind: "pipeline",
      typeLabel: "Pipeline",
      detail: "0/1 done"
    });
    const refreshed = plan({
      path: "docs/plans/fresh.md",
      absolutePath: "/repo/docs/plans/fresh.md",
      kind: "experiment",
      typeLabel: "Experiment",
      detail: "minimize / open"
    });
    const onRefresh = vi.fn(async () => [refreshed]);

    const config = buildPlanExplorerConfig({
      plans: [initial],
      fs: createMemFs(),
      variables: {},
      onRefresh
    });

    expect(config.title).toBe("Plans");
    expect(config.multiSelect).toBe(false);
    expect(config.emptyHint).toBe("No plans found");
    expect(config.mouse).toBe(false);
    const detailPane = config.panes?.[1];
    expect(detailPane?.title).toBe("Plan");
    expect(detailPane?.kind === "detail" ? detailPane.titleForRow?.((await config.rows())[0]) : undefined).toBe("/repo/docs/plans/feature.md");
    expect(config.reorder).toBeUndefined();
    expect(config.refresh).toEqual(expect.any(Function));
    await expect(config.rows()).resolves.toEqual([
      {
        id: "/repo/docs/plans/feature.md",
        title: "feature.md",
        subtitle: "0/1 done",
        badge: { text: "Pipeline" },
        group: "Active"
      }
    ]);
    expect(onRefresh).not.toHaveBeenCalled();

    await config.refresh!();
    await expect(config.rows()).resolves.toEqual([
      {
        id: "/repo/docs/plans/fresh.md",
        title: "fresh.md",
        subtitle: "minimize / open",
        badge: { text: "Experiment" },
        group: "Active"
      }
    ]);
    expect(onRefresh).toHaveBeenCalledOnce();
  });

  it("adds a trailing check only to ready plan titles", async () => {
    const draft = plan();
    const ready = plan({
      path: "docs/plans/ready.md",
      absolutePath: "/repo/docs/plans/ready.md",
      readiness: "ready"
    });
    const config = buildPlanExplorerConfig({
      plans: [ready, draft],
      fs: createMemFs(),
      variables: {},
      onRefresh: async () => [ready, draft]
    });

    expect((await config.rows()).map((row) => row.title)).toEqual(["ready.md ✓", "feature.md"]);
  });

  it("loads detail markdown for the matching entry", async () => {
    const entry = plan();
    const fs = createMemFs();
    const loadDetailMarkdown = vi.fn(async () => "# Feature\n\nPreview");
    const config = buildPlanExplorerConfig({
      plans: [entry],
      fs,
      variables: {},
      onRefresh: async () => [entry],
      loadDetailMarkdown
    });
    const [row] = await config.rows();

    const items = await config.detail.items(row!, {
      width: 80,
      height: 20,
      signal: new AbortController().signal,
      row: row!
    });

    expect(loadDetailMarkdown).toHaveBeenCalledWith(entry, fs);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ id: entry.absolutePath });
    expect(
      await items[0]!.render({
        width: 80,
        height: 20,
        signal: new AbortController().signal,
        row: row!
      })
    ).toBe("# Feature\n\nPreview");
  });

  it("abbreviates the home directory in the selected plan title", async () => {
    const entry = plan({
      absolutePath: "/Users/kjopek/Workspace/poe-code/docs/plans/feature.md"
    });
    const config = buildPlanExplorerConfig({
      plans: [entry],
      fs: createMemFs(),
      variables: {},
      homeDir: "/Users/kjopek",
      onRefresh: async () => [entry]
    });
    const detailPane = config.panes?.[1];

    expect(
      detailPane?.kind === "detail"
        ? detailPane.titleForRow?.((await config.rows())[0])
        : undefined
    ).toBe("~/Workspace/poe-code/docs/plans/feature.md");
  });

  it("collects the save reason in an in-layout text overlay", async () => {
    const entry = plan();
    const fs = createMemFs({ [entry.absolutePath]: "# Feature" });
    const config = buildPlanExplorerConfig({
      plans: [entry],
      fs,
      variables: {},
      onRefresh: async () => [entry]
    });
    const [row] = await config.rows();
    const ctx = actionContext(row!, { promptText: vi.fn(async () => "Waiting for API") });

    await config.actions.find((action) => action.id === "save-for-later")!.handler(ctx);

    expect(ctx.promptText).toHaveBeenCalledWith({
      title: "Save plan for later",
      label: "Why are you saving this plan for later?",
      placeholder: "Reason"
    });
    await expect(fs.readFile("/repo/docs/plans/later/feature.md", "utf8")).resolves.toContain("Waiting for API");
  });

  it("keeps duplicate visible rows bound to their displayed entries", async () => {
    const first = plan({
      path: "docs/plans/first.md",
      absolutePath: "/repo/docs/plans/shared.md",
      title: "First",
      detail: "first"
    });
    const second = plan({
      path: "docs/plans/second.md",
      absolutePath: "/repo/docs/plans/shared.md",
      title: "Second",
      detail: "second"
    });
    const config = buildPlanExplorerConfig({
      plans: [first, second],
      fs: createMemFs(),
      variables: {},
      onRefresh: async () => [first, second],
      loadDetailMarkdown: async (entry) => `# ${entry.title}`
    });
    const rows = await config.rows();

    expect(rows[0]?.id).not.toBe(rows[1]?.id);
    const items = await config.detail.items(rows[0]!, {
      width: 80,
      height: 20,
      signal: new AbortController().signal,
      row: rows[0]!
    });
    expect(
      items[0]!.render({
        width: 80,
        height: 20,
        signal: new AbortController().signal,
        row: rows[0]!
      })
    ).toBe("# First");
  });

  it("returns no detail items when the detail load is aborted", async () => {
    const entry = plan();
    let resolveLoad: (value: string) => void = () => undefined;
    const loadDetailMarkdown = vi.fn(
      () =>
        new Promise<string>((resolve) => {
          resolveLoad = resolve;
        })
    );
    const config = buildPlanExplorerConfig({
      plans: [entry],
      fs: createMemFs(),
      variables: {},
      onRefresh: async () => [entry],
      loadDetailMarkdown
    });
    const [row] = await config.rows();
    const controller = new AbortController();

    const pending = config.detail.items(row!, {
      width: 80,
      height: 20,
      signal: controller.signal,
      row: row!
    });
    controller.abort();

    await expect(pending).resolves.toEqual([]);
    resolveLoad("# Late");
  });

  it("edits a plan through suspendAnd, refreshes, and shows an info toast", async () => {
    const entry = plan({
      path: "docs/plans/edit-me.md",
      absolutePath: "/repo/docs/plans/edit-me.md"
    });
    const config = buildPlanExplorerConfig({
      plans: [entry],
      fs: createMemFs({ "/repo/docs/plans/edit-me.md": "# Edit me" }),
      variables: { EDITOR: "true" },
      onRefresh: async () => [entry]
    });
    const [row] = await config.rows();
    const ctx = actionContext(row!);

    await config.actions.find((action) => action.id === "edit")!.handler(ctx);

    expect(ctx.suspendAnd).toHaveBeenCalledOnce();
    expect(ctx.refresh).toHaveBeenCalledOnce();
    expect(ctx.toast).toHaveBeenCalledWith("Edited edit-me.md", "info");
  });

  it("archives and deletes plans with destructive actions", async () => {
    const archiveEntry = plan({
      path: "docs/plans/archive-me.md",
      absolutePath: "/repo/docs/plans/archive-me.md"
    });
    const deleteEntry = plan({
      path: "docs/plans/delete-me.md",
      absolutePath: "/repo/docs/plans/delete-me.md"
    });
    const fs = createMemFs({
      "/repo/docs/plans/archive-me.md": "# Archive",
      "/repo/docs/plans/delete-me.md": "# Delete"
    });
    const config = buildPlanExplorerConfig({
      plans: [archiveEntry, deleteEntry],
      fs,
      variables: {},
      onRefresh: async () => []
    });
    const rows = await config.rows();
    const archiveCtx = actionContext(rows[0]!);
    const deleteCtx = actionContext(rows[1]!);

    await config.actions.find((action) => action.id === "archive")!.handler(archiveCtx);
    await config.actions.find((action) => action.id === "delete")!.handler(deleteCtx);

    await expect(fs.readFile("/repo/docs/plans/archive/archive-me.md", "utf8")).resolves.toBe("# Archive");
    await expect(fs.readFile("/repo/docs/plans/delete-me.md", "utf8")).rejects.toThrow();
    expect(config.actions.find((action) => action.id === "archive")?.destructive).toBe(true);
    expect(config.actions.find((action) => action.id === "delete")?.destructive).toBe(true);
    expect(archiveCtx.toast).toHaveBeenCalledWith("Archived archive-me.md", "warning");
    expect(deleteCtx.toast).toHaveBeenCalledWith("Deleted delete-me.md", "error");
  });

  it("saves and restores plans for later while prompting only for the first reason", async () => {
    const activeEntry = plan({
      path: "docs/plans/active.md",
      absolutePath: "/repo/docs/plans/active.md"
    });
    const rememberedEntry = plan({
      path: "docs/plans/remembered.md",
      absolutePath: "/repo/docs/plans/remembered.md",
      savedForLater: { reason: "Existing reason" }
    });
    const laterEntry = plan({
      path: "docs/plans/later/deferred.md",
      absolutePath: "/repo/docs/plans/later/deferred.md",
      savedForLater: { reason: "Existing reason" }
    });
    const fs = createMemFs({
      "/repo/docs/plans/active.md": "# Active\n",
      "/repo/docs/plans/remembered.md": ["---", "saved_for_later:", "  reason: Existing reason", "---", "# Remembered"].join("\n"),
      "/repo/docs/plans/later/deferred.md": ["---", "saved_for_later:", "  reason: Existing reason", "---", "# Deferred"].join("\n")
    });
    const promptSaveReason = vi.fn(async () => "Blocked on API contract");
    const config = buildPlanExplorerConfig({
      plans: [activeEntry, rememberedEntry, laterEntry],
      fs,
      variables: {},
      onRefresh: async () => [],
      promptSaveReason
    });
    const rows = await config.rows();
    const saveAction = config.actions.find((action) => action.id === "save-for-later")!;

    await saveAction.handler(actionContext(rows[0]!));
    await saveAction.handler(actionContext(rows[1]!));
    await saveAction.handler(actionContext(rows[2]!));

    expect(promptSaveReason).toHaveBeenCalledOnce();
    await expect(fs.readFile("/repo/docs/plans/later/active.md", "utf8")).resolves.toContain("reason: Blocked on API contract");
    await expect(fs.readFile("/repo/docs/plans/later/remembered.md", "utf8")).resolves.toContain("reason: Existing reason");
    await expect(fs.readFile("/repo/docs/plans/deferred.md", "utf8")).resolves.toContain("reason: Existing reason");
  });

  it("labels saved-for-later rows with their own group and reason", async () => {
    const activeEntry = plan({
      path: "docs/plans/active.md",
      absolutePath: "/repo/docs/plans/active.md",
      detail: "design doc"
    });
    const laterEntry = plan({
      path: "docs/plans/later/deferred.md",
      absolutePath: "/repo/docs/plans/later/deferred.md",
      detail: "Deferred",
      savedForLater: { reason: "Blocked on API contract" }
    });
    const config = buildPlanExplorerConfig({
      plans: [activeEntry, laterEntry],
      fs: createMemFs(),
      variables: {},
      onRefresh: async () => [activeEntry, laterEntry]
    });

    await expect(config.rows()).resolves.toEqual([
      expect.objectContaining({
        title: "active.md",
        subtitle: "design doc",
        group: "Active"
      }),
      expect.objectContaining({
        title: "deferred.md",
        subtitle: "Deferred · Later: Blocked on API contract",
        group: "Saved for later"
      })
    ]);
  });

  it("reports completed destructive actions even when refreshing fails", async () => {
    const archiveEntry = plan({
      path: "docs/plans/archive.md",
      absolutePath: "/repo/docs/plans/archive.md"
    });
    const deleteEntry = plan({
      path: "docs/plans/delete.md",
      absolutePath: "/repo/docs/plans/delete.md"
    });
    const fs = createMemFs({
      "/repo/docs/plans/archive.md": "# Archive",
      "/repo/docs/plans/delete.md": "# Delete"
    });
    const config = buildPlanExplorerConfig({
      plans: [archiveEntry, deleteEntry],
      fs,
      variables: {},
      onRefresh: async () => []
    });
    const rows = await config.rows();
    const archiveCtx = actionContext(rows[0]!, {
      refresh: vi.fn(async () => {
        throw new Error("refresh failed");
      })
    });
    const deleteCtx = actionContext(rows[1]!, {
      refresh: vi.fn(async () => {
        throw new Error("refresh failed");
      })
    });

    await expect(config.actions.find((action) => action.id === "archive")!.handler(archiveCtx)).resolves.toBeUndefined();
    await expect(config.actions.find((action) => action.id === "delete")!.handler(deleteCtx)).resolves.toBeUndefined();
    expect(archiveCtx.toast).toHaveBeenCalledWith("Archived archive.md; refresh failed", "warning");
    expect(deleteCtx.toast).toHaveBeenCalledWith("Deleted delete.md; refresh failed", "error");
  });

  it("rebuilds entry lookups when rows refresh", async () => {
    const initial = plan({
      path: "docs/plans/old.md",
      absolutePath: "/repo/docs/plans/old.md"
    });
    const refreshed = plan({
      path: "docs/plans/new.md",
      absolutePath: "/repo/docs/plans/new.md"
    });
    const fs = createMemFs({ "/repo/docs/plans/new.md": "# New" });
    const config = buildPlanExplorerConfig({
      plans: [initial],
      fs,
      variables: {},
      onRefresh: async () => [refreshed]
    });

    await config.rows();
    await config.refresh!();
    const rows = await config.rows();
    await config.actions.find((action) => action.id === "archive")!.handler(actionContext(rows[0]!));

    await expect(fs.readFile("/repo/docs/plans/archive/new.md", "utf8")).resolves.toBe("# New");
  });

  it("does not expose a new-plan action", () => {
    const entry = plan();
    const config = buildPlanExplorerConfig({
      plans: [entry],
      fs: createMemFs(),
      variables: {},
      onRefresh: async () => [entry]
    });
    expect(config.actions.some((action) => action.id === "new")).toBe(false);
    expect(config.actions.some((action) => action.key === "n")).toBe(false);
  });
});
