import { beforeEach, describe, expect, it, vi } from "vitest";

const { createTerminalPilotGroupMock, runMCPMock, terminalPilotGroupMock } = vi.hoisted(() => ({
  createTerminalPilotGroupMock: vi.fn(),
  runMCPMock: vi.fn<() => Promise<void>>(),
  terminalPilotGroupMock: { name: "terminal-pilot", children: [] }
}));

vi.mock("toolcraft/mcp", () => ({
  runMCP: runMCPMock
}));

vi.mock("terminal-pilot/commands", () => ({
  createTerminalPilotGroup: createTerminalPilotGroupMock
}));

describe("terminal-pilot-mcp entry point", () => {
  beforeEach(() => {
    createTerminalPilotGroupMock.mockReset().mockReturnValue(terminalPilotGroupMock);
    runMCPMock.mockReset();
    runMCPMock.mockResolvedValue(undefined);
    vi.resetModules();
  });

  it("runs toolcraft MCP with the shared terminal-pilot command group", async () => {
    const { main } = await import("./index.js");

    await main();

    expect(createTerminalPilotGroupMock).toHaveBeenCalledOnce();
    expect(runMCPMock).toHaveBeenCalledTimes(1);
    expect(runMCPMock).toHaveBeenCalledWith(expect.objectContaining({ name: "" }), {
      name: "terminal-pilot",
      version: "0.0.1",
      omitRootToolNamePrefix: true
    });
  });

  it("does not start the MCP server as a side effect of importing the module", async () => {
    await import("./index.js");

    expect(runMCPMock).not.toHaveBeenCalled();
  });
});
