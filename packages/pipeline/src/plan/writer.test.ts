import { describe, expect, it } from "bun:test";
import { Volume, createFsFromVolume } from "memfs";
import { readPlanFile, writeTaskStatus } from "./writer.js";

type TestFs = ReturnType<typeof createFsFromVolume>["promises"];

function createFs(files: Record<string, string>): TestFs {
  const volume = Volume.fromJSON(files, "/");
  return createFsFromVolume(volume).promises;
}

describe("writeTaskStatus", () => {
  it("updates a stepless task status to done", async () => {
    const fs = createFs({
      "/repo/plan.yaml": [
        "tasks:",
        "  - id: task-1",
        "    title: One",
        "    prompt: First",
        "    status: open",
        ""
      ].join("\n")
    });

    await writeTaskStatus({
      fs,
      planPath: "/repo/plan.yaml",
      taskId: "task-1",
      status: "done"
    });

    await expect(readPlanFile(fs, "/repo/plan.yaml")).resolves.toContain("status: done");
  });

  it("updates only a single step status", async () => {
    const fs = createFs({
      "/repo/plan.yaml": [
        "tasks:",
        "  - id: task-1",
        "    title: One",
        "    prompt: First",
        "    status:",
        "      implement: done",
        "      test: open",
        "      commit: open",
        ""
      ].join("\n")
    });

    await writeTaskStatus({
      fs,
      planPath: "/repo/plan.yaml",
      taskId: "task-1",
      stepName: "test",
      status: "failed"
    });

    const contents = await readPlanFile(fs, "/repo/plan.yaml");
    expect(contents).toContain("implement: done");
    expect(contents).toContain("test: failed");
    expect(contents).toContain("commit: open");
  });

  it("preserves prior changes across multiple writes", async () => {
    const fs = createFs({
      "/repo/plan.yaml": [
        "tasks:",
        "  - id: task-1",
        "    title: One",
        "    prompt: First",
        "    status:",
        "      implement: open",
        "      test: open",
        ""
      ].join("\n")
    });

    await writeTaskStatus({
      fs,
      planPath: "/repo/plan.yaml",
      taskId: "task-1",
      stepName: "implement",
      status: "done"
    });
    await writeTaskStatus({
      fs,
      planPath: "/repo/plan.yaml",
      taskId: "task-1",
      stepName: "test",
      status: "done"
    });

    const contents = await readPlanFile(fs, "/repo/plan.yaml");
    expect(contents).toContain("implement: done");
    expect(contents).toContain("test: done");
  });
});
