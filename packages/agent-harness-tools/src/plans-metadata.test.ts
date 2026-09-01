import { createFsFromVolume, Volume } from "memfs";
import { describe, expect, it } from "vitest";
import { archivePlan } from "./plans.js";

const selected = "/repo/plans/plan.md";
const archived = "/repo/plans/archive/plan.md";
const content =
  "---\nkind: pipeline\nversion: 1\nfinalization: teardown_completed\ntasks:\n  - id: work\n    status: done\n---\nKeep the completed work.\n";

describe("archive progress metadata", () => {
  it("commits finalization acknowledgement in the archive transition", async () => {
    const raw = createFsFromVolume(Volume.fromJSON({ [selected]: content })).promises;
    await archivePlan({
      cwd: "/repo",
      homeDir: "/home/test",
      planDirectory: "plans",
      id: "plan",
      fs: raw as unknown as NonNullable<Parameters<typeof archivePlan>[0]["fs"]>,
      metadataPatch: { finalization: "completed" }
    });
    const updated = String(await raw.readFile(archived, "utf8"));
    expect(updated).toContain("state: archived");
    expect(updated).toContain("finalization: completed");
    expect(updated).toContain("status: done");
    expect(updated).toContain("Keep the completed work.");
    await expect(raw.stat(selected)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("does not acknowledge a failed archive or overwrite its destination", async () => {
    const raw = createFsFromVolume(
      Volume.fromJSON({ [selected]: content, [archived]: "Older archive" })
    ).promises;
    await expect(
      archivePlan({
        cwd: "/repo",
        homeDir: "/home/test",
        planDirectory: "plans",
        id: "plan",
        fs: raw as unknown as NonNullable<Parameters<typeof archivePlan>[0]["fs"]>,
        metadataPatch: { finalization: "completed" }
      })
    ).rejects.toMatchObject({ name: "TaskAlreadyExistsError" });
    expect(await raw.readFile(selected, "utf8")).toBe(content);
    expect(await raw.readFile(archived, "utf8")).toBe("Older archive");
  });
});
