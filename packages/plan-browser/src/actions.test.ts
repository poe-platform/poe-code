import { beforeEach, describe, expect, it, vi } from "vitest";
import { Volume, createFsFromVolume } from "memfs";
import {
  archivePlan,
  deletePlan,
  editFile,
  editPlan,
  resolveEditor,
  restorePlanFromLater,
  savePlanForLater
} from "./actions.js";
import type { ActionFs } from "./types.js";

function createMemFs(files: Record<string, string> = {}): ActionFs {
  return createMemVolume(files).fs;
}

function createMemVolume(files: Record<string, string> = {}): {
  fs: ActionFs;
  volume: InstanceType<typeof Volume>;
} {
  const volume = Volume.fromJSON(files, "/");
  return { fs: createFsFromVolume(volume).promises as unknown as ActionFs, volume };
}

async function withObjectPrototypeProperties<T>(
  properties: Record<string, unknown>,
  callback: () => Promise<T> | T
): Promise<T> {
  const originals = new Map<string, PropertyDescriptor | undefined>();
  for (const [key, value] of Object.entries(properties)) {
    originals.set(key, Object.getOwnPropertyDescriptor(Object.prototype, key));
    Object.defineProperty(Object.prototype, key, {
      configurable: true,
      value,
      writable: true
    });
  }

  try {
    return await callback();
  } finally {
    for (const [key, descriptor] of originals) {
      if (descriptor === undefined) {
        delete (Object.prototype as Record<string, unknown>)[key];
      } else {
        Object.defineProperty(Object.prototype, key, descriptor);
      }
    }
  }
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
    await expect(fs.readFile("/repo/.poe-code/ralph/plans/archive/plan.md", "utf8")).resolves.toBe(
      "# Plan"
    );
    await expect(fs.readFile("/repo/.poe-code/ralph/plans/plan.md", "utf8")).rejects.toThrow();
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

    await expect(fs.readFile("/repo/.poe-code/experiments/plan.md", "utf8")).rejects.toThrow();
  });

  it("refuses to archive the plan directory README", async () => {
    const fs = createMemFs({
      "/repo/docs/plans/README.md": "# Plans"
    });

    await expect(archivePlan({ absolutePath: "/repo/docs/plans/README.md" }, fs)).rejects.toThrow(
      "Refusing to archive plan directory README: /repo/docs/plans/README.md"
    );
    await expect(fs.readFile("/repo/docs/plans/README.md", "utf8")).resolves.toBe("# Plans");
  });

  it("refuses to delete the plan directory README", async () => {
    const fs = createMemFs({
      "/repo/docs/plans/README.md": "# Plans"
    });

    await expect(deletePlan({ absolutePath: "/repo/docs/plans/README.md" }, fs)).rejects.toThrow(
      "Refusing to delete plan directory README: /repo/docs/plans/README.md"
    );
    await expect(fs.readFile("/repo/docs/plans/README.md", "utf8")).resolves.toBe("# Plans");
  });

  it("saves a plan for later with a persisted frontmatter reason", async () => {
    const fs = createMemFs({
      "/repo/docs/plans/feature.md": "# Feature\n\nPlan body\n"
    });

    const savedPath = await savePlanForLater(
      {
        absolutePath: "/repo/docs/plans/feature.md",
        format: "markdown"
      },
      fs,
      { reason: "Blocked on API contract" }
    );

    expect(savedPath).toBe("/repo/docs/plans/later/feature.md");
    await expect(fs.readFile("/repo/docs/plans/feature.md", "utf8")).rejects.toThrow();
    await expect(fs.readFile("/repo/docs/plans/later/feature.md", "utf8")).resolves.toContain(
      "saved_for_later:\n  reason: Blocked on API contract"
    );
  });

  it("does not ask callers for a new reason when save-for-later metadata already exists", async () => {
    const fs = createMemFs({
      "/repo/docs/plans/feature.md": [
        "---",
        "saved_for_later:",
        "  reason: Existing reason",
        "---",
        "# Feature"
      ].join("\n")
    });

    await savePlanForLater(
      {
        absolutePath: "/repo/docs/plans/feature.md",
        format: "markdown",
        savedForLater: {
          reason: "Existing reason"
        }
      },
      fs,
      {}
    );

    await expect(fs.readFile("/repo/docs/plans/later/feature.md", "utf8")).resolves.toContain(
      "reason: Existing reason"
    );
  });

  it("restores a saved-for-later plan without deleting its reason", async () => {
    const fs = createMemFs({
      "/repo/docs/plans/later/feature.md": [
        "---",
        "saved_for_later:",
        "  reason: Existing reason",
        "---",
        "# Feature"
      ].join("\n")
    });

    const restoredPath = await restorePlanFromLater(
      {
        absolutePath: "/repo/docs/plans/later/feature.md"
      },
      fs
    );

    expect(restoredPath).toBe("/repo/docs/plans/feature.md");
    await expect(fs.readFile("/repo/docs/plans/feature.md", "utf8")).resolves.toContain(
      "reason: Existing reason"
    );
    await expect(fs.readFile("/repo/docs/plans/later/feature.md", "utf8")).rejects.toThrow();
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

  it("prefers VISUAL over EDITOR when both are set", () => {
    expect(resolveEditor({ VISUAL: "code --wait", EDITOR: "vim" })).toBe("code --wait");
  });

  it("keeps escaped spaces inside editor command tokens", () => {
    const spawnSync = vi.fn(() => ({ status: 0 }));

    editFile("/repo/docs/plans/plan.md", {
      env: {
        EDITOR: "/Applications/Visual\\ Studio\\ Code.app/Contents/Resources/app/bin/code --wait"
      },
      spawnSync
    });

    expect(spawnSync).toHaveBeenCalledWith(
      "/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code",
      ["--wait", "/repo/docs/plans/plan.md"],
      { stdio: "inherit" }
    );
  });

  it("throws when an editor cannot be launched", () => {
    const spawnSync = vi.fn(() => ({ error: new Error("spawn failed") }));

    expect(() =>
      editFile("/repo/docs/plans/plan.md", { env: { EDITOR: "code" }, spawnSync })
    ).toThrow("spawn failed");
  });

  it("opens the plan in the editor and reports a change", async () => {
    const { fs, volume } = createMemVolume({
      "/repo/.poe-code/pipeline/plans/plan.yaml": "kind: pipeline"
    });
    const spawnSync = vi.fn(() => {
      volume.writeFileSync(
        "/repo/.poe-code/pipeline/plans/plan.yaml",
        "kind: pipeline\nversion: 1"
      );
      return { status: 0 };
    });

    await expect(
      editPlan("/repo/.poe-code/pipeline/plans/plan.yaml", {
        env: { EDITOR: "code" },
        spawnSync,
        fs
      })
    ).resolves.toEqual({ changed: true });

    expect(spawnSync).toHaveBeenCalledWith("code", ["/repo/.poe-code/pipeline/plans/plan.yaml"], {
      stdio: "inherit"
    });
  });

  it("reports no change when the editor leaves the plan untouched", async () => {
    const { fs } = createMemVolume({ "/repo/docs/plans/plan.md": "# Plan" });
    const spawnSync = vi.fn(() => ({ status: 0 }));

    await expect(
      editPlan("/repo/docs/plans/plan.md", { env: { EDITOR: "true" }, spawnSync, fs })
    ).resolves.toEqual({ changed: false });
  });

  it("reports a change when the editor removes the plan", async () => {
    const { fs, volume } = createMemVolume({ "/repo/docs/plans/plan.md": "# Plan" });
    const spawnSync = vi.fn(() => {
      volume.unlinkSync("/repo/docs/plans/plan.md");
      return { status: 0 };
    });

    await expect(
      editPlan("/repo/docs/plans/plan.md", { env: { EDITOR: "code" }, spawnSync, fs })
    ).resolves.toEqual({ changed: true });
  });

  it("fails fast when no editor env is set instead of guessing an editor", () => {
    expect(() => resolveEditor({})).toThrow("Set $EDITOR");
  });

  it("treats a blank editor env value as unset", () => {
    expect(() => resolveEditor({ EDITOR: "   " })).toThrow("Set $EDITOR");
  });

  it("does not spawn anything when no editor env is set", () => {
    const spawnSync = vi.fn();

    expect(() => editFile("/repo/docs/plans/plan.md", { env: {}, spawnSync })).toThrow(
      "Set $EDITOR"
    );
    expect(spawnSync).not.toHaveBeenCalled();
  });

  it("ignores inherited editor env values", async () => {
    await withObjectPrototypeProperties({ EDITOR: "polluted-editor" }, () => {
      expect(() => resolveEditor({})).toThrow("Set $EDITOR");
    });
  });

  it("does not overwrite an existing archived plan", async () => {
    const fs = createMemFs({
      "/repo/docs/plans/plan.md": "# Current",
      "/repo/docs/plans/archive/plan.md": "# Historic"
    });

    await expect(archivePlan({ absolutePath: "/repo/docs/plans/plan.md" }, fs)).rejects.toThrow(
      "Archive destination already exists"
    );
    await expect(fs.readFile("/repo/docs/plans/archive/plan.md", "utf8")).resolves.toBe(
      "# Historic"
    );
  });

  it("does not treat inherited archive read error codes as missing destinations", async () => {
    const raw = createMemFs({ "/repo/docs/plans/plan.md": "# Current" });
    const fs: ActionFs = {
      ...raw,
      readFile: vi.fn(async (filePath, encoding) => {
        if (filePath === "/repo/docs/plans/archive/plan.md") {
          throw new Error("archive read denied");
        }

        return raw.readFile(filePath, encoding);
      })
    };

    await withObjectPrototypeProperties({ code: "ENOENT" }, async () => {
      await expect(archivePlan({ absolutePath: "/repo/docs/plans/plan.md" }, fs)).rejects.toThrow(
        "archive read denied"
      );
    });
  });

  it("rejects a symlinked archive directory", async () => {
    const volume = Volume.fromJSON(
      {
        "/repo/docs/plans/plan.md": "# Current",
        "/outside/.keep": ""
      },
      "/"
    );
    volume.symlinkSync("/outside", "/repo/docs/plans/archive");
    const fs = createFsFromVolume(volume).promises as unknown as ActionFs;

    await expect(archivePlan({ absolutePath: "/repo/docs/plans/plan.md" }, fs)).rejects.toThrow(
      /symbolic link/i
    );
    await expect(fs.readFile("/repo/docs/plans/plan.md", "utf8")).resolves.toBe("# Current");
    await expect(fs.readFile("/outside/plan.md", "utf8")).rejects.toThrow();
  });

  it("does not treat inherited archive lstat error codes as missing directories", async () => {
    const raw = createMemFs({ "/repo/docs/plans/plan.md": "# Current" });
    const fs: ActionFs = {
      ...raw,
      lstat: vi.fn(async (filePath) => {
        if (filePath === "/repo/docs/plans/archive") {
          throw new Error("archive lstat denied");
        }

        return raw.lstat(filePath);
      })
    };

    await withObjectPrototypeProperties({ code: "ENOENT" }, async () => {
      await expect(archivePlan({ absolutePath: "/repo/docs/plans/plan.md" }, fs)).rejects.toThrow(
        "archive lstat denied"
      );
    });
  });

  it("removes a newly created archive directory when moving fails", async () => {
    const raw = createMemFs({ "/repo/docs/plans/plan.md": "# Current" });
    const fs: ActionFs = {
      ...raw,
      rename: async () => {
        throw new Error("move failed");
      }
    };

    await expect(archivePlan({ absolutePath: "/repo/docs/plans/plan.md" }, fs)).rejects.toThrow(
      "move failed"
    );
    await expect(raw.readFile("/repo/docs/plans/plan.md", "utf8")).resolves.toBe("# Current");
    await expect(raw.readFile("/repo/docs/plans/archive/plan.md", "utf8")).rejects.toThrow();
    await expect(
      (raw as unknown as { readdir(path: string): Promise<string[]> }).readdir(
        "/repo/docs/plans/archive"
      )
    ).rejects.toThrow();
  });
});
