import { beforeEach, describe, expect, it, vi } from "vitest";
import { createWorkflowTool } from "./runtime/workflow-tool.js";

const {
  createMCPServerMock,
  createServerMock,
  isDirectExecutionMock,
  mcpListenMock,
  serverListenMock,
  serverToolMock,
  superintendentMcpGroupMock
} = vi.hoisted(() => {
  const mcpListenMock = vi.fn<() => Promise<void>>();
  const createMCPServerMock = vi.fn(() => ({
    listen: mcpListenMock
  }));
  const serverListenMock = vi.fn<() => Promise<void>>();
  const serverToolMock = vi.fn<(name: string, description: string, schema: unknown, handler: unknown) => unknown>();
  const createServerMock = vi.fn(() => {
    const server = {
      tool(name: string, description: string, schema: unknown, handler: unknown) {
        serverToolMock(name, description, schema, handler);
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
    superintendentMcpGroupMock: { name: "superintendent" }
  };
});

const originalArgv = [...process.argv];

vi.mock("./direct-execution.js", () => ({
  isDirectExecution: isDirectExecutionMock
}));

vi.mock("@poe-code/cmdkit/mcp", () => ({
  createMCPServer: createMCPServerMock
}));

vi.mock("tiny-stdio-mcp-server", () => ({
  createServer: createServerMock
}));

vi.mock("./commands/index.js", () => ({
  superintendentMcpGroup: superintendentMcpGroupMock
}));

describe("superintendent MCP entry point", () => {
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
    vi.resetModules();
  });

  it("starts cmdkit MCP with the superintendent MCP command group", async () => {
    const { main } = await import("./mcp.js");

    await main();

    expect(createMCPServerMock).toHaveBeenCalledTimes(1);
    expect(createMCPServerMock).toHaveBeenCalledWith([superintendentMcpGroupMock], {
      name: "superintendent",
      version: "0.0.1"
    });
    expect(mcpListenMock).toHaveBeenCalledTimes(1);
    expect(createServerMock).not.toHaveBeenCalled();
  });

  it("runs a dedicated workflow transition MCP server when requested", async () => {
    const workflowTool = createWorkflowTool("superintendent", "in_progress");
    const encodedTool = Buffer.from(JSON.stringify(workflowTool), "utf8").toString("base64");
    const { main } = await import("./mcp.js");

    await main(["node", "/repo/packages/superintendent/dist/mcp.js", "workflow-transition", encodedTool]);

    expect(createMCPServerMock).not.toHaveBeenCalled();
    expect(mcpListenMock).not.toHaveBeenCalled();
    expect(createServerMock).toHaveBeenCalledWith({
      name: "superintendent-workflow-transition",
      version: "0.0.1"
    });
    expect(serverToolMock).toHaveBeenCalledTimes(1);
    expect(serverToolMock).toHaveBeenCalledWith(
      workflowTool.name,
      workflowTool.description,
      workflowTool.inputSchema,
      expect.any(Function)
    );
    expect(serverListenMock).toHaveBeenCalledTimes(1);

    const handler = serverToolMock.mock.calls[0]?.[3] as ((args: unknown) => Promise<unknown>) | undefined;

    expect(handler).toBeDefined();
    await expect(handler?.({ action: "request_review", summary: "Ready for owner review" })).resolves.toBe(
      "Recorded workflow transition: request_review"
    );
    await expect(handler?.({ action: "approve_completion" })).rejects.toThrow(
      'workflow.transition action "approve_completion" is not allowed for this role/state'
    );
  });

  it("fails when the workflow transition payload is invalid", async () => {
    const { main } = await import("./mcp.js");

    await expect(
      main(["node", "/repo/packages/superintendent/dist/mcp.js", "workflow-transition", "not-base64"])
    ).rejects.toThrow("Invalid workflow transition tool definition");
    expect(createMCPServerMock).not.toHaveBeenCalled();
    expect(mcpListenMock).not.toHaveBeenCalled();
    expect(createServerMock).not.toHaveBeenCalled();
  });

  it("does not start the MCP server as a side effect of importing the module", async () => {
    await import("./mcp.js");

    expect(createMCPServerMock).not.toHaveBeenCalled();
    expect(mcpListenMock).not.toHaveBeenCalled();
    expect(createServerMock).not.toHaveBeenCalled();
  });

  it("executes when isDirectExecution returns true", async () => {
    isDirectExecutionMock.mockResolvedValue(true);

    await import("./mcp.js");

    expect(createMCPServerMock).toHaveBeenCalledTimes(1);
    expect(createMCPServerMock).toHaveBeenCalledWith([superintendentMcpGroupMock], {
      name: "superintendent",
      version: "0.0.1"
    });
    expect(mcpListenMock).toHaveBeenCalledTimes(1);
  });
});
