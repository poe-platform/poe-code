import { describe, expect, it, vi } from "vitest";

import { makeMcpModule } from "./mcp.js";

describe("makeMcpModule", () => {
  it("creates server handles and wraps a connected client", async () => {
    const listTools = vi.fn(async () => ({
      tools: [
        {
          name: "search",
          description: "Search docs",
          inputSchema: {
            type: "object",
            properties: {
              query: { type: "string" }
            }
          }
        }
      ]
    }));
    const callTool = vi.fn(async (params: unknown) => ({
      calledWith: params
    }));
    const connectMcp = vi.fn(async (server: unknown) => ({
      listTools,
      callTool,
      server
    }));
    const mcp = makeMcpModule(connectMcp);

    const handle = mcp.server({
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-everything"],
      env: {
        TOKEN: "secret"
      }
    });
    const client = await mcp.client(handle);

    expect(handle).toEqual({
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-everything"],
      env: {
        TOKEN: "secret"
      }
    });
    await expect(client.tools()).resolves.toEqual([
      {
        name: "search",
        description: "Search docs",
        schema: {
          type: "object",
          properties: {
            query: { type: "string" }
          }
        }
      }
    ]);
    await expect(client.tool("search", { query: "agent-script" })).resolves.toEqual({
      calledWith: {
        name: "search",
        arguments: {
          query: "agent-script"
        }
      }
    });

    expect(connectMcp).toHaveBeenCalledWith({
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-everything"],
      env: {
        TOKEN: "secret"
      }
    });
    expect(listTools).toHaveBeenCalledTimes(1);
    expect(callTool).toHaveBeenCalledWith({
      name: "search",
      arguments: {
        query: "agent-script"
      }
    });
  });

  it("trims user input for commands and tool names and omits undefined tool args", async () => {
    const callTool = vi.fn(async (params: unknown) => params);
    const connectMcp = vi.fn(async () => ({
      async listTools() {
        return {
          tools: []
        };
      },
      callTool
    }));
    const mcp = makeMcpModule(connectMcp);

    const handle = mcp.server({
      command: "  npx  ",
      args: ["serve"]
    });
    const client = await mcp.client(handle);

    await expect(client.tool("  search  ")).resolves.toEqual({
      name: "search"
    });
    expect(handle).toEqual({
      command: "npx",
      args: ["serve"]
    });
    expect(connectMcp).toHaveBeenCalledWith({
      command: "npx",
      args: ["serve"]
    });
    expect(callTool).toHaveBeenCalledWith({
      name: "search"
    });
  });

  it("rejects non-object tool arguments before calling the injected client", async () => {
    const callTool = vi.fn(async () => ({}));
    const mcp = makeMcpModule(async () => ({
      async listTools() {
        return {
          tools: []
        };
      },
      callTool
    }));
    const client = await mcp.client({
      command: "mcp-server"
    });

    await expect(client.tool("search", null)).rejects.toThrow(
      "MCP tool arguments must be an object."
    );
    await expect(client.tool("search", ["term"])).rejects.toThrow(
      "MCP tool arguments must be an object."
    );
    await expect(client.tool("search", "term")).rejects.toThrow(
      "MCP tool arguments must be an object."
    );
    expect(callTool).not.toHaveBeenCalled();
  });

  it("rejects malformed tools/list payloads with explicit errors", async () => {
    const mcp = makeMcpModule(async () => ({
      async listTools() {
        return {
          tools: [
            {
              name: "valid"
            },
            {
              name: "   "
            }
          ]
        };
      },
      async callTool() {
        return {};
      }
    }));
    const client = await mcp.client({
      command: "mcp-server"
    });

    await expect(client.tools()).rejects.toThrow(
      "MCP tool[1] name must be a non-empty string."
    );

    const missingTools = makeMcpModule(async () => ({
      async listTools() {
        return {};
      },
      async callTool() {
        return {};
      }
    }));

    await expect(
      (await missingTools.client({ command: "mcp-server" })).tools()
    ).rejects.toThrow("MCP listTools() must resolve to an object with a tools array.");
  });

  it("validates server handles and connected clients", async () => {
    const mcp = makeMcpModule(async () => ({
      listTools: async () => ({ tools: [] }),
      callTool: async () => ({})
    }));

    expect(() =>
      mcp.server({
        command: "   "
      })
    ).toThrow("MCP server command must be a non-empty string.");

    await expect(
      mcp.client({
        args: ["serve"]
      } as never)
    ).rejects.toThrow("MCP server command must be a non-empty string.");

    const invalidClient = makeMcpModule(async () => ({}));

    await expect(
      invalidClient.client({
        command: "mcp-server"
      })
    ).rejects.toThrow("connectMcp must resolve to an object with listTools() and callTool().");
  });
});
