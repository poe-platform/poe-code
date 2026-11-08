import { createFsFromVolume, Volume } from "memfs";
import { expect, it } from "vitest";
import { writeTaskStatus } from "./writer.js";
import type { PipelineFileSystem } from "../types.js";

it("updates status without creating or consulting disk locks", async () => {
  const planPath = "/repo/plan.md";
  const raw = createFsFromVolume(Volume.fromJSON({
    [planPath]: "---\nkind: pipeline\nversion: 1\ntasks:\n  - id: work\n    title: Work\n    prompt: work\n    status: open\n---\n",
    "/repo/.plan.md.pipeline-status.lock": "abandoned"
  })).promises;
  const fs = {
    ...raw,
    async writeFile(file: string, content: string, options: { encoding?: BufferEncoding; flag?: string }) {
      if (file.endsWith(".lock")) throw new Error("Disk locks are forbidden");
      await raw.writeFile(file, content, options);
    }
  } as unknown as PipelineFileSystem;
  await writeTaskStatus({ fs, planPath, taskId: "work", status: "done" });
  expect(await raw.readFile(planPath, "utf8")).toContain("status: done");
  expect(await raw.readFile("/repo/.plan.md.pipeline-status.lock", "utf8")).toBe("abandoned");
});
