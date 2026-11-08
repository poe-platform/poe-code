import { describe, expect, it } from "vitest";
import { Volume, createFsFromVolume } from "memfs";
import { mergePlanFiles } from "./merge-plan-files.js";

function createMemFs(files: Record<string, string>) {
  const volume = Volume.fromJSON(files, "/");
  return {
    volume,
    fs: createFsFromVolume(volume) as unknown as Parameters<typeof mergePlanFiles>[0]["fs"]
  };
}

describe("merge plan files", () => {
  it("rejects a symlinked pipeline source plan", () => {
    const { volume, fs } = createMemFs({
      "/repo/docs/plans/probe.md": "---\nkind: feature\n---\nLOCAL TARGET\n",
      "/outside-plan.md": "---\nkind: pipeline\n---\nEXTERNAL PIPELINE INSTRUCTIONS\n"
    });
    volume.symlinkSync("/outside-plan.md", "/repo/docs/plans/plan-probe.md");

    expect(() => mergePlanFiles({ planFiles: ["/repo/docs/plans/plan-probe.md"], fs }))
      .toThrow(/symbolic link/i);
    expect(fs!.readFileSync("/repo/docs/plans/probe.md", "utf8")).toContain("LOCAL TARGET");
  });

  it("rejects a symlinked merge target plan", () => {
    const { volume, fs } = createMemFs({
      "/repo/docs/plans/plan-probe.md": "---\nkind: pipeline\n---\nPIPELINE BODY\n",
      "/outside.md": "---\nkind: feature\n---\nEXTERNAL ORIGINAL\n"
    });
    volume.symlinkSync("/outside.md", "/repo/docs/plans/probe.md");

    expect(() => mergePlanFiles({ planFiles: ["/repo/docs/plans/plan-probe.md"], fs }))
      .toThrow(/symbolic link/i);
    expect(fs!.readFileSync("/outside.md", "utf8")).toContain("EXTERNAL ORIGINAL");
    expect(fs!.existsSync("/repo/docs/plans/plan-probe.md")).toBe(true);
  });
});
