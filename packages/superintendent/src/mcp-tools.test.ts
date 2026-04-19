import { beforeEach, describe, expect, it, vi } from "vitest";
import { fs, vol } from "memfs";
import { McpClient, createSdkTestPair } from "tiny-mcp-client";

const {
  runAllInspectorsMock,
  runBuilderMock,
  runInspectorMock,
  runLoopMock
} = vi.hoisted(() => {
  return {
    runLoopMock: vi.fn(),
    runBuilderMock: vi.fn(),
    runInspectorMock: vi.fn(),
    runAllInspectorsMock: vi.fn()
  };
});

vi.mock("node:fs/promises", async () => {
  const { fs } = await import("memfs");
  const rawFs = fs.promises;

  return {
    access: rawFs.access.bind(rawFs),
    mkdir: rawFs.mkdir.bind(rawFs),
    readFile: rawFs.readFile.bind(rawFs),
    readdir: rawFs.readdir.bind(rawFs),
    rename: rawFs.rename.bind(rawFs),
    rmdir: rawFs.rmdir.bind(rawFs),
    stat: rawFs.stat.bind(rawFs),
    writeFile: rawFs.writeFile.bind(rawFs)
  };
});

vi.mock("./runtime/loop.js", () => ({
  runLoop: runLoopMock
}));

vi.mock("./runtime/run-builder.js", () => ({
  runBuilder: runBuilderMock
}));

vi.mock("./runtime/run-inspector.js", () => ({
  runAllInspectors: runAllInspectorsMock,
  runInspector: runInspectorMock
}));

const EXPECTED_TOOL_NAMES = [
  "superintendent__run",
  "superintendent__validate",
  "superintendent__complete",
  "superintendent__builder__run",
  "superintendent__inspector__run",
  "superintendent__inspector__list"
];

const documentPath = "/repo/.poe-code/superintendent/plan.md";
const document = `---
kind: superintendent
version: 1
builder:
  agent: claude-code
  prompt: |
    Build {{plan.path}}
inspectors:
  code-quality:
    agent: codex
    mode: read
    prompt: |
      Inspect {{builder.summary}}
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

- [ ] Task
`;

function readJsonToolResult(result: Awaited<ReturnType<McpClient["callTool"]>>): unknown {
  return JSON.parse(String(result.content[0]?.text ?? "null"));
}

describe("superintendent MCP tool surface", () => {
  beforeEach(() => {
    vol.reset();
    vol.fromJSON({ [documentPath]: document }, "/");
    runLoopMock.mockReset();
    runLoopMock.mockResolvedValue({
      state: "completed",
      round: 1,
      reviewTurn: 0,
      maxRounds: 100,
      maxReviewTurns: 5,
      stopReason: "completed"
    });
    runBuilderMock.mockReset();
    runBuilderMock.mockResolvedValue({
      summary: "Builder completed",
      log: "Updated files"
    });
    runInspectorMock.mockReset();
    runInspectorMock.mockResolvedValue({
      name: "code-quality",
      summary: "Inspector completed"
    });
    runAllInspectorsMock.mockReset();
    runAllInspectorsMock.mockResolvedValue([
      {
        name: "code-quality",
        summary: "Inspector completed"
      }
    ]);
    vi.resetModules();
  });

  it("starts the MCP server without errors", async () => {
    const { createMCPServer } = await import("@poe-code/cmdkit/mcp");
    const { superintendentMcpGroup } = await import("./commands/index.js");
    const server = createMCPServer([superintendentMcpGroup], {
      name: "superintendent",
      version: "0.0.1"
    });
    const { client, cleanup } = await createSdkTestPair(server, () =>
      new McpClient({
        clientInfo: {
          name: "test-client",
          version: "1.0.0"
        }
      })
    );

    try {
      expect(client.serverInfo).toEqual({
        name: "superintendent",
        version: "0.0.1"
      });
    } finally {
      await cleanup();
    }
  }, 15_000);

  it("lists the expected superintendent MCP tool names", async () => {
    const { createMCPServer } = await import("@poe-code/cmdkit/mcp");
    const { superintendentMcpGroup } = await import("./commands/index.js");
    const server = createMCPServer([superintendentMcpGroup], {
      name: "superintendent",
      version: "0.0.1"
    });
    const { client, cleanup } = await createSdkTestPair(server, () =>
      new McpClient({
        clientInfo: {
          name: "test-client",
          version: "1.0.0"
        }
      })
    );

    try {
      const result = await client.listTools();

      expect(result.tools).toHaveLength(6);
      expect(result.tools.map((tool) => tool.name).sort()).toEqual([...EXPECTED_TOOL_NAMES].sort());
    } finally {
      await cleanup();
    }
  });

  it("exposes all superintendent commands through MCP", async () => {
    const { createMCPServer } = await import("@poe-code/cmdkit/mcp");
    const { superintendentMcpGroup } = await import("./commands/index.js");
    const server = createMCPServer([superintendentMcpGroup], {
      name: "superintendent",
      version: "0.0.1"
    });
    const { client, cleanup } = await createSdkTestPair(server, () =>
      new McpClient({
        clientInfo: {
          name: "test-client",
          version: "1.0.0"
        }
      })
    );

    try {
      expect(
        readJsonToolResult(
          await client.callTool({
            name: "superintendent__run",
            arguments: {
              doc: documentPath
            }
          })
        )
      ).toEqual({
        docPath: documentPath,
        builderAgent: "claude-code",
        state: "completed",
        round: 1,
        reviewTurn: 0,
        maxRounds: 100,
        maxReviewTurns: 5,
        stopReason: "completed"
      });
      expect(runLoopMock).toHaveBeenCalledWith(
        expect.objectContaining({
          docPath: documentPath
        })
      );

      expect(
        readJsonToolResult(
          await client.callTool({
            name: "superintendent__validate",
            arguments: {
              path: documentPath
            }
          })
        )
      ).toEqual({
        valid: true,
        problems: []
      });

      expect(
        readJsonToolResult(
          await client.callTool({
            name: "superintendent__complete",
            arguments: {
              path: documentPath,
              reason: "done"
            }
          })
        )
      ).toEqual({
        path: documentPath,
        state: "completed",
        reason: "done"
      });
      await expect(fs.promises.readFile(documentPath, "utf8")).resolves.toContain("state: completed");

      expect(
        readJsonToolResult(
          await client.callTool({
            name: "superintendent__builder__run",
            arguments: {
              path: documentPath
            }
          })
        )
      ).toEqual({
        summary: "Builder completed",
        log: "Updated files"
      });

      expect(
        readJsonToolResult(
          await client.callTool({
            name: "superintendent__inspector__run",
            arguments: {
              path: documentPath,
              name: "code-quality"
            }
          })
        )
      ).toEqual({
        name: "code-quality",
        summary: "Inspector completed"
      });

      expect(
        readJsonToolResult(
          await client.callTool({
            name: "superintendent__inspector__list",
            arguments: {
              path: documentPath
            }
          })
        )
      ).toEqual({
        name: "code-quality",
        agent: "codex",
        mode: "read"
      });
    } finally {
      await cleanup();
    }
  });
});
