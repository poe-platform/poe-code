import path from "node:path";
import { describe, expect, it } from "vitest";
import { createFileAwarenessTracker, recordToolFileAwareness } from "./file-awareness.js";

describe("FileAwarenessTracker", () => {
  it("normalizes and dedupes read and modified paths", () => {
    const tracker = createFileAwarenessTracker("/workspace/project");

    tracker.recordRead("README.md");
    tracker.recordRead("./README.md");
    tracker.recordWrite("../shared/config.json");

    const snapshot = tracker.snapshot();

    expect(Array.from(snapshot.readFiles)).toEqual([path.resolve("/workspace/project/README.md")]);
    expect(Array.from(snapshot.modifiedFiles)).toEqual([
      path.resolve("/workspace/shared/config.json")
    ]);
  });

  it("records known file tools and ignores unknown tools", () => {
    const tracker = createFileAwarenessTracker("/workspace/project");

    recordToolFileAwareness({
      tracker,
      tool: "read_file",
      args: { path: "src/index.ts" }
    });
    recordToolFileAwareness({
      tracker,
      tool: "write_file",
      args: { path: "src/output.ts" }
    });
    recordToolFileAwareness({
      tracker,
      tool: "search",
      args: { path: "src/ignored.ts" }
    });

    const snapshot = tracker.snapshot();

    expect(Array.from(snapshot.readFiles)).toEqual([
      path.resolve("/workspace/project/src/index.ts")
    ]);
    expect(Array.from(snapshot.modifiedFiles)).toEqual([
      path.resolve("/workspace/project/src/output.ts")
    ]);
  });
});
