import { describe, it, expect, vi, beforeEach } from "vitest";
import { Volume, createFsFromVolume } from "memfs";
import type { Stats } from "node:fs";
import type { FileSystem } from "../../../../src/utils/file-system.js";

const clackSelect = vi.hoisted(() => vi.fn());
const clackIsCancel = vi.hoisted(() => vi.fn());

vi.mock("@poe-code/design-system", () => ({
  select: clackSelect,
  isCancel: clackIsCancel
}));

import { resolvePlanPath } from "./resolver.js";

function createMemFs(files: Record<string, string> = {}): FileSystem {
  const vol = Volume.fromJSON(files, "/");
  return createFsFromVolume(vol).promises as unknown as FileSystem;
}

function asPlanFs(fs: FileSystem): {
  readdir(path: string): Promise<string[]>;
  stat(path: string): Promise<Stats>;
  readFile(path: string, encoding: BufferEncoding): Promise<string>;
} {
  return {
    readdir: (path) => fs.readdir(path),
    stat: (path) => fs.stat(path),
    readFile: (path, encoding) => fs.readFile(path, encoding) as Promise<string>
  };
}

describe("resolvePlanPath", () => {
  beforeEach(() => {
    clackSelect.mockReset();
    clackIsCancel.mockReset();
    vi.restoreAllMocks();
  });

  it("returns the provided --plan path without scanning", async () => {
    const fs = createMemFs({
      "/repo/custom-plan.yaml": "version: 1\nproject: demo\nstories: []\n"
    });

    const readdirSpy = vi.spyOn(fs, "readdir");
    const selectSpy = clackSelect.mockResolvedValueOnce(".agents/tasks/ignored.yaml");
    clackIsCancel.mockReturnValue(false);

    const result = await resolvePlanPath({
      cwd: "/repo",
      plan: "custom-plan.yaml",
      fs: asPlanFs(fs)
    });

    expect(result).toBe("custom-plan.yaml");
    expect(readdirSpy).not.toHaveBeenCalled();
    expect(selectSpy).not.toHaveBeenCalled();
  });

  it("returns null when no plans exist", async () => {
    const fs = createMemFs({
      "/repo/README.md": "hi"
    });

    const result = await resolvePlanPath({
      cwd: "/repo",
      fs: asPlanFs(fs)
    });

    expect(result).toBeNull();
  });

  it("throws when no plans exist and assumeYes is true", async () => {
    const fs = createMemFs({
      "/repo/README.md": "hi"
    });

    await expect(
      resolvePlanPath({ cwd: "/repo", assumeYes: true, fs: asPlanFs(fs) })
    ).rejects.toThrow(/no plan found/i);
  });

  it("shows select prompt even when exactly one plan exists", async () => {
    const fs = createMemFs({
      "/repo/.agents/tasks/plan.yaml": "version: 1\nproject: demo\nstories: []\n"
    });

    clackSelect.mockResolvedValueOnce(".agents/tasks/plan.yaml");
    clackIsCancel.mockReturnValue(false);

    const result = await resolvePlanPath({
      cwd: "/repo",
      fs: asPlanFs(fs)
    });

    expect(result).toBe(".agents/tasks/plan.yaml");
    expect(clackSelect).toHaveBeenCalledWith(
      expect.objectContaining({
        options: [
          expect.objectContaining({ value: ".agents/tasks/plan.yaml" })
        ]
      })
    );
  });

  it("prompts with a select when multiple plans exist", async () => {
    const fs = createMemFs({
      "/repo/.agents/tasks/plan-one.yaml": "version: 1\nproject: one\nstories: []\n",
      "/repo/.agents/tasks/plan-two.yaml": "version: 1\nproject: two\nstories: []\n"
    });

    clackSelect.mockResolvedValueOnce(".agents/tasks/plan-two.yaml");
    clackIsCancel.mockReturnValue(false);

    const result = await resolvePlanPath({
      cwd: "/repo",
      fs: asPlanFs(fs)
    });

    expect(result).toBe(".agents/tasks/plan-two.yaml");
    expect(clackSelect).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.stringContaining("plan"),
        options: expect.arrayContaining([
          expect.objectContaining({ value: ".agents/tasks/plan-one.yaml" }),
          expect.objectContaining({ value: ".agents/tasks/plan-two.yaml" })
        ])
      })
    );
  });

  it("shows completion stats in the label", async () => {
    const planWithProgress = `
version: 1
project: test
stories:
  - id: story-1
    title: First story
    status: done
  - id: story-2
    title: Second story
    status: done
  - id: story-3
    title: Third story
    status: in_progress
  - id: story-4
    title: Fourth story
    status: open
`;
    const planNoStories = `
version: 1
project: empty
stories: []
`;

    const fs = createMemFs({
      "/repo/.agents/tasks/plan-progress.yaml": planWithProgress,
      "/repo/.agents/tasks/plan-empty.yaml": planNoStories
    });

    clackSelect.mockResolvedValueOnce(".agents/tasks/plan-progress.yaml");
    clackIsCancel.mockReturnValue(false);

    await resolvePlanPath({
      cwd: "/repo",
      fs: asPlanFs(fs)
    });

    expect(clackSelect).toHaveBeenCalledWith(
      expect.objectContaining({
        options: [
          { label: ".agents/tasks/plan-empty.yaml (0/0)", value: ".agents/tasks/plan-empty.yaml" },
          { label: ".agents/tasks/plan-progress.yaml (2/4)", value: ".agents/tasks/plan-progress.yaml" }
        ]
      })
    );
  });

  it("auto-selects first candidate when assumeYes is true", async () => {
    const fs = createMemFs({
      "/repo/.agents/tasks/plan-one.yaml": "version: 1\nproject: one\nstories: []\n",
      "/repo/.agents/tasks/plan-two.yaml": "version: 1\nproject: two\nstories: []\n"
    });

    const result = await resolvePlanPath({
      cwd: "/repo",
      assumeYes: true,
      fs: asPlanFs(fs)
    });

    expect(result).toBe(".agents/tasks/plan-one.yaml");
    expect(clackSelect).not.toHaveBeenCalled();
  });

  it("auto-selects single candidate without prompting when assumeYes is true", async () => {
    const fs = createMemFs({
      "/repo/.agents/tasks/plan.yaml": "version: 1\nproject: demo\nstories: []\n"
    });

    const result = await resolvePlanPath({
      cwd: "/repo",
      assumeYes: true,
      fs: asPlanFs(fs)
    });

    expect(result).toBe(".agents/tasks/plan.yaml");
    expect(clackSelect).not.toHaveBeenCalled();
  });

  it("returns null when the prompt is cancelled", async () => {
    const fs = createMemFs({
      "/repo/.agents/tasks/plan-one.yaml": "version: 1\nproject: one\nstories: []\n",
      "/repo/.agents/tasks/plan-two.yaml": "version: 1\nproject: two\nstories: []\n"
    });

    clackSelect.mockResolvedValueOnce(Symbol.for("cancel"));
    clackIsCancel.mockReturnValue(true);

    const result = await resolvePlanPath({
      cwd: "/repo",
      fs: asPlanFs(fs)
    });

    expect(result).toBeNull();
  });
});
