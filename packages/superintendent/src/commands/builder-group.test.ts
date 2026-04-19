import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { runBuilderMock } = vi.hoisted(() => ({
  runBuilderMock: vi.fn<() => Promise<{ summary: string; log: string }>>()
}));

vi.mock("../runtime/run-builder.js", () => ({
  runBuilder: runBuilderMock
}));

const document = `---
kind: superintendent
version: 1
builder:
  agent: claude-code
  prompt: |
    Work on {{plan.path}}
superintendent:
  agent: claude-code
  prompt: |
    Review {{builder.summary}}
owner:
  agent: claude-code
  prompt: |
    Review {{superintendent.summary}}
status:
  state: in_progress
  round: 0
  review_turn: 0
---
# Plan

## Task Board

- [ ] Ship the builder run command
`;

describe("superintendent builder run", () => {
  beforeEach(() => {
    runBuilderMock.mockReset();
  });

  it("reads the superintendent doc and runs the builder", async () => {
    runBuilderMock.mockResolvedValue({
      summary: "Implemented builder run",
      log: "Implemented builder run\nUpdated tests"
    });

    const { builderRunCommand } = await import("./builder-group.js");
    const targetPath = "docs/plans/feature.md";

    const result = await builderRunCommand.handler({
      params: { path: targetPath },
      secrets: {},
      fetch: globalThis.fetch,
      fs: {
        readFile: vi.fn(async (inputPath: string) => {
          expect(inputPath).toBe(targetPath);
          return document;
        }),
        writeFile: vi.fn(async () => undefined),
        exists: vi.fn(async () => true)
      },
      env: {
        get: vi.fn(() => undefined)
      },
      progress: vi.fn()
    });

    expect(runBuilderMock).toHaveBeenCalledTimes(1);
    expect(runBuilderMock).toHaveBeenCalledWith(
      expect.objectContaining({
        filePath: path.resolve(targetPath)
      }),
      {},
      { defaultCwd: process.cwd() }
    );
    expect(result).toEqual({
      summary: "Implemented builder run",
      log: "Implemented builder run\nUpdated tests"
    });
  });

  it("surfaces a missing document as a user-facing error", async () => {
    const { builderRunCommand } = await import("./builder-group.js");

    await expect(
      builderRunCommand.handler({
        params: { path: "docs/plans/missing.md" },
        secrets: {},
        fetch: globalThis.fetch,
        fs: {
          readFile: vi.fn(async () => {
            const error = new Error("missing");
            Object.assign(error, { code: "ENOENT" });
            throw error;
          }),
          writeFile: vi.fn(async () => undefined),
          exists: vi.fn(async () => false)
        },
        env: {
          get: vi.fn(() => undefined)
        },
        progress: vi.fn()
      })
    ).rejects.toThrow("Superintendent document not found: docs/plans/missing.md");
  });

  it("renders markdown output with summary and log sections", async () => {
    const { builderRunCommand } = await import("./builder-group.js");

    expect(builderRunCommand.render.markdown?.({
      summary: "Implemented builder run",
      log: "Implemented builder run\nUpdated tests"
    })).toBe(
      [
        "## Builder result",
        "",
        "### Summary",
        "",
        "Implemented builder run",
        "",
        "### Log",
        "",
        "```text",
        "Implemented builder run\nUpdated tests",
        "```"
      ].join("\n")
    );
  });
});
