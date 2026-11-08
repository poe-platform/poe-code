import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { superintendentMcpGroup } from "./commands/index.js";
import type { SuperintendentDoc } from "./document/parse.js";
import type { parseSuperintendentDoc } from "./document/parse.js";
import { createWorkflowTool } from "./runtime/workflow-tool.js";
import { createBuilderTool, createInspectorTool } from "./runtime/agentic-tools.js";
import type { runBuilder } from "./runtime/run-builder.js";
import type { runInspector } from "./runtime/run-inspector.js";
import type { McpRunners, SuperintendentToolsPayload } from "./mcp.js";
import type * as mcpEntry from "./mcp.js";

const {
  createMCPServerMock,
  createServerMock,
  isDirectExecutionMock,
  mcpListenMock,
  serverListenMock,
  serverToolMock,
  readFileMock
} = vi.hoisted(() => {
  const mcpListenMock = vi.fn<() => Promise<void>>();
  const createMCPServerMock = vi.fn(() => ({
    listen: mcpListenMock
  }));
  const serverListenMock = vi.fn<() => Promise<void>>();
  const serverToolMock = vi.fn<(
    name: string,
    description: string,
    schema: unknown,
    handler: unknown,
    outputSchema?: unknown
  ) => unknown>();
  const createServerMock = vi.fn(() => {
    const server = {
      tool(
        name: string,
        description: string,
        schema: unknown,
        handler: unknown,
        outputSchema?: unknown
      ) {
        serverToolMock(name, description, schema, handler, outputSchema);
        return server;
      },
      listen: serverListenMock
    };

    return server;
  });

  return {
    createMCPServerMock,
    createServerMock,
    isDirectExecutionMock: vi.fn<(moduleUrl: string, argv: string[]) => Promise<boolean>>(),
    mcpListenMock,
    serverListenMock,
    serverToolMock,
    readFileMock: vi.fn()
  };
});

const superintendentMcpGroupSentinel = {
  name: "superintendent"
} as unknown as typeof superintendentMcpGroup;
const runBuilderMock = vi.fn<typeof runBuilder>();
const runInspectorMock = vi.fn<typeof runInspector>();
const parseSuperintendentDocMock = vi.fn<typeof parseSuperintendentDoc>();

const runners: McpRunners = {
  superintendentMcpGroup: superintendentMcpGroupSentinel,
  runBuilder: runBuilderMock,
  runInspector: runInspectorMock,
  parseSuperintendentDoc: parseSuperintendentDocMock
};

const originalArgv = [...process.argv];
let mcpModule: typeof mcpEntry;

vi.mock("./direct-execution.js", () => ({
  isDirectExecution: isDirectExecutionMock
}));

vi.mock("toolcraft/mcp", () => ({
  createMCPServer: createMCPServerMock
}));

vi.mock("tiny-stdio-mcp-server", () => ({
  createServer: createServerMock
}));

vi.mock("node:fs/promises", () => ({
  readFile: readFileMock
}));

const PAYLOAD: SuperintendentToolsPayload = {
  docPath: "/repo/docs/plans/feature.md",
  state: "in_progress",
  inspectorNames: ["code-quality", "testing"]
};

function encodePayload(payload: SuperintendentToolsPayload): string {
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64");
}

describe("superintendent MCP entry point", () => {
  beforeAll(async () => {
    isDirectExecutionMock.mockResolvedValue(false);
    mcpModule = await import("./mcp.js");
  });

  beforeEach(() => {
    process.argv = [...originalArgv];
    createMCPServerMock.mockReset();
    createMCPServerMock.mockReturnValue({ listen: mcpListenMock });
    createServerMock.mockClear();
    isDirectExecutionMock.mockReset();
    isDirectExecutionMock.mockResolvedValue(false);
    mcpListenMock.mockReset();
    mcpListenMock.mockResolvedValue(undefined);
    serverListenMock.mockReset();
    serverListenMock.mockResolvedValue(undefined);
    serverToolMock.mockReset();
    runBuilderMock.mockReset();
    runInspectorMock.mockReset();
    parseSuperintendentDocMock.mockReset();
    readFileMock.mockReset();
  });

  it("starts toolcraft MCP with the superintendent MCP command group", async () => {
    await mcpModule.main(undefined, { runners });

    expect(createMCPServerMock).toHaveBeenCalledTimes(1);
    expect(createMCPServerMock).toHaveBeenCalledWith([superintendentMcpGroupSentinel], {
      name: "superintendent",
      version: "0.0.1"
    });
    expect(mcpListenMock).toHaveBeenCalledTimes(1);
    expect(createServerMock).not.toHaveBeenCalled();
  });

  it("registers workflow_transition, builder_run, and inspector_run on the superintendent-tools server", async () => {
    await mcpModule.main([
      "node",
      "/repo/packages/superintendent/dist/mcp.js",
      "superintendent-tools",
      encodePayload(PAYLOAD)
    ], { runners });

    expect(createMCPServerMock).not.toHaveBeenCalled();
    expect(mcpListenMock).not.toHaveBeenCalled();
    expect(createServerMock).toHaveBeenCalledWith({
      name: "superintendent-agentic-tools",
      version: "0.0.1"
    });
    expect(serverListenMock).toHaveBeenCalledTimes(1);

    const expectedWorkflowTool = createWorkflowTool("superintendent", PAYLOAD.state);
    const expectedBuilderTool = createBuilderTool();
    const expectedInspectorTool = createInspectorTool(PAYLOAD.inspectorNames);

    expect(serverToolMock).toHaveBeenCalledTimes(3);
    expect(serverToolMock).toHaveBeenNthCalledWith(
      1,
      expectedWorkflowTool.name,
      expectedWorkflowTool.description,
      expectedWorkflowTool.inputSchema,
      expect.any(Function),
      expectedWorkflowTool.outputSchema
    );
    expect(serverToolMock).toHaveBeenNthCalledWith(
      2,
      expectedBuilderTool.name,
      expectedBuilderTool.description,
      expectedBuilderTool.inputSchema,
      expect.any(Function),
      expectedBuilderTool.outputSchema
    );
    expect(serverToolMock).toHaveBeenNthCalledWith(
      3,
      expectedInspectorTool.name,
      expectedInspectorTool.description,
      expectedInspectorTool.inputSchema,
      expect.any(Function),
      expectedInspectorTool.outputSchema
    );
  });

  it("workflow_transition handler records allowed actions and rejects others", async () => {
    await mcpModule.main([
      "node",
      "/repo/packages/superintendent/dist/mcp.js",
      "superintendent-tools",
      encodePayload(PAYLOAD)
    ], { runners });

    const workflowHandler = serverToolMock.mock.calls[0]?.[3] as (
      input: unknown
    ) => Promise<unknown>;

    await expect(
      workflowHandler({ action: "request_review", summary: "Ready for owner review" })
    ).resolves.toEqual({ recorded: { action: "request_review" } });
    await expect(workflowHandler({ action: "approve_completion" })).rejects.toThrow(
      'workflow_transition action "approve_completion" is not allowed for this role/state'
    );
  });

  it("builder_run handler reads the doc fresh and forwards the prompt override", async () => {
    const freshDoc = { filePath: PAYLOAD.docPath } as unknown as SuperintendentDoc;
    readFileMock.mockResolvedValue("doc-content");
    parseSuperintendentDocMock.mockReturnValue(freshDoc);
    runBuilderMock.mockResolvedValue({
      summary: "Builder summary",
      log: "log",
      log_path: "/tmp/builder.jsonl"
    });

    await mcpModule.main([
      "node",
      "/repo/packages/superintendent/dist/mcp.js",
      "superintendent-tools",
      encodePayload(PAYLOAD)
    ], { runners });

    const builderHandler = serverToolMock.mock.calls[1]?.[3] as (
      input: unknown
    ) => Promise<unknown>;

    const result = await builderHandler({ prompt: "Fix the failing test in foo.test.ts" });

    expect(readFileMock).toHaveBeenCalledWith(PAYLOAD.docPath, "utf8");
    expect(parseSuperintendentDocMock).toHaveBeenCalledWith(PAYLOAD.docPath, "doc-content");
    expect(runBuilderMock).toHaveBeenCalledWith(freshDoc, {}, {
      promptOverride: "Fix the failing test in foo.test.ts",
      defaultCwd: process.cwd()
    });
    expect(result).toEqual({
      summary: "Builder summary",
      log: "log",
      log_path: "/tmp/builder.jsonl"
    });
  });

  it("inspector_run handler resolves the inspector config and forwards the optional prompt", async () => {
    const inspectorConfig = { agent: "claude-code", prompt: "configured prompt" };
    const freshDoc = {
      filePath: PAYLOAD.docPath,
      frontmatter: {
        inspectors: {
          "code-quality": inspectorConfig
        }
      }
    } as unknown as SuperintendentDoc;
    readFileMock.mockResolvedValue("doc-content");
    parseSuperintendentDocMock.mockReturnValue(freshDoc);
    runInspectorMock.mockResolvedValue({
      name: "code-quality",
      summary: "Looks good"
    });

    await mcpModule.main([
      "node",
      "/repo/packages/superintendent/dist/mcp.js",
      "superintendent-tools",
      encodePayload(PAYLOAD)
    ], { runners });

    const inspectorHandler = serverToolMock.mock.calls[2]?.[3] as (
      input: unknown
    ) => Promise<unknown>;

    const result = await inspectorHandler({
      name: "code-quality",
      prompt: "Re-check after the latest fix"
    });

    expect(runInspectorMock).toHaveBeenCalledWith(
      "code-quality",
      inspectorConfig,
      freshDoc,
      {},
      {
        defaultCwd: process.cwd(),
        promptOverride: "Re-check after the latest fix"
      }
    );
    expect(result).toEqual({ name: "code-quality", summary: "Looks good" });
  });

  it("inspector_run handler rejects unknown inspector names", async () => {
    await mcpModule.main([
      "node",
      "/repo/packages/superintendent/dist/mcp.js",
      "superintendent-tools",
      encodePayload(PAYLOAD)
    ], { runners });

    const inspectorHandler = serverToolMock.mock.calls[2]?.[3] as (
      input: unknown
    ) => Promise<unknown>;

    await expect(inspectorHandler({ name: "missing-inspector" })).rejects.toThrow(
      'inspector_run name "missing-inspector" is not configured'
    );
  });

  it("fails when the superintendent-tools payload is invalid", async () => {
    await expect(
      mcpModule.main([
        "node",
        "/repo/packages/superintendent/dist/mcp.js",
        "superintendent-tools",
        "not-base64"
      ], { runners })
    ).rejects.toThrow("Invalid superintendent-tools payload");
    expect(createMCPServerMock).not.toHaveBeenCalled();
    expect(mcpListenMock).not.toHaveBeenCalled();
    expect(createServerMock).not.toHaveBeenCalled();
  });

  it("registers the encoded workflow_transition tool when workflow-transition subcommand is used", async () => {
    const ownerTool = createWorkflowTool("owner", "review");
    const encodedTool = Buffer.from(JSON.stringify(ownerTool), "utf8").toString("base64");

    await mcpModule.main([
      "node",
      "/repo/packages/superintendent/dist/mcp.js",
      "workflow-transition",
      encodedTool
    ], { runners });

    expect(createMCPServerMock).not.toHaveBeenCalled();
    expect(mcpListenMock).not.toHaveBeenCalled();
    expect(createServerMock).toHaveBeenCalledWith({
      name: "superintendent-workflow-transition",
      version: "0.0.1"
    });
    expect(serverListenMock).toHaveBeenCalledTimes(1);
    expect(serverToolMock).toHaveBeenCalledTimes(1);
    expect(serverToolMock).toHaveBeenCalledWith(
      ownerTool.name,
      ownerTool.description,
      ownerTool.inputSchema,
      expect.any(Function),
      ownerTool.outputSchema
    );
  });

  it("workflow-transition handler accepts allowed actions and rejects others", async () => {
    const ownerTool = createWorkflowTool("owner", "review");
    const encodedTool = Buffer.from(JSON.stringify(ownerTool), "utf8").toString("base64");

    await mcpModule.main([
      "node",
      "/repo/packages/superintendent/dist/mcp.js",
      "workflow-transition",
      encodedTool
    ], { runners });

    const handler = serverToolMock.mock.calls[0]?.[3] as (input: unknown) => Promise<unknown>;

    await expect(handler({ action: "approve_completion" })).resolves.toEqual({
      recorded: { action: "approve_completion" }
    });
    await expect(
      handler({ action: "request_changes", feedback: "Task 2 not done" })
    ).resolves.toEqual({ recorded: { action: "request_changes" } });
    await expect(
      handler({ action: "request_review", summary: "ready" })
    ).rejects.toThrow(
      'workflow_transition action "request_review" is not allowed for this role/state'
    );
  });

  it("fails when the workflow-transition payload is invalid", async () => {
    await expect(
      mcpModule.main([
        "node",
        "/repo/packages/superintendent/dist/mcp.js",
        "workflow-transition",
        "not-base64"
      ], { runners })
    ).rejects.toThrow("Invalid workflow-transition payload");
    expect(createMCPServerMock).not.toHaveBeenCalled();
    expect(createServerMock).not.toHaveBeenCalled();
  });

  it("does not start the MCP server as a side effect of importing the module", async () => {
    vi.resetModules();
    await import("./mcp.js");

    expect(createMCPServerMock).not.toHaveBeenCalled();
    expect(mcpListenMock).not.toHaveBeenCalled();
    expect(createServerMock).not.toHaveBeenCalled();
  });

  it("executes when isDirectExecution returns true", async () => {
    vi.resetModules();
    isDirectExecutionMock.mockResolvedValue(true);

    await import("./mcp.js");
    const { superintendentMcpGroup } = await import("./commands/index.js");

    expect(createMCPServerMock).toHaveBeenCalledTimes(1);
    expect(createMCPServerMock).toHaveBeenCalledWith([superintendentMcpGroup], {
      name: "superintendent",
      version: "0.0.1"
    });
    expect(mcpListenMock).toHaveBeenCalledTimes(1);
  });
});
