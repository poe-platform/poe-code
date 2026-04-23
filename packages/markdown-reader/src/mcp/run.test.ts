import { beforeEach, describe, expect, it, vi } from "vitest";

const { runMCPMock, markdownGroupMock } = vi.hoisted(() => ({
  runMCPMock: vi.fn<() => Promise<void>>(),
  markdownGroupMock: { name: "markdown-reader" }
}));

vi.mock("toolcraft/mcp", () => ({
  runMCP: runMCPMock
}));

vi.mock("./group.js", () => ({
  markdownGroup: markdownGroupMock
}));

describe("runMarkdownReaderMcp", () => {
  beforeEach(() => {
    runMCPMock.mockReset();
    runMCPMock.mockResolvedValue(undefined);
    vi.resetModules();
  });

  it("runs cmdkit MCP with the markdown-reader group", async () => {
    const { runMarkdownReaderMcp } = await import("./run.js");

    await runMarkdownReaderMcp();

    expect(runMCPMock).toHaveBeenCalledTimes(1);
    expect(runMCPMock).toHaveBeenCalledWith(markdownGroupMock, {
      name: "markdown-reader",
      version: "0.0.1"
    });
  });

  it("does not start the MCP server as a side effect of importing the module", async () => {
    await import("./run.js");

    expect(runMCPMock).not.toHaveBeenCalled();
  });
});
