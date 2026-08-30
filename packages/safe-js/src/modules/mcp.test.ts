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
    await expect(client.tool("search", { query: "SafeJS" })).resolves.toEqual({
      calledWith: {
        name: "search",
        arguments: {
          query: "SafeJS"
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
        query: "SafeJS"
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

  it("requires own fields for MCP data payloads and server handles", async () => {
    const callTool = vi.fn(async (params: unknown) => params);
    const connectMcp = vi.fn(async () => ({
      async listTools() {
        return {
          tools: [
            Object.assign(
              Object.create({
                description: "polluted description",
                inputSchema: {
                  type: "object"
                }
              }),
              {
                name: "search"
              }
            )
          ]
        };
      },
      callTool
    }));
    const mcp = makeMcpModule(connectMcp);
    const inheritedHandle = Object.assign(
      Object.create({
        args: ["--polluted"],
        env: {
          TOKEN: "polluted"
        }
      }),
      {
        command: "mcp-server"
      }
    );

    expect(() => mcp.server(Object.create({ command: "mcp-server" }) as never)).toThrow(
      "MCP server command must be a non-empty string."
    );

    const client = await mcp.client(inheritedHandle as never);

    expect(connectMcp).toHaveBeenCalledWith({
      command: "mcp-server"
    });
    await expect(client.tools()).resolves.toEqual([
      {
        name: "search"
      }
    ]);
    const inheritedBatchCall = Object.assign(
      Object.create({
        args: {
          polluted: true
        }
      }),
      {
        name: "search"
      }
    );

    await expect(client.toolBatch([inheritedBatchCall])).resolves.toEqual([
      {
        ok: true,
        value: {
          name: "search"
        }
      }
    ]);
    expect(callTool).toHaveBeenCalledWith({
      name: "search"
    });

    const inheritedToolsEnvelope = makeMcpModule(async () => ({
      async listTools() {
        return Object.create({
          tools: []
        });
      },
      async callTool() {
        return {};
      }
    }));

    await expect(
      (await inheritedToolsEnvelope.client({ command: "mcp-server" })).tools()
    ).rejects.toThrow("MCP listTools() must resolve to an object with a tools array.");
  });

  it("does not let Object.prototype fields leak into normalized MCP records", async () => {
    const seenServerArgs: unknown[] = [];
    const callTool = vi.fn(async (params: { arguments?: unknown }) => params.arguments);
    const mcp = makeMcpModule(async (server) => {
      seenServerArgs.push((server as { args?: unknown }).args);
      return {
        async listTools() {
          return {
            tools: [
              {
                name: "search"
              }
            ]
          };
        },
        callTool
      };
    });

    await withObjectPrototypeProperties(
      {
        args: ["--polluted"],
        arguments: {
          polluted: true
        },
        callToolBatch: async () => [
          {
            ok: true,
            value: "polluted batch"
          }
        ],
        description: "polluted description",
        env: {
          TOKEN: "polluted"
        }
      },
      async () => {
        const handle = mcp.server({
          command: "mcp-server"
        });
        expect(Object.getPrototypeOf(handle)).toBeNull();
        expect((handle as { args?: unknown }).args).toBeUndefined();

        const client = await mcp.client(handle);
        expect(seenServerArgs).toEqual([undefined]);

        const tools = await client.tools();
        expect(Object.getPrototypeOf(tools[0])).toBeNull();
        expect((tools[0] as { description?: unknown }).description).toBeUndefined();

        await expect(client.tool("search")).resolves.toBeUndefined();
        const directParams = callTool.mock.calls.at(-1)?.[0];
        expect(Object.getPrototypeOf(directParams)).toBeNull();
        expect(directParams).toMatchObject({
          name: "search"
        });
        expect((directParams as { arguments?: unknown }).arguments).toBeUndefined();

        const batch = await client.toolBatch([{ name: "search" }]);
        expect(batch[0]).toMatchObject({
          ok: true
        });
        expect((batch[0] as { value?: unknown }).value).toBeUndefined();
      }
    );
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

  it("returns an empty toolBatch without protocol calls", async () => {
    const callTool = vi.fn(async () => ({}));
    const callToolBatch = vi.fn(async () => []);
    const mcp = makeMcpModule(async () => ({
      async listTools() {
        return {
          tools: []
        };
      },
      callTool,
      callToolBatch
    }));
    const client = await mcp.client({
      command: "mcp-server"
    });

    await expect(client.toolBatch([])).resolves.toEqual([]);
    expect(callTool).not.toHaveBeenCalled();
    expect(callToolBatch).not.toHaveBeenCalled();
  });

  it("returns successful toolBatch values in input order", async () => {
    const callTool = vi.fn(async (params: { name: string }) => ({
      tool: params.name
    }));
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

    await expect(
      client.toolBatch([
        { name: "first", args: { value: 1 } },
        { name: "second", args: { value: 2 } }
      ])
    ).resolves.toEqual([
      {
        ok: true,
        value: {
          tool: "first"
        }
      },
      {
        ok: true,
        value: {
          tool: "second"
        }
      }
    ]);
    expect(callTool).toHaveBeenNthCalledWith(1, {
      name: "first",
      arguments: {
        value: 1
      }
    });
    expect(callTool).toHaveBeenNthCalledWith(2, {
      name: "second",
      arguments: {
        value: 2
      }
    });
  });

  it("resolves toolBatch with an error envelope when one call fails", async () => {
    const callTool = vi.fn(async (params: { name: string }) => {
      if (params.name === "fail") {
        throw new Error("tool failed");
      }

      return {
        tool: params.name
      };
    });
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

    await expect(client.toolBatch([{ name: "fail" }, { name: "ok" }])).resolves.toEqual([
      {
        ok: false,
        error: {
          message: "tool failed",
          name: "Error"
        }
      },
      {
        ok: true,
        value: {
          tool: "ok"
        }
      }
    ]);
  });

  it("preserves toolBatch order across concurrent fallback execution", async () => {
    const resolvers = new Map<string, (value: unknown) => void>();
    const callTool = vi.fn(
      (params: { name: string }) =>
        new Promise((resolve) => {
          resolvers.set(params.name, resolve);
        })
    );
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

    const batch = client.toolBatch([{ name: "slow" }, { name: "fast" }, { name: "middle" }]);

    resolvers.get("fast")?.("fast-result");
    resolvers.get("middle")?.("middle-result");
    resolvers.get("slow")?.("slow-result");

    await expect(batch).resolves.toEqual([
      {
        ok: true,
        value: "slow-result"
      },
      {
        ok: true,
        value: "fast-result"
      },
      {
        ok: true,
        value: "middle-result"
      }
    ]);
  });

  it("returns clear errors for remaining toolBatch calls after MCP disconnect", async () => {
    let activeCalls = 0;
    let peakActiveCalls = 0;
    const callTool = vi.fn(async (params: { name: string }) => {
      activeCalls += 1;
      peakActiveCalls = Math.max(peakActiveCalls, activeCalls);

      if (params.name === "disconnect") {
        activeCalls -= 1;
        throw new Error("MCP connection disconnected");
      }

      await new Promise<void>((resolve) => {
        setTimeout(resolve, 0);
      });
      activeCalls -= 1;
      return params.name;
    });
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

    await expect(
      client.toolBatch([
        { name: "disconnect" },
        { name: "one" },
        { name: "two" },
        { name: "three" },
        { name: "queued" }
      ])
    ).resolves.toEqual([
      {
        ok: false,
        error: {
          message: "MCP connection disconnected",
          name: "Error"
        }
      },
      {
        ok: true,
        value: "one"
      },
      {
        ok: true,
        value: "two"
      },
      {
        ok: true,
        value: "three"
      },
      {
        ok: false,
        error: {
          message: "MCP connection disconnected",
          name: "Error"
        }
      }
    ]);
    expect(callTool).toHaveBeenCalledTimes(4);
    expect(peakActiveCalls).toBeLessThanOrEqual(4);
  });

  it("enforces existing client tool budget per toolBatch call", async () => {
    const callTool = vi.fn(async (params: { name: string }) => {
      if (params.name === "limited") {
        throw new Error("tool budget exceeded");
      }

      return "ok";
    });
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

    await expect(client.toolBatch([{ name: "limited" }, { name: "small" }])).resolves.toEqual([
      {
        ok: false,
        error: {
          message: "tool budget exceeded",
          name: "Error"
        }
      },
      {
        ok: true,
        value: "ok"
      }
    ]);
    expect(callTool).toHaveBeenCalledTimes(2);
  });

  it("uses protocol batch calls when the connection exposes them", async () => {
    const callTool = vi.fn(async () => ({}));
    const callToolBatch = vi.fn(async () => [
      {
        ok: true,
        value: "first"
      },
      {
        ok: false,
        error: {
          message: "failed",
          name: "Error"
        }
      }
    ]);
    const mcp = makeMcpModule(async () => ({
      async listTools() {
        return {
          tools: []
        };
      },
      callTool,
      callToolBatch
    }));
    const client = await mcp.client({
      command: "mcp-server"
    });

    await expect(
      client.toolBatch([{ name: "first", args: { value: 1 } }, { name: "second" }])
    ).resolves.toEqual([
      {
        ok: true,
        value: "first"
      },
      {
        ok: false,
        error: {
          message: "failed",
          name: "Error"
        }
      }
    ]);
    expect(callTool).not.toHaveBeenCalled();
    expect(callToolBatch).toHaveBeenCalledWith([
      {
        name: "first",
        arguments: {
          value: 1
        }
      },
      {
        name: "second"
      }
    ]);
  });

  it("falls back to concurrent calls when protocol batch input has validation failures", async () => {
    const callTool = vi.fn(async (params: { name: string }) => params.name);
    const callToolBatch = vi.fn(async () => []);
    const mcp = makeMcpModule(async () => ({
      async listTools() {
        return {
          tools: []
        };
      },
      callTool,
      callToolBatch
    }));
    const client = await mcp.client({
      command: "mcp-server"
    });

    await expect(
      client.toolBatch([{ name: "valid" }, { name: "invalid", args: null }])
    ).resolves.toEqual([
      {
        ok: true,
        value: "valid"
      },
      {
        ok: false,
        error: {
          message: "MCP tool arguments must be an object.",
          name: "Error"
        }
      }
    ]);
    expect(callTool).toHaveBeenCalledTimes(1);
    expect(callToolBatch).not.toHaveBeenCalled();
  });

  it("rejects non-array toolBatch input", async () => {
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

    await expect(client.toolBatch({ name: "search" } as never)).rejects.toThrow(
      "MCP toolBatch calls must be an array."
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

    await expect(client.tools()).rejects.toThrow("MCP tool[1] name must be a non-empty string.");

    const missingTools = makeMcpModule(async () => ({
      async listTools() {
        return {};
      },
      async callTool() {
        return {};
      }
    }));

    await expect((await missingTools.client({ command: "mcp-server" })).tools()).rejects.toThrow(
      "MCP listTools() must resolve to an object with a tools array."
    );
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

async function withObjectPrototypeProperties<T>(
  properties: Record<string, unknown>,
  callback: () => Promise<T> | T
): Promise<T> {
  const originals = new Map<string, PropertyDescriptor | undefined>();
  for (const [key, value] of Object.entries(properties)) {
    originals.set(key, Object.getOwnPropertyDescriptor(Object.prototype, key));
    Object.defineProperty(Object.prototype, key, {
      configurable: true,
      value,
      writable: true
    });
  }

  try {
    return await callback();
  } finally {
    for (const [key, descriptor] of originals) {
      if (descriptor === undefined) {
        delete (Object.prototype as Record<string, unknown>)[key];
      } else {
        Object.defineProperty(Object.prototype, key, descriptor);
      }
    }
  }
}
