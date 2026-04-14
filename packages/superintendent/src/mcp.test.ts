import { beforeEach, describe, expect, it, vi } from "vitest";

const { isDirectExecutionMock, runMCPMock, superintendentGroupMock } = vi.hoisted(() => ({
  isDirectExecutionMock: vi.fn<(moduleUrl: string, argv: string[]) => Promise<boolean>>(),
  runMCPMock: vi.fn<() => Promise<void>>(),
  superintendentGroupMock: { name: "superintendent" }
}));

const originalArgv = [...process.argv];

vi.mock("./direct-execution.js", () => ({
  isDirectExecution: isDirectExecutionMock
}));

vi.mock("@poe-code/cmdkit/mcp", () => ({
  runMCP: runMCPMock
}));

vi.mock("./commands/index.js", () => ({
  superintendentGroup: superintendentGroupMock
}));

describe("superintendent MCP entry point", () => {
  beforeEach(() => {
    process.argv = [...originalArgv];
    isDirectExecutionMock.mockReset();
    isDirectExecutionMock.mockResolvedValue(false);
    runMCPMock.mockReset();
    runMCPMock.mockResolvedValue(undefined);
    vi.resetModules();
  });

  it("runs cmdkit MCP with the superintendent command group", async () => {
    const { main } = await import("./mcp.js");

    await main();

    expect(runMCPMock).toHaveBeenCalledTimes(1);
    expect(runMCPMock).toHaveBeenCalledWith(superintendentGroupMock, {
      name: "superintendent",
      version: "0.0.1"
    });
  });

  it("does not start the MCP server as a side effect of importing the module", async () => {
    await import("./mcp.js");

    expect(runMCPMock).not.toHaveBeenCalled();
  });

  it("executes when isDirectExecution returns true", async () => {
    isDirectExecutionMock.mockResolvedValue(true);

    await import("./mcp.js");

    expect(runMCPMock).toHaveBeenCalledTimes(1);
    expect(runMCPMock).toHaveBeenCalledWith(superintendentGroupMock, {
      name: "superintendent",
      version: "0.0.1"
    });
  });
});
