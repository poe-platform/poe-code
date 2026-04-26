import { beforeEach, describe, expect, it, vi } from "vitest";
import type { listPages, readPage } from "./pages.js";
import type { searchMemory } from "./search.js";
import type { statusOf } from "./status.js";
import type { appendToPage } from "./write.js";
import { printMcpConfig, startMemoryMcpServer, type MemoryMcpRunners } from "./mcp.js";

const listPagesMock = vi.fn<typeof listPages>();
const readPageMock = vi.fn<typeof readPage>();
const searchMemoryMock = vi.fn<typeof searchMemory>();
const statusOfMock = vi.fn<typeof statusOf>();
const appendToPageMock = vi.fn<typeof appendToPage>();

const runners: MemoryMcpRunners = {
  listPages: listPagesMock,
  readPage: readPageMock,
  searchMemory: searchMemoryMock,
  statusOf: statusOfMock,
  appendToPage: appendToPageMock
};

describe("memory MCP helpers", () => {
  beforeEach(() => {
    listPagesMock.mockReset();
    readPageMock.mockReset();
    searchMemoryMock.mockReset();
    statusOfMock.mockReset();
    appendToPageMock.mockReset();
  });

  it("prints the expected stdio MCP config snippet", () => {
    expect(JSON.parse(printMcpConfig())).toEqual({
      mcpServers: {
        "poe-code-memory": {
          type: "stdio",
          command: "poe-code",
          args: ["memory-mcp"]
        }
      }
    });
  });

  it("hides append_to_page when writes are disabled", async () => {
    const { server } = await startMemoryMcpServer(
      { root: "/repo/.poe-code/memory", allowWrites: false },
      runners
    );
    await server.handleMessage("initialize", { protocolVersion: "2025-11-25" });
    const result = await server.handleMessage("tools/list");
    expect(result.error).toBeUndefined();
    expect(result.result).toEqual({
      tools: expect.arrayContaining([
        expect.objectContaining({ name: "list_pages" }),
        expect.objectContaining({ name: "read_page" }),
        expect.objectContaining({ name: "search_memory" }),
        expect.objectContaining({ name: "status" })
      ])
    });
    expect((result.result as { tools: Array<{ name: string }> }).tools).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ name: "append_to_page" })])
    );
  });

  it("advertises append_to_page when writes are enabled", async () => {
    const { server } = await startMemoryMcpServer(
      { root: "/repo/.poe-code/memory", allowWrites: true },
      runners
    );
    await server.handleMessage("initialize", { protocolVersion: "2025-11-25" });
    const result = await server.handleMessage("tools/list");
    expect((result.result as { tools: Array<{ name: string }> }).tools).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: "append_to_page" })])
    );
  });
});
