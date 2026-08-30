import { fs, vol } from "memfs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("node:fs/promises", async () => (await import("memfs")).fs.promises);

const { dump } = await import("./dump.js");
const { run } = await import("./run.js");
const { migrateSnapshotFile } = await import("./migration-file.js");

describe("snapshot migration files", () => {
  afterEach(() => vi.restoreAllMocks());
  beforeEach(async () => {
    vol.reset();
    const execution = run("return 1;");
    await execution;
    vol.fromJSON({
      "/repo/old.ajs": "return 1;",
      "/repo/new.ajs": "return import.meta.migration.count;",
      "/repo/old.json": await dump(execution)
    });
  });

  async function prepare() {
    const options = { cwd: "/repo", snapshotPath: "old.json", sourcePath: "old.ajs" };
    const result = await migrateSnapshotFile({ ...options, inspect: true });
    await fs.promises.writeFile(
      "/repo/plan.json",
      JSON.stringify({
        state: { count: 2 },
        reconciliation: {
          checkpointDigest: result.inspection.checkpointDigest,
          quiescent: true,
          calls: []
        }
      })
    );
    return {
      ...options,
      targetSourcePath: "new.ajs",
      planPath: "plan.json",
      outputPath: "next.json"
    };
  }

  it("inspects without writes, then exclusively publishes a portable continuation", async () => {
    const before = vol.toJSON();
    const result = await migrateSnapshotFile({
      cwd: "/repo",
      snapshotPath: "old.json",
      sourcePath: "old.ajs",
      inspect: true
    });
    expect(result.inspection.unresolvedCalls).toEqual([]);
    expect(vol.toJSON()).toEqual(before);
    const options = await prepare();
    expect((await migrateSnapshotFile(options)).outputPath).toBe("/repo/next.json");
    const snapshot = JSON.parse(await fs.promises.readFile("/repo/next.json", "utf8"));
    expect((await run("return import.meta.migration.count;", { snapshot })).returnValue).toBe(2);
    expect(await fs.promises.readFile("/repo/old.json", "utf8")).toBe(before["/repo/old.json"]);
    expect(Object.keys(vol.toJSON()).filter((name) => name.endsWith(".tmp"))).toEqual([]);
  });

  it.each(["old.json", "old.ajs", "plan.json", "existing.json", "linked.json"])(
    "never overwrites an existing output: %s",
    async (outputPath) => {
      const options = await prepare();
      await fs.promises.writeFile("/repo/existing.json", "preserved");
      await fs.promises.symlink("/repo/old.json", "/repo/linked.json");
      const before = vol.toJSON();
      await expect(migrateSnapshotFile({ ...options, outputPath })).rejects.toMatchObject({
        code: "EEXIST",
        message: expect.stringContaining("Choose a new output path")
      });
      expect(vol.toJSON()).toEqual(before);
    }
  );

  it("validates dry runs without publishing files", async () => {
    const options = await prepare();
    const before = vol.toJSON();
    await migrateSnapshotFile({ ...options, dryRun: true });
    expect(vol.toJSON()).toEqual(before);
    await fs.promises.writeFile("/repo/plan.json", '{"state":2}');
    await expect(migrateSnapshotFile({ ...options, dryRun: true })).rejects.toThrow();
  });

  it("cleans partially written temporary files after a storage failure", async () => {
    const options = await prepare();
    const before = vol.toJSON();
    const filesystem = await import("node:fs/promises");
    const originalOpen = filesystem.open;
    vi.spyOn(filesystem, "open").mockImplementation(async (...args) => {
      const handle = await originalOpen(...args);
      const write = handle.writeFile.bind(handle);
      vi.spyOn(handle, "writeFile").mockImplementation(async () => {
        await write("partial", "utf8");
        throw Object.assign(new Error("disk full"), { code: "ENOSPC" });
      });
      return handle;
    });
    await expect(migrateSnapshotFile(options)).rejects.toMatchObject({ code: "ENOSPC" });
    expect(vol.toJSON()).toEqual(before);
  });

  it.each([
    "missing-state",
    "missing-target",
    "blank-output",
    "wrong-source",
    "inspection-output",
    "invalid-json"
  ])("rejects invalid file requests without publishing: %s", async (mode) => {
    const options = await prepare();
    if (mode === "missing-state") {
      const plan = JSON.parse(await fs.promises.readFile("/repo/plan.json", "utf8"));
      delete plan.state;
      await fs.promises.writeFile("/repo/plan.json", JSON.stringify(plan));
    }
    if (mode === "invalid-json") await fs.promises.writeFile("/repo/plan.json", "{");
    const before = vol.toJSON();
    await expect(
      migrateSnapshotFile({
        ...options,
        ...(mode === "missing-target" ? { targetSourcePath: undefined } : {}),
        ...(mode === "blank-output" ? { outputPath: " " } : {}),
        ...(mode === "wrong-source" ? { sourcePath: "new.ajs" } : {}),
        ...(mode === "inspection-output" ? { inspect: true } : {})
      })
    ).rejects.toThrow();
    expect(vol.toJSON()).toEqual(before);
  });
});
