import { createFsFromVolume, Volume } from "memfs";
import { parse, stringify } from "yaml";
import { describe, expect, it } from "vitest";
import type { PipelineFileSystem } from "../types.js";
import { parsePlan, pipelineDocumentSchema } from "./parser.js";
import { writeTaskStatus } from "./writer.js";

const planPath = "/repo/plan.md";
const states = ["pending", "teardown_completed", "completed"];

function document(finalization?: unknown, steps = false) {
  return `---\n${stringify({
    kind: "pipeline",
    version: 1,
    ...(finalization !== undefined ? { finalization } : {}),
    tasks: [
      {
        id: "work",
        title: "Work",
        prompt: "Work",
        status: steps ? { implement: "open", test: "open" } : "open"
      }
    ]
  })}---\nKeep this body.\n`;
}

describe("pipeline finalization progress", () => {
  it.each(states)("parses durable %s progress", (finalization) => {
    expect(parsePlan(document(finalization)).finalization).toBe(finalization);
  });

  it.each([null, false, 1, "failed", {}, []].map((value) => ({ value })))(
    "rejects invalid finalization state $value",
    ({ value }) => {
      expect(() => parsePlan(document(value))).toThrow("finalization");
    }
  );

  it("publishes the same progress states in the document schema", () => {
    expect(pipelineDocumentSchema.properties?.finalization).toMatchObject({
      type: "string",
      enum: states
    });
  });

  it.each([false, true])(
    "commits task status and pending finalization in one atomic write (step: %s)",
    async (steps) => {
      const original = document(undefined, steps);
      const raw = createFsFromVolume(Volume.fromJSON({ [planPath]: original })).promises;
      const snapshots: Array<{ before: string; after: string }> = [];
      const fs: PipelineFileSystem = {
        ...(raw as unknown as PipelineFileSystem),
        async rename(from, to) {
          if (to === planPath)
            snapshots.push({
              before: String(await raw.readFile(to, "utf8")),
              after: String(await raw.readFile(from, "utf8"))
            });
          await raw.rename(from, to);
        }
      };
      await writeTaskStatus({
        fs,
        planPath,
        taskId: "work",
        status: "done",
        finalization: "pending",
        ...(steps ? { stepName: "implement" } : {})
      });
      expect(snapshots).toHaveLength(1);
      expect(snapshots[0].before).toBe(original);
      expect(parsePlan(snapshots[0].after)).toMatchObject({
        finalization: "pending",
        tasks: [{ status: steps ? { implement: "done", test: "open" } : "done" }]
      });
      expect(await raw.readFile(planPath, "utf8")).toBe(snapshots[0].after);
      expect((await raw.readdir("/repo")).sort()).toEqual(["plan.md"]);
    }
  );

  it("preserves comments, BOM, CRLF, body, and unrelated metadata", async () => {
    const body = "\r\n# Body\r\n\r\nKeep this exact requirement.\r\n";
    const original =
      "\uFEFF---\r\n# Keep header\r\nkind: pipeline\r\nversion: 1\r\ncustom:\r\n  note: unchanged\r\ntasks:\r\n  - id: work\r\n    title: Work\r\n    prompt: Work\r\n    status: open # task progress\r\n---" +
      body;
    const raw = createFsFromVolume(Volume.fromJSON({ [planPath]: original })).promises;
    await writeTaskStatus({
      fs: raw as unknown as PipelineFileSystem,
      planPath,
      taskId: "work",
      status: "done",
      finalization: "pending"
    });
    const updated = String(await raw.readFile(planPath, "utf8"));
    expect(updated.startsWith("\uFEFF---\r\n")).toBe(true);
    expect(updated.endsWith(body)).toBe(true);
    expect(updated).toContain("# Keep header");
    expect(updated).toContain("# task progress");
    const normalized = updated.slice(1).replaceAll("\r\n", "\n");
    const data = parse(normalized.slice(4, normalized.indexOf("\n---", 4)));
    expect(data).toMatchObject({
      custom: { note: "unchanged" },
      finalization: "pending",
      tasks: [{ status: "done" }]
    });
  });

  it("does not persist progress separately when the task commit fails", async () => {
    const original = document();
    const raw = createFsFromVolume(Volume.fromJSON({ [planPath]: original })).promises;
    const failure = new Error("Rename failed");
    const fs: PipelineFileSystem = {
      ...(raw as unknown as PipelineFileSystem),
      rename: async () => {
        throw failure;
      }
    };
    await expect(
      writeTaskStatus({ fs, planPath, taskId: "work", status: "done", finalization: "pending" })
    ).rejects.toBe(failure);
    expect(await raw.readFile(planPath, "utf8")).toBe(original);
    expect((await raw.readdir("/repo")).sort()).toEqual(["plan.md"]);
  });
});
