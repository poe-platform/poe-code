import { beforeEach, describe, expect, it, vi } from "vitest";

const { runMCPMock, terminalPilotGroupMock } = vi.hoisted(() => ({
  runMCPMock: vi.fn<() => Promise<void>>(),
  terminalPilotGroupMock: { name: "terminal-pilot" }
}));

vi.mock("toolcraft/mcp", () => ({
  runMCP: runMCPMock
}));

vi.mock("terminal-pilot/commands", () => ({
  terminalPilotGroup: terminalPilotGroupMock
}));

describe("terminal-pilot-mcp entry point", () => {
  beforeEach(() => {
    runMCPMock.mockReset();
    runMCPMock.mockResolvedValue(undefined);
    vi.resetModules();
  });

  it("runs cmdkit MCP with the shared terminal-pilot command group", async () => {
    const { main } = await import("./index.js");

    await main();

    expect(runMCPMock).toHaveBeenCalledTimes(1);
    expect(runMCPMock).toHaveBeenCalledWith(terminalPilotGroupMock, {
      name: "terminal-pilot",
      version: "0.0.1"
    });
  });

  it("does not start the MCP server as a side effect of importing the module", async () => {
    await import("./index.js");

    expect(runMCPMock).not.toHaveBeenCalled();
  });
});
