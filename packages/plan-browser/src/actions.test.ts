import { beforeEach, describe, expect, it, vi } from "vitest";
import { Volume, createFsFromVolume } from "memfs";
import { archivePlan, deletePlan, editFile, editPlan, resolveEditor } from "./actions.js";
import type { ActionFs } from "./types.js";

function createMemFs(files: Record<string, string> = {}): ActionFs {
  const volume = Volume.fromJSON(files, "/");
  return createFsFromVolume(volume).promises as unknown as ActionFs;
}

describe("plan actions", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("archives a plan into an archive subdirectory", async () => {
    const fs = createMemFs({
      "/repo/.poe-code/ralph/plans/plan.md": "# Plan"
    });

    const archivedPath = await archivePlan(
      {
        absolutePath: "/repo/.poe-code/ralph/plans/plan.md"
      },
      fs
    );

    expect(archivedPath).toBe("/repo/.poe-code/ralph/plans/archive/plan.md");
    await expect(
      fs.readFile("/repo/.poe-code/ralph/plans/archive/plan.md", "utf8")
    ).resolves.toBe("# Plan");
    await expect(
      fs.readFile("/repo/.poe-code/ralph/plans/plan.md", "utf8")
    ).rejects.toThrow();
  });

  it("deletes a plan", async () => {
    const fs = createMemFs({
      "/repo/.poe-code/experiments/plan.md": "# Plan"
    });

    await deletePlan(
      {
        absolutePath: "/repo/.poe-code/experiments/plan.md"
      },
      fs
    );

    await expect(
      fs.readFile("/repo/.poe-code/experiments/plan.md", "utf8")
    ).rejects.toThrow();
  });

  it("opens a file in the resolved editor", () => {
    const spawnSync = vi.fn();

    editFile("/repo/.poe-code/pipeline/plans/plan.yaml", {
      env: { EDITOR: "code" },
      spawnSync
    });

    expect(spawnSync).toHaveBeenCalledWith("code", ["/repo/.poe-code/pipeline/plans/plan.yaml"], {
      stdio: "inherit"
    });
  });

  it("passes editor flags before the file path", () => {
    const spawnSync = vi.fn(() => ({ status: 0 }));

    editFile("/repo/docs/plans/plan.md", { env: { EDITOR: "code --wait" }, spawnSync });

    expect(spawnSync).toHaveBeenCalledWith("code", ["--wait", "/repo/docs/plans/plan.md"], {
      stdio: "inherit"
    });
  });

  it("throws when an editor cannot be launched", () => {
    const spawnSync = vi.fn(() => ({ error: new Error("spawn failed") }));

    expect(() => editFile("/repo/docs/plans/plan.md", { env: { EDITOR: "code" }, spawnSync }))
      .toThrow("spawn failed");
  });

  it("keeps editPlan as a compatibility wrapper", () => {
    const spawnSync = vi.fn();

    editPlan("/repo/.poe-code/pipeline/plans/plan.yaml", {
      env: { EDITOR: "code" },
      spawnSync
    });

    expect(spawnSync).toHaveBeenCalledWith("code", ["/repo/.poe-code/pipeline/plans/plan.yaml"], {
      stdio: "inherit"
    });
  });

  it("falls back to vi when no editor env is set", () => {
    expect(resolveEditor({})).toBe("vi");
  });

  it("does not overwrite an existing archived plan", async () => {
    const fs = createMemFs({
      "/repo/docs/plans/plan.md": "# Current",
      "/repo/docs/plans/archive/plan.md": "# Historic"
    });

    await expect(archivePlan({ absolutePath: "/repo/docs/plans/plan.md" }, fs))
      .rejects.toThrow("Archive destination already exists");
    await expect(fs.readFile("/repo/docs/plans/archive/plan.md", "utf8")).resolves.toBe("# Historic");
  });
});
