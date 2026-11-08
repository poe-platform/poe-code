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

it("preserves upstream command titles and annotations in both MCP aliases", async () => {
  const { defineCommand, S } = await import("toolcraft");
  const annotations = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };
  createTerminalPilotGroupMock.mockReturnValue({ name: "terminal-pilot", children: [defineCommand({
    name: "list-sessions", title: "List terminal sessions", annotations,
    scope: ["mcp"], params: S.Object({}), handler: () => ({ sessions: [] })
  })] });
  const { createTerminalPilotMCPGroup } = await import("./index.js");
  const group = createTerminalPilotMCPGroup();
  expect(group.children).toHaveLength(2);
  for (const child of group.children) {
    expect(child).toMatchObject({ title: "List terminal sessions", annotations });
  }
});
