import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MemoryHandle } from "./handle.js";
import { printMcpConfig, startMemoryMcpServer } from "./mcp.js";

function createHandle(): MemoryHandle {
  return {
    root: "/repo/.poe-code/memory",
    listPages: vi.fn().mockResolvedValue([]),
    readPage: vi.fn().mockResolvedValue({
      relPath: "pages/one.md",
      frontmatter: {},
      body: "# One\n",
      bytes: 6,
      mtimeMs: 0
    }),
    searchMemory: vi.fn().mockResolvedValue([]),
    statusOf: vi.fn().mockResolvedValue({
      pageCount: 0,
      totalBytes: 0,
      lastWriteAt: null,
      initialized: true
    }),
    computeTokenStats: vi.fn(),
    explainPage: vi.fn(),
    writePage: vi.fn(),
    appendToPage: vi.fn().mockResolvedValue({
      created: [],
      updated: ["pages/one.md"],
      deleted: []
    }),
    clearMemory: vi.fn(),
    query: vi.fn(),
    ingest: vi.fn(),
    auditClaims: vi.fn()
  };
}

describe("memory MCP helpers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
    const handle = createHandle();
    const { server } = await startMemoryMcpServer(handle, { allowWrites: false });
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
    const handle = createHandle();
    const { server } = await startMemoryMcpServer(handle, { allowWrites: true });
    await server.handleMessage("initialize", { protocolVersion: "2025-11-25" });
    const result = await server.handleMessage("tools/list");
    expect((result.result as { tools: Array<{ name: string }> }).tools).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: "append_to_page" })])
    );
  });

  it("delegates tool calls through the provided handle", async () => {
    const handle = createHandle();
    handle.listPages = vi.fn().mockResolvedValue([
      {
        relPath: "pages/one.md",
        frontmatter: { description: "First page" },
        body: "# One\n",
        bytes: 6,
        mtimeMs: 0
      }
    ]);
    handle.appendToPage = vi.fn().mockResolvedValue({
      created: [],
      updated: ["pages/one.md"],
      deleted: []
    });

    const { server } = await startMemoryMcpServer(handle, { allowWrites: true });
    await server.handleMessage("initialize", { protocolVersion: "2025-11-25" });

    const listResult = await server.handleMessage("tools/call", {
      name: "list_pages",
      arguments: {}
    });
    expect(handle.listPages).toHaveBeenCalledOnce();
    expect(listResult.error).toBeUndefined();

    const appendResult = await server.handleMessage("tools/call", {
      name: "append_to_page",
      arguments: {
        rel_path: "pages/one.md",
        content: "extra\n",
        reason: "keep notes current"
      }
    });
    expect(handle.appendToPage).toHaveBeenCalledWith("pages/one.md", "extra\n", {
      reason: "keep notes current"
    });
    expect(appendResult.error).toBeUndefined();
  });

  it("rejects negative search result limits", async () => {
    const handle = createHandle();
    handle.searchMemory = vi.fn().mockResolvedValue([
      { relPath: "pages/one.md", lineNumber: 1, line: "one" },
    ]);
    const { server } = await startMemoryMcpServer(handle, { allowWrites: false });
    await server.handleMessage("initialize", { protocolVersion: "2025-11-25" });

    const result = await server.handleMessage("tools/call", {
      name: "search_memory",
      arguments: { query: "one", limit: -1 },
    });

    expect(result.result).toMatchObject({ isError: true });
    expect(handle.searchMemory).not.toHaveBeenCalled();
  });

  it("returns search hits as typed snake_case MCP output", async () => {
    const handle = createHandle();
    handle.searchMemory = vi.fn().mockResolvedValue([
      { relPath: "pages/one.md", lineNumber: 3, line: "needle" },
    ]);
    const { server } = await startMemoryMcpServer(handle, { allowWrites: false });
    await server.handleMessage("initialize", { protocolVersion: "2025-11-25" });

    const listResult = await server.handleMessage("tools/list");
    expect(listResult.result).toMatchObject({
      tools: expect.arrayContaining([
        expect.objectContaining({
          name: "search_memory",
          outputSchema: expect.objectContaining({
            properties: expect.objectContaining({
              hits: expect.objectContaining({
                items: expect.objectContaining({
                  properties: expect.objectContaining({
                    rel_path: { type: "string" },
                  }),
                }),
              }),
            }),
          }),
        }),
      ]),
    });

    const result = await server.handleMessage("tools/call", {
      name: "search_memory",
      arguments: { query: "needle" },
    });
    const expected = {
      hits: [{ rel_path: "pages/one.md", line_number: 3, line: "needle" }],
    };

    expect(result.result).toMatchObject({ structuredContent: expected });
    expect(JSON.parse((result.result as { content: Array<{ text: string }> }).content[0]!.text)).toEqual(expected);
  });

  it("returns an MCP tool error when memory search rejects", async () => {
    const handle = createHandle();
    handle.searchMemory = vi.fn().mockRejectedValue(
      new Error('Memory root "/repo/.poe-code/memory" cannot be a symbolic link.')
    );
    const { server } = await startMemoryMcpServer(handle, { allowWrites: false });
    await server.handleMessage("initialize", { protocolVersion: "2025-11-25" });

    const result = await server.handleMessage("tools/call", {
      name: "search_memory",
      arguments: { query: "secret" }
    });

    expect(result.result).toMatchObject({ isError: true });
    expect(handle.searchMemory).toHaveBeenCalledWith("secret");
  });
});
