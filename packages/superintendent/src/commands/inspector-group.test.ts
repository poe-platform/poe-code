import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { runAllInspectorsMock, runInspectorMock } = vi.hoisted(() => ({
  runAllInspectorsMock: vi.fn<() => Promise<Array<{ name: string; summary: string }>>>(),
  runInspectorMock: vi.fn<() => Promise<{ name: string; summary: string }>>()
}));

vi.mock("../runtime/run-inspector.js", () => ({
  runAllInspectors: runAllInspectorsMock,
  runInspector: runInspectorMock
}));

const document = `---
kind: superintendent
version: 1
builder:
  agent: claude-code
  prompt: |
    Work on {{plan.path}}
inspectors:
  code-quality:
    agent: codex
    mode: read
    prompt: |
      Inspect {{builder.summary}}
  manual-qa:
    agent: claude-code
    prompt: |
      Validate {{builder.log}}
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

- [ ] Ship the inspector run command
`;

describe("superintendent inspector commands", () => {
  beforeEach(() => {
    runAllInspectorsMock.mockReset();
    runInspectorMock.mockReset();
  });

  it("lists configured inspectors from the document", async () => {
    const { inspectorListCommand } = await import("./inspector-group.js");
    const targetPath = "docs/plans/feature.md";

    const result = await inspectorListCommand.handler({
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

    expect(result).toEqual([
      { name: "code-quality", agent: "codex", mode: "read" },
      { name: "manual-qa", agent: "claude-code", mode: undefined }
    ]);
  });

  it("runs all inspectors when no inspector name is provided", async () => {
    runAllInspectorsMock.mockResolvedValue([
      { name: "code-quality", summary: "quality-ok" },
      { name: "manual-qa", summary: "qa-ok" }
    ]);

    const { inspectorRunCommand } = await import("./inspector-group.js");
    const targetPath = "docs/plans/feature.md";

    const result = await inspectorRunCommand.handler({
      params: { path: targetPath, name: undefined },
      secrets: {},
      fetch: globalThis.fetch,
      fs: {
        readFile: vi.fn(async () => document),
        writeFile: vi.fn(async () => undefined),
        exists: vi.fn(async () => true)
      },
      env: {
        get: vi.fn(() => undefined)
      },
      progress: vi.fn()
    });

    expect(runAllInspectorsMock).toHaveBeenCalledWith(
      expect.objectContaining({ filePath: path.resolve(targetPath) }),
      {},
      expect.objectContaining({
        defaultCwd: process.cwd(),
        agentSession: expect.any(Object)
      })
    );
    expect(result).toEqual([
      { name: "code-quality", summary: "quality-ok" },
      { name: "manual-qa", summary: "qa-ok" }
    ]);
  });

  it("runs a single named inspector", async () => {
    runInspectorMock.mockResolvedValue({
      name: "manual-qa",
      summary: "qa-ok"
    });

    const { inspectorRunCommand } = await import("./inspector-group.js");
    const targetPath = "docs/plans/feature.md";

    const result = await inspectorRunCommand.handler({
      params: { path: targetPath, name: "manual-qa" },
      secrets: {},
      fetch: globalThis.fetch,
      fs: {
        readFile: vi.fn(async () => document),
        writeFile: vi.fn(async () => undefined),
        exists: vi.fn(async () => true)
      },
      env: {
        get: vi.fn(() => undefined)
      },
      progress: vi.fn()
    });

    expect(runInspectorMock).toHaveBeenCalledWith(
      "manual-qa",
      expect.objectContaining({
        agent: "claude-code",
        prompt: "Validate {{builder.log}}\n"
      }),
      expect.objectContaining({ filePath: path.resolve(targetPath) }),
      {},
      expect.objectContaining({
        defaultCwd: process.cwd(),
        agentSession: expect.any(Object)
      })
    );
    expect(result).toEqual([{ name: "manual-qa", summary: "qa-ok" }]);
  });

  it("throws a user-facing error when the named inspector does not exist", async () => {
    const { inspectorRunCommand } = await import("./inspector-group.js");

    await expect(
      inspectorRunCommand.handler({
        params: { path: "docs/plans/feature.md", name: "missing" },
        secrets: {},
        fetch: globalThis.fetch,
        fs: {
          readFile: vi.fn(async () => document),
          writeFile: vi.fn(async () => undefined),
          exists: vi.fn(async () => true)
        },
        env: {
          get: vi.fn(() => undefined)
        },
        progress: vi.fn()
      })
    ).rejects.toThrow("Inspector not found: missing");
  });

  it("renders a friendly rich empty state when listing no inspectors", async () => {
    const { inspectorListCommand } = await import("./inspector-group.js");
    const logger = {
      message: vi.fn(),
      success: vi.fn(),
      error: vi.fn(),
      warn: vi.fn()
    };

    inspectorListCommand.render.rich?.([], {
      logger,
      renderTable: vi.fn(() => "table"),
      getTheme: vi.fn(() => ({}) as never)
    });

    expect(logger.message).toHaveBeenCalledWith("No inspectors configured.");
  });

  it("renders a friendly rich empty state when running with no inspectors", async () => {
    const { inspectorRunCommand } = await import("./inspector-group.js");
    const logger = {
      message: vi.fn(),
      success: vi.fn(),
      error: vi.fn(),
      warn: vi.fn()
    };

    inspectorRunCommand.render.rich?.([], {
      logger
    });

    expect(logger.success).not.toHaveBeenCalled();
    expect(logger.message).toHaveBeenCalledWith("No inspectors configured.");
  });
});
