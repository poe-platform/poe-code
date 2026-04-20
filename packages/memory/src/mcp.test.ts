import { beforeEach, describe, expect, it, vi } from "vitest";

const listPages = vi.fn();
const readPage = vi.fn();
const searchMemory = vi.fn();
const statusOf = vi.fn();
const appendToPage = vi.fn();

vi.mock("./pages.js", () => ({ listPages, readPage }));
vi.mock("./search.js", () => ({ searchMemory }));
vi.mock("./status.js", () => ({ statusOf }));
vi.mock("./write.js", () => ({ appendToPage }));

const { printMcpConfig, startMemoryMcpServer } = await import("./mcp.js");

describe("memory MCP helpers", () => {
  beforeEach(() => {
    listPages.mockReset();
    readPage.mockReset();
    searchMemory.mockReset();
    statusOf.mockReset();
    appendToPage.mockReset();
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
    const { server } = await startMemoryMcpServer({ root: "/repo/.poe-code/memory", allowWrites: false });
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
    const { server } = await startMemoryMcpServer({ root: "/repo/.poe-code/memory", allowWrites: true });
    await server.handleMessage("initialize", { protocolVersion: "2025-11-25" });
    const result = await server.handleMessage("tools/list");
    expect((result.result as { tools: Array<{ name: string }> }).tools).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: "append_to_page" })])
    );
  });
});
