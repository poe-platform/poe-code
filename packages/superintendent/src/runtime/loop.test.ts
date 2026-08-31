import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Volume, createFsFromVolume } from "memfs";
import { parseSuperintendentDoc } from "../document/parse.js";
import type { LoopState } from "../state/machine.js";
import { runLoop, type LoopRunners, type SuperintendentFileSystem } from "./loop.js";
import type { runBuilder } from "./run-builder.js";
import type { runInspector } from "./run-inspector.js";
import type { runSuperintendent } from "./run-superintendent.js";
import type { runOwnerReview } from "./run-owner-review.js";

const runBuilderMock = vi.fn();
const runInspectorMock = vi.fn();
const runSuperintendentMock = vi.fn();
const runOwnerReviewMock = vi.fn();

const runners: LoopRunners = {
  builder: runBuilderMock as unknown as typeof runBuilder,
  inspector: runInspectorMock as unknown as typeof runInspector,
  superintendent: runSuperintendentMock as unknown as typeof runSuperintendent,
  ownerReview: runOwnerReviewMock as unknown as typeof runOwnerReview
};

async function withObjectPrototypeCode<T>(code: string, callback: () => Promise<T>): Promise<T> {
  const descriptor = Object.getOwnPropertyDescriptor(Object.prototype, "code");
  Object.defineProperty(Object.prototype, "code", {
    configurable: true,
    value: code,
    writable: true
  });

  try {
    return await callback();
  } finally {
    if (descriptor) {
      Object.defineProperty(Object.prototype, "code", descriptor);
    } else {
      delete (Object.prototype as { code?: unknown }).code;
    }
  }
}

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
      writeFile: async (
        filePath: string,
        content: string,
        options?: { encoding?: BufferEncoding; flag?: string }
      ) => {
        await rawFs.mkdir(path.dirname(filePath), { recursive: true });
        await rawFs.writeFile(filePath, content, { encoding: "utf8", ...options });
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
      lstat: async (filePath: string) => {
        const stat = await rawFs.lstat(filePath);
        return { isSymbolicLink: () => stat.isSymbolicLink() };
      },
      rmdir: async (filePath: string) => {
        await rawFs.rmdir(filePath);
      },
      rename: async (oldPath: string, newPath: string) => {
        await rawFs.mkdir(path.dirname(newPath), { recursive: true });
        await rawFs.rename(oldPath, newPath);
      },
      unlink: async (filePath: string) => {
        await rawFs.unlink(filePath);
      }
    } as SuperintendentFileSystem
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
      : (options.inspectors ?? [
          { name: "code-quality", prompt: "Inspect {{builder.summary}}" },
          { name: "manual-qa", prompt: "Validate {{inspectors.code-quality}}" }
        ]);

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
  });

  it("passes logPath through the autonomous runner into AgentRunInput", async () => {
    const docPath = "/repo/docs/plans/feature.md";
    const { fs } = createFs({ [docPath]: createDocument({ withInspectors: false }) });
    const runAgent = vi.fn(async () => ({
      stdout: "Builder completed",
      stderr: "",
      exitCode: 0
    }));

    runBuilderMock.mockImplementation(async () => {
      const { runAutonomousAgent } = await import("./agent-runner.js");

      await runAutonomousAgent({
        agent: "claude-code",
        prompt: "Build",
        cwd: "/repo",
        logPath: "/logs/builder.jsonl"
      });

      return {
        summary: "Builder completed",
        log: "Builder completed"
      };
    });
    runSuperintendentMock.mockResolvedValue({
      summary: "Ready",
      transition: {
        action: "request_review",
        summary: "Ready"
      }
    });
    runOwnerReviewMock.mockResolvedValue({
      transition: {
        action: "approve_completion"
      }
    });

    await expect(
      runLoop({
        docPath,
        cwd: "/repo",
        homeDir: "/home/test",
        fs,
        logDir: "/tmp/superintendent-logs",
        runAgent,
        runners
      })
    ).resolves.toMatchObject({
      state: "completed",
      stopReason: "completed"
    });

    expect(runAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        agent: "claude-code",
        prompt: "Build",
        cwd: "/repo",
        logPath: "/logs/builder.jsonl"
      })
    );
  });

  it("uses an injected builder agent override without changing other roles", async () => {
    const docPath = "/repo/docs/plans/feature.md";
    const { fs } = createFs({ [docPath]: createDocument({ withInspectors: false }) });

    runBuilderMock.mockImplementation(async (doc) => {
      expect(doc.frontmatter.builder.agent).toBe("codex");
      return { summary: "Built", log: "Built", log_path: "" };
    });
    runSuperintendentMock.mockImplementation(async (doc) => {
      expect(doc.frontmatter.superintendent.agent).toBe("claude-code");
      return { summary: "Ready", transition: { action: "request_review", summary: "Ready" } };
    });
    runOwnerReviewMock.mockResolvedValue({ transition: { action: "approve_completion" } });

    await expect(
      runLoop({ docPath, cwd: "/repo", homeDir: "/home/test", fs, builderAgent: "codex", runners })
    ).resolves.toMatchObject({ state: "completed", stopReason: "completed" });
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

    const result = await runLoop({
      docPath,
      cwd: "/repo",
      homeDir: "/home/test",
      fs,
      runners,
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
  }, 15_000);

  it("does not follow a document symlink inserted before status publish", async () => {
    const docPath = "/repo/docs/plans/feature.md";
    const outsidePath = "/outside/feature.md";
    const { fs, rawFs } = createFs({
      [docPath]: createDocument({ withInspectors: false }),
      [outsidePath]: "outside-state\n"
    });
    const realWriteFile = fs.writeFile.bind(fs);
    let plantedSymlink = false;
    vi.spyOn(fs, "writeFile").mockImplementation(async (filePath, content, options) => {
      await realWriteFile(filePath, content, options);
      if (
        !plantedSymlink &&
        filePath.startsWith(`/repo/docs/plans/.feature.md.${process.pid}.`) &&
        filePath.endsWith(".tmp")
      ) {
        plantedSymlink = true;
        await rawFs.unlink(docPath);
        await rawFs.symlink(outsidePath, docPath);
      }
    });

    runBuilderMock.mockResolvedValue({
      summary: "Built",
      log: "Built"
    });
    runSuperintendentMock.mockResolvedValue({
      summary: "Ready",
      transition: {
        action: "request_review",
        summary: "Ready"
      }
    });
    runOwnerReviewMock.mockResolvedValue({
      transition: {
        action: "approve_completion"
      }
    });

    const result = await runLoop({
      docPath,
      cwd: "/repo",
      homeDir: "/home/test",
      fs,
      runners
    });

    expect(result.stopReason).toBe("completed");
    expect(plantedSymlink).toBe(true);
    expect((await rawFs.lstat(docPath)).isSymbolicLink()).toBe(false);
    expect((await rawFs.readFile(outsidePath, "utf8")).toString()).toBe("outside-state\n");
  });

  it("removes a partial temporary document when status publish fails", async () => {
    const docPath = "/repo/docs/plans/feature.md";
    const original = createDocument({ withInspectors: false });
    const { fs, rawFs } = createFs({ [docPath]: original });
    const realWriteFile = fs.writeFile.bind(fs);
    let partialTempPath: string | undefined;

    vi.spyOn(fs, "writeFile").mockImplementation(async (filePath, content, options) => {
      if (
        !partialTempPath &&
        filePath.startsWith(`/repo/docs/plans/.feature.md.${process.pid}.`) &&
        filePath.endsWith(".tmp")
      ) {
        partialTempPath = filePath;
        await rawFs.writeFile(filePath, "partial\n", { encoding: "utf8", ...options });
        throw new Error("status write failed");
      }
      await realWriteFile(filePath, content, options);
    });

    runBuilderMock.mockResolvedValue({
      summary: "Built",
      log: "Built"
    });

    await withObjectPrototypeCode("EEXIST", async () => {
      await expect(
        runLoop({
          docPath,
          cwd: "/repo",
          homeDir: "/home/test",
          fs,
          runners
        })
      ).rejects.toThrow("status write failed");
    });

    expect(runBuilderMock).not.toHaveBeenCalled();
    expect(partialTempPath).toBeDefined();
    await expect(rawFs.readFile(partialTempPath ?? "", "utf8")).rejects.toHaveProperty(
      "code",
      "ENOENT"
    );
    expect((await rawFs.readFile(docPath, "utf8")).toString()).toBe(original);
  });

  it("wraps each role execution through callbacks", async () => {
    const docPath = "/repo/docs/plans/plan.md";
    const { fs } = createFs({
      [docPath]: createDocument({ withInspectors: true })
    });
    const roles: string[] = [];
    runBuilderMock.mockResolvedValue({ output: "built" });
    runInspectorMock.mockImplementation(async (name) => ({ name, summary: "ok" }));
    runSuperintendentMock.mockResolvedValue({
      summary: "ready",
      transition: { action: "request_review" }
    });
    runOwnerReviewMock.mockResolvedValue({ transition: { action: "approve_completion" } });

    await runLoop({
      docPath,
      cwd: "/repo",
      homeDir: "/home/test",
      fs,
      runners,
      callbacks: {
        runRole: async (role, name, run) => {
          roles.push(name === undefined ? role : `${role}:${name}`);
          return run();
        }
      }
    });

    expect(roles).toEqual([
      "builder",
      "inspector:code-quality",
      "inspector:manual-qa",
      "superintendent",
      "owner"
    ]);
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

    const result = await runLoop({
      docPath,
      cwd: "/repo",
      homeDir: "/home/test",
      fs,
      runners
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

  it("fires the builder failure callback, saves the last valid document, and halts the round", async () => {
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

    await expect(
      runLoop({
        docPath,
        cwd: "/repo",
        homeDir: "/home/test",
        fs,
        runners,
        callbacks: {
          onBuilderFailed
        }
      })
    ).rejects.toThrow("builder failed");

    expect(onBuilderFailed).toHaveBeenCalledWith(expect.any(Error));
    expect(runInspectorMock).not.toHaveBeenCalled();
    expect(runSuperintendentMock).not.toHaveBeenCalled();
    expect(runOwnerReviewMock).not.toHaveBeenCalled();
    expect((await rawFs.readFile(docPath, "utf8")).toString()).toContain("- [x] Task 1");
    const backups = (await rawFs.readdir(path.dirname(docPath))).filter((name) =>
      String(name).endsWith(".bak")
    );
    expect(backups).toHaveLength(1);
    expect(
      (
        await rawFs.readFile(path.join(path.dirname(docPath), String(backups[0])), "utf8")
      ).toString()
    ).toBe(original);
  });

  it("fires the inspector failure callback and saves builder changes without overwriting the live document", async () => {
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

    await expect(
      runLoop({
        docPath,
        cwd: "/repo",
        homeDir: "/home/test",
        fs,
        runners,
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
    expect(finalDoc.body).toContain("- [x] Task 2");
    const backups = (await rawFs.readdir(path.dirname(docPath))).filter((name) =>
      String(name).endsWith(".bak")
    );
    expect(backups).toHaveLength(1);
    const snapshot = (
      await rawFs.readFile(path.join(path.dirname(docPath), String(backups[0])), "utf8")
    ).toString();
    expect(snapshot).toContain("- [x] Task 1");
    expect(snapshot).toContain("- [ ] Task 2");
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

    const result = await runLoop({
      docPath,
      cwd: "/repo",
      homeDir: "/home/test",
      fs,
      runners,
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

    const result = await runLoop({
      docPath,
      cwd: "/repo",
      homeDir: "/home/test",
      fs,
      runners,
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

    const result = await runLoop({
      docPath,
      cwd: "/repo",
      homeDir: "/home/test",
      fs,
      runners,
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

    await runLoop({ docPath, cwd: "/repo", homeDir: "/home/test", fs, runners });

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

    await runLoop({ docPath, cwd: "/repo", homeDir: "/home/test", fs, runners });

    expect(runInspectorMock).toHaveBeenCalledTimes(2);
    expect(runInspectorMock.mock.calls.map((call) => call[0])).toEqual([
      "code-quality",
      "manual-qa"
    ]);
  });

  it("threads log_path from each role into the downstream template context", async () => {
    const docPath = "/repo/docs/plans/feature.md";
    const { fs } = createFs({
      [docPath]: createDocument({
        inspectors: [
          { name: "code-quality", prompt: "Check {{builder.log_path}}" },
          { name: "manual-qa", prompt: "Replay {{inspector_logs.code-quality}}" }
        ],
        superintendentPrompt:
          "Review {{inspectors.code-quality}} {{inspectors.manual-qa}} {{inspector_logs.manual-qa}}"
      })
    });

    runBuilderMock.mockResolvedValue({
      summary: "Builder finished",
      log: "log",
      log_path: "/tmp/spawn-logs/builder.jsonl"
    });

    runInspectorMock
      .mockImplementationOnce(async (_name, _config, _doc, context) => {
        expect(context.inspector_logs).toEqual({});
        return {
          name: "code-quality",
          summary: "quality ok",
          log_path: "/tmp/spawn-logs/inspector-code-quality.jsonl"
        };
      })
      .mockImplementationOnce(async (_name, _config, _doc, context) => {
        expect(context.inspector_logs).toEqual({
          "code-quality": "/tmp/spawn-logs/inspector-code-quality.jsonl"
        });
        return {
          name: "manual-qa",
          summary: "qa ok",
          log_path: "/tmp/spawn-logs/inspector-manual-qa.jsonl"
        };
      });

    runSuperintendentMock.mockImplementation(async (_doc, context) => {
      expect(context.inspector_logs).toEqual({
        "code-quality": "/tmp/spawn-logs/inspector-code-quality.jsonl",
        "manual-qa": "/tmp/spawn-logs/inspector-manual-qa.jsonl"
      });
      return {
        summary: "ready",
        transition: { action: "request_review", summary: "ready" },
        log_path: "/tmp/spawn-logs/superintendent.jsonl"
      };
    });

    runOwnerReviewMock.mockImplementation(async (_doc, context) => {
      expect(context.superintendent).toEqual({
        summary: "ready",
        log_path: "/tmp/spawn-logs/superintendent.jsonl"
      });
      return {
        transition: { action: "approve_completion" },
        log_path: "/tmp/spawn-logs/owner.jsonl"
      };
    });

    await runLoop({ docPath, cwd: "/repo", homeDir: "/home/test", fs, runners });

    expect(runInspectorMock).toHaveBeenCalledTimes(2);
    expect(runSuperintendentMock).toHaveBeenCalledTimes(1);
    expect(runOwnerReviewMock).toHaveBeenCalledTimes(1);
  });

  it("skips every inspector when the superintendent prompt references none", async () => {
    const docPath = "/repo/docs/plans/feature.md";
    const { fs } = createFs({
      [docPath]: createDocument({
        inspectors: [{ name: "code-quality", prompt: "Check {{builder.summary}}" }],
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

    await runLoop({ docPath, cwd: "/repo", homeDir: "/home/test", fs, runners });

    expect(runInspectorMock).not.toHaveBeenCalled();
  });

  it("reports abort instead of completion when approval aborts in flight", async () => {
    const docPath = "/repo/docs/plans/feature.md";
    const { fs, rawFs } = createFs({ [docPath]: createDocument({ withInspectors: false }) });
    const controller = new AbortController();

    runBuilderMock.mockResolvedValue({ summary: "Done", log: "log" });
    runSuperintendentMock.mockResolvedValue({
      summary: "Done",
      transition: { action: "request_review", summary: "Done" }
    });
    runOwnerReviewMock.mockImplementation(async () => {
      controller.abort();
      return { transition: { action: "approve_completion" } };
    });

    const result = await runLoop({
      docPath,
      cwd: "/repo",
      homeDir: "/home/test",
      fs,
      runners,
      signal: controller.signal
    });

    expect(result).toMatchObject({ state: "review", stopReason: "aborted" });
    const finalDoc = await readDoc(rawFs, docPath);
    expect(finalDoc.frontmatter.status.state).toBe("review");
  });
});
