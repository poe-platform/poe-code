import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Volume, createFsFromVolume } from "memfs";
import { resolveConfigPath, resolveProjectConfigPath } from "@poe-code/poe-code-config/core";
import type { ActionContext, Row } from "toolcraft-design";
import { buildPlanExplorerConfig } from "./explorer-config.js";
import { runPlanBrowser } from "./browser.js";
import type { ActionFs, DiscoveryFs, PlanEntry } from "./types.js";

const {
  archivePlanMock,
  deletePlanMock,
  editFileMock,
  restorePlanFromLaterMock,
  savePlanForLaterMock,
  unarchivePlanMock
} = vi.hoisted(() => ({
  archivePlanMock: vi.fn(async () => "/repo/docs/plans/archive/feature.md"),
  deletePlanMock: vi.fn(async () => undefined),
  editFileMock: vi.fn(),
  restorePlanFromLaterMock: vi.fn(async () => "/repo/docs/plans/feature.md"),
  savePlanForLaterMock: vi.fn(async () => "/repo/docs/plans/later/feature.md"),
  unarchivePlanMock: vi.fn(async () => "/repo/docs/plans/feature.md")
}));

vi.mock("./actions.js", () => ({
  archivePlan: archivePlanMock,
  deletePlan: deletePlanMock,
  editFile: editFileMock,
  restorePlanFromLater: restorePlanFromLaterMock,
  savePlanForLater: savePlanForLaterMock,
  unarchivePlan: unarchivePlanMock
}));

const cwd = "/repo";
const homeDir = "/home/test";
const stdinTTYDescriptor = Object.getOwnPropertyDescriptor(process.stdin, "isTTY");

function createMemFs(files: Record<string, string> = {}): ActionFs & DiscoveryFs {
  const volume = Volume.fromJSON(files, "/");
  volume.mkdirSync(cwd, { recursive: true });
  volume.mkdirSync(homeDir, { recursive: true });
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
    ...overrides
  };
}

function actionContext(row: Row): ActionContext<void> {
  return {
    row,
    rows: [row],
    filter: "",
    refresh: vi.fn(async () => undefined),
    suspendAnd: vi.fn(async (fn) => fn()),
    toast: vi.fn(),
    confirm: vi.fn(async () => true),
    promptText: vi.fn(async () => null),
    exit: vi.fn()
  };
}

function setStdinTTY(value: boolean): void {
  Object.defineProperty(process.stdin, "isTTY", {
    configurable: true,
    value
  });
}

function restoreStdinTTY(): void {
  if (stdinTTYDescriptor === undefined) {
    delete (process.stdin as { isTTY?: boolean }).isTTY;
    return;
  }

  Object.defineProperty(process.stdin, "isTTY", stdinTTYDescriptor);
}

beforeEach(() => {
  vi.spyOn(process.stdout, "write").mockImplementation(() => true);
});

afterEach(() => {
  restoreStdinTTY();
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe("plan browser", () => {
  it("offers unarchive in archived browsing", async () => {
    const archivedPlan = plan({
      path: "docs/plans/archive/feature.md",
      absolutePath: "/repo/docs/plans/archive/feature.md"
    });
    const fs = createMemFs({ "/repo/docs/plans/archive/feature.md": "# Feature" });
    const config = buildPlanExplorerConfig({
      plans: [archivedPlan],
      fs,
      variables: {},
      archived: true,
      onRefresh: async () => [archivedPlan]
    });

    expect(config.actions.map((action) => action.id)).toEqual(["edit", "unarchive", "delete"]);
    expect(config.reorder).toBeUndefined();

    const rows = await config.rows();
    const ctx = actionContext(rows[0]!);
    await config.actions.find((action) => action.id === "unarchive")!.handler(ctx);

    expect(unarchivePlanMock).toHaveBeenCalledWith(archivedPlan, fs);
    expect(ctx.refresh).toHaveBeenCalledOnce();
    expect(ctx.toast).toHaveBeenCalledWith("Unarchived feature.md", "info");
  });

  it("maps rows and wires explorer action handlers to plan actions", async () => {
    const pipelinePlan = plan({
      path: "docs/plans/feature.md",
      absolutePath: "/repo/docs/plans/feature.md",
      kind: "pipeline",
      typeLabel: "Pipeline",
      detail: "0/1 done"
    });
    const experimentPlan = plan({
      path: "docs/plans/metric.md",
      absolutePath: "/repo/docs/plans/metric.md",
      kind: "experiment",
      typeLabel: "Experiment",
      detail: "minimize / open"
    });
    const fs = createMemFs({
      "/repo/docs/plans/feature.md": "# Feature",
      "/repo/docs/plans/metric.md": "# Metric"
    });
    const variables = { EDITOR: "true" };
    const config = buildPlanExplorerConfig({
      plans: [pipelinePlan, experimentPlan],
      fs,
      variables,
      onRefresh: async () => [pipelinePlan, experimentPlan]
    });

    const rows = await config.rows();
    expect(rows).toEqual([
      {
        id: "/repo/docs/plans/feature.md",
        title: "feature.md",
        subtitle: "0/1 done",
        badge: { text: "Pipeline" },
        group: "Active"
      },
      {
        id: "/repo/docs/plans/metric.md",
        title: "metric.md",
        subtitle: "minimize / open",
        badge: { text: "Experiment" },
        group: "Active"
      }
    ]);

    const editCtx = actionContext(rows[0]!);
    const archiveCtx = actionContext(rows[0]!);
    const deleteCtx = actionContext(rows[1]!);

    await config.actions.find((action) => action.id === "edit")!.handler(editCtx);
    await config.actions.find((action) => action.id === "archive")!.handler(archiveCtx);
    await config.actions.find((action) => action.id === "delete")!.handler(deleteCtx);

    expect(editFileMock).toHaveBeenCalledOnce();
    expect(editFileMock).toHaveBeenCalledWith("/repo/docs/plans/feature.md", { env: variables });
    expect(archivePlanMock).toHaveBeenCalledOnce();
    expect(archivePlanMock).toHaveBeenCalledWith(pipelinePlan, fs);
    expect(deletePlanMock).toHaveBeenCalledOnce();
    expect(deletePlanMock).toHaveBeenCalledWith(experimentPlan, fs);
    expect(editCtx.suspendAnd).toHaveBeenCalledOnce();
    expect(archiveCtx.refresh).toHaveBeenCalledOnce();
    expect(deleteCtx.refresh).toHaveBeenCalledOnce();
  });

  it("never dumps a plan body when stdin is not a TTY and lists candidates instead", async () => {
    const fs = createMemFs({
      "/repo/docs/plans/feature.md": "# Feature\n\nPreview body",
      "/repo/docs/plans/second.md": "# Second\n\nOther body"
    });
    const runExplorerImpl = vi.fn(async () => null);
    const stdoutWrite = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    setStdinTTY(false);

    // Plans are listed newest-first, so their relative order depends on mtime.
    // Assert both candidates are listed without pinning the order.
    const error = await runPlanBrowser({
      cwd,
      homeDir,
      configPath: resolveConfigPath(homeDir),
      projectConfigPath: resolveProjectConfigPath(cwd),
      fs,
      variables: {},
      runExplorerImpl
    }).catch((thrown: unknown) => thrown as Error);

    expect(error.message).toContain("Plan browsing needs an interactive terminal");
    expect(error.message).toContain("docs/plans/feature.md");
    expect(error.message).toContain("docs/plans/second.md");

    expect(runExplorerImpl).not.toHaveBeenCalled();
    expect(stdoutWrite.mock.calls.map(([chunk]) => String(chunk)).join("")).not.toContain(
      "Preview body"
    );
  });

  it("never dumps a plan body when stdin TTY status is undefined", async () => {
    const fs = createMemFs({
      "/repo/docs/plans/feature.md": "# Feature\n\nPreview body"
    });
    const runExplorerImpl = vi.fn(async () => null);
    const stdoutWrite = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    Object.defineProperty(process.stdin, "isTTY", {
      configurable: true,
      value: undefined
    });

    await expect(
      runPlanBrowser({
        cwd,
        homeDir,
        configPath: resolveConfigPath(homeDir),
        projectConfigPath: resolveProjectConfigPath(cwd),
        fs,
        variables: {},
        runExplorerImpl
      })
    ).rejects.toThrow(/docs\/plans\/feature\.md/);

    expect(runExplorerImpl).not.toHaveBeenCalled();
    expect(stdoutWrite.mock.calls.map(([chunk]) => String(chunk)).join("")).not.toContain(
      "Preview body"
    );
  });

  it("writes no-plans output without launching the explorer", async () => {
    const fs = createMemFs();
    const runExplorerImpl = vi.fn(async () => null);
    const stdoutWrite = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    setStdinTTY(true);

    await runPlanBrowser({
      cwd,
      homeDir,
      configPath: resolveConfigPath(homeDir),
      projectConfigPath: resolveProjectConfigPath(cwd),
      fs,
      variables: {},
      runExplorerImpl
    });

    expect(runExplorerImpl).not.toHaveBeenCalled();
    expect(stdoutWrite).toHaveBeenCalledWith("No plans found.\n");
  });

  it("launches the explorer with discovered plans and refreshes through discovery", async () => {
    const fs = createMemFs({
      "/repo/docs/plans/feature.md": "# Feature",
      "/repo/docs/plans/second.md": "# Second"
    });
    const timedFs = fs as ActionFs &
      DiscoveryFs & {
        utimes(path: string, atime: Date, mtime: Date): Promise<void>;
      };
    await timedFs.utimes("/repo/docs/plans/feature.md", new Date(2), new Date(2));
    await timedFs.utimes("/repo/docs/plans/second.md", new Date(1), new Date(1));
    const runExplorerImpl = vi.fn(async (config) => {
      const rows = await config.rows();
      expect(rows.map((row) => row.title)).toEqual(["feature.md", "second.md"]);

      await fs.unlink("/repo/docs/plans/second.md");
      await config.refresh!();
      await expect(config.rows()).resolves.toEqual([
        expect.objectContaining({ title: "feature.md" })
      ]);
      expect(config.actions.some((action) => action.id === "new")).toBe(false);
      return null;
    });
    setStdinTTY(true);

    await runPlanBrowser({
      cwd,
      homeDir,
      configPath: resolveConfigPath(homeDir),
      projectConfigPath: resolveProjectConfigPath(cwd),
      fs,
      variables: {},
      runExplorerImpl
    });

    expect(runExplorerImpl).toHaveBeenCalledOnce();
  });
});
