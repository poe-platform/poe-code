import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Volume, createFsFromVolume } from "memfs";
import { parseSuperintendentDoc } from "../document/parse.js";
import type { LoopState } from "../state/machine.js";
import type { SuperintendentFileSystem } from "./loop.js";

const {
  runBuilderMock,
  runInspectorMock,
  runSuperintendentMock,
  runOwnerReviewMock
} = vi.hoisted(() => ({
  runBuilderMock: vi.fn<() => Promise<{ summary: string; log: string }>>(),
  runInspectorMock: vi.fn<() => Promise<{ name: string; summary: string }>>(),
  runSuperintendentMock: vi.fn<() => Promise<{ summary: string; transition?: unknown }>>(),
  runOwnerReviewMock: vi.fn<() => Promise<{ transition: unknown }>>()
}));

vi.mock("./run-builder.js", () => ({
  runBuilder: runBuilderMock
}));

vi.mock("./run-inspector.js", () => ({
  runInspector: runInspectorMock
}));

vi.mock("./run-superintendent.js", () => ({
  runSuperintendent: runSuperintendentMock
}));

vi.mock("./run-owner-review.js", () => ({
  runOwnerReview: runOwnerReviewMock
}));

type TestFs = {
  rawFs: ReturnType<typeof createFsFromVolume>["promises"];
  fs: SuperintendentFileSystem;
};

function createFs(files: Record<string, string>): TestFs {
  const volume = Volume.fromJSON(files, "/");
  const rawFs = createFsFromVolume(volume).promises;

  return {
    rawFs,
    fs: {
      readFile: (filePath: string, encoding: BufferEncoding) =>
        rawFs.readFile(filePath, encoding) as Promise<string>,
      writeFile: async (filePath: string, content: string) => {
        await rawFs.mkdir(path.dirname(filePath), { recursive: true });
        await rawFs.writeFile(filePath, content, { encoding: "utf8" });
      },
      readdir: (filePath: string) => rawFs.readdir(filePath) as Promise<string[]>,
      stat: async (filePath: string) => {
        const stat = await rawFs.stat(filePath);
        return {
          isFile: () => stat.isFile(),
          isDirectory: () => stat.isDirectory(),
          mtimeMs: Number(stat.mtimeMs)
        };
      },
      mkdir: async (filePath: string, options?: { recursive?: boolean }) => {
        await rawFs.mkdir(filePath, options);
      },
      rmdir: async (filePath: string) => {
        await rawFs.rmdir(filePath);
      },
      rename: async (oldPath: string, newPath: string) => {
        await rawFs.mkdir(path.dirname(newPath), { recursive: true });
        await rawFs.rename(oldPath, newPath);
      }
    }
  };
}

type InspectorSpec = {
  name: string;
  prompt: string;
};

function createDocument(
  options: {
    maxRounds?: number;
    withInspectors?: boolean;
    inspectors?: InspectorSpec[];
    superintendentPrompt?: string;
  } = {}
): string {
  const inspectorSpecs: InspectorSpec[] | undefined =
    options.withInspectors === false
      ? undefined
      : options.inspectors ?? [
          { name: "code-quality", prompt: "Inspect {{builder.summary}}" },
          { name: "manual-qa", prompt: "Validate {{inspectors.code-quality}}" }
        ];

  const inspectors = inspectorSpecs
    ? [
        "inspectors:",
        ...inspectorSpecs.flatMap((spec) => [
          `  ${spec.name}:`,
          "    agent: claude-code",
          "    prompt: |",
          `      ${spec.prompt}`
        ])
      ].join("\n")
    : "";

  const superintendentPrompt =
    options.superintendentPrompt ??
    (inspectorSpecs
      ? `Review {{builder.summary}} ${inspectorSpecs
          .map((spec) => `{{inspectors.${spec.name}}}`)
          .join(" ")}`
      : "Review {{builder.summary}}");

  return [
    "---",
    "kind: superintendent",
    "version: 1",
    "builder:",
    "  agent: claude-code",
    "  prompt: |",
    "    Work on {{plan.path}}",
    ...(inspectors ? [inspectors] : []),
    "superintendent:",
    "  agent: claude-code",
    "  prompt: |",
    `    ${superintendentPrompt}`,
    "owner:",
    "  agent: claude-code",
    "  prompt: |",
    "    Review {{superintendent.summary}}",
    `max_rounds: ${options.maxRounds ?? 10}`,
    "status:",
    "  state: in_progress",
    "  round: 0",
    "  review_turn: 0",
    "---",
    "# Plan",
    "",
    "## Task Board",
    "",
    "- [ ] Task 1",
    "- [ ] Task 2",
    ""
  ].join("\n");
}

async function readDoc(fs: TestFs["rawFs"], docPath: string) {
  return parseSuperintendentDoc(docPath, (await fs.readFile(docPath, "utf8")) as string);
}

describe("runLoop", () => {
  beforeEach(() => {
    runBuilderMock.mockReset();
    runInspectorMock.mockReset();
    runSuperintendentMock.mockReset();
    runOwnerReviewMock.mockReset();
    vi.resetModules();
  });

  it("runs the full lifecycle, writes status updates, and preserves agent body edits", async () => {
    const docPath = "/repo/docs/plans/feature.md";
    const { fs, rawFs } = createFs({ [docPath]: createDocument() });
    const events: string[] = [];
    const stateChanges: Array<Pick<LoopState, "state" | "round" | "reviewTurn">> = [];

    runBuilderMock.mockImplementation(async (doc) => {
      expect(doc.frontmatter.status).toEqual({
        state: "in_progress",
        round: 1,
        review_turn: 0
      });
      const updated = (await rawFs.readFile(docPath, "utf8"))
        .toString()
        .replace("- [ ] Task 1", "- [x] Task 1");
      await rawFs.writeFile(docPath, updated, { encoding: "utf8" });
      events.push("builder");
      return {
        summary: "Builder finished round 1",
        log: "Marked Task 1 done"
      };
    });

    runInspectorMock
      .mockImplementationOnce(async (name, _config, doc, context) => {
        expect(name).toBe("code-quality");
        expect(doc.frontmatter.status.round).toBe(1);
        expect(context.builder).toEqual({
          summary: "Builder finished round 1",
          log: "Marked Task 1 done"
        });
        expect(context.inspectors).toEqual({});
        events.push("inspector:code-quality");
        return {
          name,
          summary: "Looks good"
        };
      })
      .mockImplementationOnce(async (name, _config, _doc, context) => {
        expect(name).toBe("manual-qa");
        expect(context.inspectors).toEqual({
          "code-quality": "Looks good"
        });
        events.push("inspector:manual-qa");
        return {
          name,
          summary: "QA passed"
        };
      });

    runSuperintendentMock.mockImplementation(async (doc, context) => {
      expect(doc.frontmatter.status).toEqual({
        state: "in_progress",
        round: 1,
        review_turn: 0
      });
      expect(context.builder).toEqual({
        summary: "Builder finished round 1",
        log: "Marked Task 1 done"
      });
      expect(context.inspectors).toEqual({
        "code-quality": "Looks good",
        "manual-qa": "QA passed"
      });
      events.push("superintendent");
      return {
        summary: "Ready for owner review",
        transition: {
          action: "request_review",
          summary: "Ready for owner review"
        }
      };
    });

    runOwnerReviewMock.mockImplementation(async (doc, context) => {
      expect(doc.frontmatter.status).toEqual({
        state: "review",
        round: 1,
        review_turn: 0
      });
      expect(context.superintendent).toEqual({
        summary: "Ready for owner review"
      });
      events.push("owner");
      return {
        transition: {
          action: "approve_completion"
        }
      };
    });

    const { runLoop } = await import("./loop.js");
    const result = await runLoop({
      docPath,
      cwd: "/repo",
      homeDir: "/home/test",
      fs,
      callbacks: {
        onBuilderStart: () => events.push("builder:start"),
        onBuilderComplete: () => events.push("builder:complete"),
        onInspectorStart: (name) => events.push(`inspector:start:${name}`),
        onInspectorComplete: (result) => events.push(`inspector:complete:${result.name}`),
        onSuperintendentStart: () => events.push("superintendent:start"),
        onSuperintendentComplete: () => events.push("superintendent:complete"),
        onOwnerStart: () => events.push("owner:start"),
        onOwnerComplete: () => events.push("owner:complete"),
        onRoundComplete: (round) => events.push(`round:${round}`),
        onLoopComplete: () => events.push("loop:complete"),
        onStateChange: (state) => {
          stateChanges.push({
            state: state.state,
            round: state.round,
            reviewTurn: state.reviewTurn
          });
        }
      }
    });

    expect(result).toEqual({
      state: "completed",
      round: 1,
      reviewTurn: 0,
      maxRounds: 10,
      maxReviewTurns: 5,
      stopReason: "completed"
    });
    expect(events).toEqual([
      "builder:start",
      "builder",
      "builder:complete",
      "inspector:start:code-quality",
      "inspector:code-quality",
      "inspector:complete:code-quality",
      "inspector:start:manual-qa",
      "inspector:manual-qa",
      "inspector:complete:manual-qa",
      "superintendent:start",
      "superintendent",
      "superintendent:complete",
      "owner:start",
      "owner",
      "owner:complete",
      "round:1",
      "loop:complete"
    ]);
    expect(stateChanges).toEqual([
      { state: "in_progress", round: 1, reviewTurn: 0 },
      { state: "review", round: 1, reviewTurn: 0 },
      { state: "completed", round: 1, reviewTurn: 0 }
    ]);

    const finalDoc = await readDoc(rawFs, docPath);
    expect(finalDoc.body).toContain("- [x] Task 1");
    expect(finalDoc.frontmatter.status).toEqual({
      state: "completed",
      round: 1,
      review_turn: 0
    });
  });

  it("stores owner feedback and passes it to the next builder round", async () => {
    const docPath = "/repo/docs/plans/feature.md";
    const { fs, rawFs } = createFs({ [docPath]: createDocument({ withInspectors: false }) });

    runBuilderMock
      .mockResolvedValueOnce({
        summary: "Builder round 1",
        log: "Did initial implementation"
      })
      .mockImplementationOnce(async (_doc, context) => {
        expect(context.owner).toEqual({
          feedback: "Task 2 is not done"
        });
        const updated = (await rawFs.readFile(docPath, "utf8"))
          .toString()
          .replace("- [ ] Task 2", "- [x] Task 2");
        await rawFs.writeFile(docPath, updated, { encoding: "utf8" });
        return {
          summary: "Builder round 2",
          log: "Finished Task 2"
        };
      });

    runSuperintendentMock
      .mockResolvedValueOnce({
        summary: "Maybe done",
        transition: {
          action: "request_review",
          summary: "Maybe done"
        }
      })
      .mockResolvedValueOnce({
        summary: "Definitely done",
        transition: {
          action: "request_review",
          summary: "Definitely done"
        }
      });

    runOwnerReviewMock
      .mockResolvedValueOnce({
        transition: {
          action: "request_changes",
          feedback: "Task 2 is not done"
        }
      })
      .mockResolvedValueOnce({
        transition: {
          action: "approve_completion"
        }
      });

    const { runLoop } = await import("./loop.js");
    const result = await runLoop({
      docPath,
      cwd: "/repo",
      homeDir: "/home/test",
      fs
    });

    expect(result).toEqual({
      state: "completed",
      round: 2,
      reviewTurn: 0,
      maxRounds: 10,
      maxReviewTurns: 5,
      stopReason: "completed"
    });
    expect(runBuilderMock).toHaveBeenCalledTimes(2);
    expect(runOwnerReviewMock).toHaveBeenCalledTimes(2);

    const finalDoc = await readDoc(rawFs, docPath);
    expect(finalDoc.body).toContain("- [x] Task 2");
    expect(finalDoc.frontmatter.status).toEqual({
      state: "completed",
      round: 2,
      review_turn: 0
    });
  });

  it("fires the builder failure callback, restores the last valid document, and halts the round", async () => {
    const docPath = "/repo/docs/plans/feature.md";
    const original = createDocument({ withInspectors: false });
    const { fs, rawFs } = createFs({ [docPath]: original });
    const onBuilderFailed = vi.fn();

    runBuilderMock.mockImplementation(async () => {
      const updated = (await rawFs.readFile(docPath, "utf8"))
        .toString()
        .replace("- [ ] Task 1", "- [x] Task 1");
      await rawFs.writeFile(docPath, updated, { encoding: "utf8" });
      throw new Error("builder failed");
    });

    const { runLoop } = await import("./loop.js");

    await expect(
      runLoop({
        docPath,
        cwd: "/repo",
        homeDir: "/home/test",
        fs,
        callbacks: {
          onBuilderFailed
        }
      })
    ).rejects.toThrow("builder failed");

    expect(onBuilderFailed).toHaveBeenCalledWith(expect.any(Error));
    expect(runInspectorMock).not.toHaveBeenCalled();
    expect(runSuperintendentMock).not.toHaveBeenCalled();
    expect(runOwnerReviewMock).not.toHaveBeenCalled();
    expect((await rawFs.readFile(docPath, "utf8")).toString()).toBe(original);
  });

  it("fires the inspector failure callback, restores the last valid document, and keeps builder changes", async () => {
    const docPath = "/repo/docs/plans/feature.md";
    const { fs, rawFs } = createFs({ [docPath]: createDocument() });
    const onInspectorFailed = vi.fn();

    runBuilderMock.mockImplementation(async () => {
      const updated = (await rawFs.readFile(docPath, "utf8"))
        .toString()
        .replace("- [ ] Task 1", "- [x] Task 1");
      await rawFs.writeFile(docPath, updated, { encoding: "utf8" });

      return {
        summary: "Builder finished round 1",
        log: "Marked Task 1 done"
      };
    });

    runInspectorMock.mockImplementationOnce(async (name) => {
      const updated = (await rawFs.readFile(docPath, "utf8"))
        .toString()
        .replace("- [ ] Task 2", "- [x] Task 2");
      await rawFs.writeFile(docPath, updated, { encoding: "utf8" });
      throw new Error(`inspector failed: ${name}`);
    });

    const { runLoop } = await import("./loop.js");

    await expect(
      runLoop({
        docPath,
        cwd: "/repo",
        homeDir: "/home/test",
        fs,
        callbacks: {
          onInspectorFailed
        }
      })
    ).rejects.toThrow("inspector failed: code-quality");

    expect(onInspectorFailed).toHaveBeenCalledWith("code-quality", expect.any(Error));
    expect(runSuperintendentMock).not.toHaveBeenCalled();
    expect(runOwnerReviewMock).not.toHaveBeenCalled();

    const finalDoc = await readDoc(rawFs, docPath);
    expect(finalDoc.body).toContain("- [x] Task 1");
    expect(finalDoc.body).toContain("- [ ] Task 2");
    expect(finalDoc.frontmatter.status).toEqual({
      state: "in_progress",
      round: 1,
      review_turn: 0
    });
  });

  it("stops after max_rounds without entering review when the superintendent keeps planning", async () => {
    const docPath = "/repo/docs/plans/feature.md";
    const { fs, rawFs } = createFs({
      [docPath]: createDocument({ maxRounds: 2, withInspectors: false })
    });
    const rounds: number[] = [];

    runBuilderMock
      .mockResolvedValueOnce({ summary: "Builder round 1", log: "log 1" })
      .mockResolvedValueOnce({ summary: "Builder round 2", log: "log 2" });
    runSuperintendentMock
      .mockResolvedValueOnce({ summary: "Need more work" })
      .mockResolvedValueOnce({ summary: "Still not done" });

    const { runLoop } = await import("./loop.js");
    const result = await runLoop({
      docPath,
      cwd: "/repo",
      homeDir: "/home/test",
      fs,
      callbacks: {
        onRoundComplete: (round) => rounds.push(round)
      }
    });

    expect(result).toEqual({
      state: "in_progress",
      round: 2,
      reviewTurn: 0,
      maxRounds: 2,
      maxReviewTurns: 5,
      stopReason: "max_rounds"
    });
    expect(runBuilderMock).toHaveBeenCalledTimes(2);
    expect(runOwnerReviewMock).not.toHaveBeenCalled();
    expect(rounds).toEqual([1, 2]);

    const finalDoc = await readDoc(rawFs, docPath);
    expect(finalDoc.frontmatter.status).toEqual({
      state: "in_progress",
      round: 2,
      review_turn: 0
    });
  });

  it("returns the current state without starting work when paused", async () => {
    const docPath = "/repo/docs/plans/feature.md";
    const { fs } = createFs({ [docPath]: createDocument({ withInspectors: false }) });

    const { runLoop } = await import("./loop.js");
    const result = await runLoop({
      docPath,
      cwd: "/repo",
      homeDir: "/home/test",
      fs,
      callbacks: {
        shouldPause: () => true
      }
    });

    expect(result).toEqual({
      state: "in_progress",
      round: 0,
      reviewTurn: 0,
      maxRounds: 10,
      maxReviewTurns: 5,
      stopReason: "paused"
    });
    expect(runBuilderMock).not.toHaveBeenCalled();
    expect(runSuperintendentMock).not.toHaveBeenCalled();
    expect(runOwnerReviewMock).not.toHaveBeenCalled();
  });

  it("stops after the current agent run when shouldStop becomes true", async () => {
    const docPath = "/repo/docs/plans/feature.md";
    const { fs, rawFs } = createFs({ [docPath]: createDocument() });
    let shouldStop = false;

    runBuilderMock.mockImplementation(async () => {
      const updated = (await rawFs.readFile(docPath, "utf8"))
        .toString()
        .replace("- [ ] Task 1", "- [x] Task 1");
      await rawFs.writeFile(docPath, updated, { encoding: "utf8" });
      shouldStop = true;

      return {
        summary: "Builder finished round 1",
        log: "Marked Task 1 done"
      };
    });

    const { runLoop } = await import("./loop.js");
    const result = await runLoop({
      docPath,
      cwd: "/repo",
      homeDir: "/home/test",
      fs,
      callbacks: {
        shouldStop: () => shouldStop
      }
    });

    expect(result).toEqual({
      state: "in_progress",
      round: 1,
      reviewTurn: 0,
      maxRounds: 10,
      maxReviewTurns: 5,
      stopReason: "stopped"
    });
    expect(runInspectorMock).not.toHaveBeenCalled();
    expect(runSuperintendentMock).not.toHaveBeenCalled();
    expect(runOwnerReviewMock).not.toHaveBeenCalled();

    const finalDoc = await readDoc(rawFs, docPath);
    expect(finalDoc.body).toContain("- [x] Task 1");
    expect(finalDoc.frontmatter.status).toEqual({
      state: "in_progress",
      round: 1,
      review_turn: 0
    });
  });

  it("skips inspectors that are not referenced in the superintendent prompt", async () => {
    const docPath = "/repo/docs/plans/feature.md";
    const { fs } = createFs({
      [docPath]: createDocument({
        inspectors: [
          { name: "code-quality", prompt: "Check {{builder.summary}}" },
          { name: "security", prompt: "Audit {{builder.summary}}" }
        ],
        superintendentPrompt: "Review {{builder.summary}} {{inspectors.code-quality}}"
      })
    });

    runBuilderMock.mockResolvedValue({
      summary: "Builder finished round 1",
      log: "log"
    });
    runInspectorMock.mockImplementationOnce(async (name) => ({
      name,
      summary: `${name} ok`
    }));
    runSuperintendentMock.mockResolvedValue({
      summary: "Done",
      transition: { action: "request_review", summary: "Done" }
    });
    runOwnerReviewMock.mockResolvedValue({
      transition: { action: "approve_completion" }
    });

    const { runLoop } = await import("./loop.js");
    await runLoop({ docPath, cwd: "/repo", homeDir: "/home/test", fs });

    expect(runInspectorMock).toHaveBeenCalledTimes(1);
    expect(runInspectorMock.mock.calls[0]?.[0]).toBe("code-quality");
  });

  it("auto-runs inspectors transitively referenced through other inspector prompts", async () => {
    const docPath = "/repo/docs/plans/feature.md";
    const { fs } = createFs({
      [docPath]: createDocument({
        inspectors: [
          { name: "code-quality", prompt: "Check {{builder.summary}}" },
          { name: "manual-qa", prompt: "Validate {{inspectors.code-quality}}" },
          { name: "security", prompt: "Audit {{builder.summary}}" }
        ],
        superintendentPrompt: "Review {{inspectors.manual-qa}}"
      })
    });

    runBuilderMock.mockResolvedValue({
      summary: "Builder finished round 1",
      log: "log"
    });
    runInspectorMock.mockImplementation(async (name) => ({
      name,
      summary: `${name} ok`
    }));
    runSuperintendentMock.mockResolvedValue({
      summary: "Done",
      transition: { action: "request_review", summary: "Done" }
    });
    runOwnerReviewMock.mockResolvedValue({
      transition: { action: "approve_completion" }
    });

    const { runLoop } = await import("./loop.js");
    await runLoop({ docPath, cwd: "/repo", homeDir: "/home/test", fs });

    expect(runInspectorMock).toHaveBeenCalledTimes(2);
    expect(runInspectorMock.mock.calls.map((call) => call[0])).toEqual([
      "code-quality",
      "manual-qa"
    ]);
  });

  it("skips every inspector when the superintendent prompt references none", async () => {
    const docPath = "/repo/docs/plans/feature.md";
    const { fs } = createFs({
      [docPath]: createDocument({
        inspectors: [
          { name: "code-quality", prompt: "Check {{builder.summary}}" }
        ],
        superintendentPrompt: "Review {{builder.summary}}"
      })
    });

    runBuilderMock.mockResolvedValue({ summary: "Done", log: "log" });
    runSuperintendentMock.mockResolvedValue({
      summary: "Done",
      transition: { action: "request_review", summary: "Done" }
    });
    runOwnerReviewMock.mockResolvedValue({
      transition: { action: "approve_completion" }
    });

    const { runLoop } = await import("./loop.js");
    await runLoop({ docPath, cwd: "/repo", homeDir: "/home/test", fs });

    expect(runInspectorMock).not.toHaveBeenCalled();
  });
});
