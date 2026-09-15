import { describe, expect, it, vi } from "vitest";
import { S, defineCommand, defineGroup, defineStreamCommand, type ToolcraftStream } from "toolcraft";
import { createSDK } from "toolcraft/sdk";
import { createHumanInLoop } from "toolcraft/human-in-loop";
import { createMCPServer } from "toolcraft/mcp";
import { McpClient, createSdkTestPair } from "tiny-mcp-client";
import { defineClient } from "./define-client.js";

describe("client command composition", () => {
  it("retains command approval requirements and blocks execution after a decline", async () => {
    const handler = vi.fn(async () => "executed");
    const client = defineClient({
      name: "audit",
      baseUrl: "https://api.example.test",
      auth: { commands: [], getToken: async () => "unused" },
      commands: [defineCommand({
        name: "deploy",
        params: S.Object({}),
        humanInLoop: { mode: "sync", message: () => "Approve deployment?" },
        handler
      })]
    });

    expect(() => createSDK(client.root)).toThrow("declares humanInLoop but no runtime is wired");
    const requestApproval = vi.fn(async () => ({ outcome: "declined" as const }));
    const sdk = createSDK(client.root, {
      services: client.services,
      errorReports: false,
      humanInLoop: createHumanInLoop({ provider: { id: "test", requestApproval } })
    }) as { deploy(params: object): Promise<unknown> };

    await expect(sdk.deploy({})).rejects.toThrow("Declined");
    expect(requestApproval).toHaveBeenCalledOnce();
    expect(handler).not.toHaveBeenCalled();
  });

  it("retains group approval inheritance when generated and handwritten children are merged", () => {
    const client = defineClient({
      name: "audit",
      baseUrl: "https://api.example.test",
      auth: { commands: [], getToken: async () => "unused" },
      commands: [defineGroup({
        name: "releases",
        humanInLoop: { mode: "sync", message: () => "Approve release?" },
        children: [defineCommand({ name: "read", params: S.Object({}), handler: async () => "read" })]
      })],
      handwrittenCommands: [defineGroup({
        name: "releases",
        children: [defineCommand({ name: "deploy", params: S.Object({}), handler: async () => "deployed" })]
      })]
    });
    const releases = client.root.children[0];

    expect(releases?.humanInLoop).toMatchObject({ mode: "sync" });
    expect(releases?.kind).toBe("group");
    if (releases?.kind === "group") {
      expect(releases.children.find((command) => command.name === "deploy")?.humanInLoop)
        .toMatchObject({ mode: "sync" });
    }
  });

  it("preserves lazy managed streams and cancellation", async () => {
    const produced: number[] = [];
    const cleanup = vi.fn();
    const client = defineClient({
      name: "audit",
      baseUrl: "https://api.example.test",
      auth: { commands: [], getToken: async () => "unused" },
      commands: [defineStreamCommand({
        name: "watch",
        params: S.Object({}),
        event: S.Number(),
        async *handler() {
          try {
            produced.push(1);
            yield 1;
          } finally {
            cleanup();
          }
        }
      })]
    });
    const sdk = createSDK(client.root, { services: client.services, errorReports: false }) as {
      watch(params: object): ToolcraftStream<number>;
    };
    const stream = sdk.watch({});

    expect(produced).toEqual([]);
    expect(stream[Symbol.asyncIterator]).toBeTypeOf("function");
    const iterator = stream[Symbol.asyncIterator]();
    await expect(iterator.next()).resolves.toEqual({ done: false, value: 1 });
    await stream.cancel();
    expect(cleanup).toHaveBeenCalledOnce();
  });

  it("preserves MCP titles, annotations, output schemas, and result projection", async () => {
    const client = defineClient({
      name: "audit",
      baseUrl: "https://api.example.test",
      auth: { commands: [], getToken: async () => "unused" },
      commands: [defineCommand({
        name: "list",
        scope: ["mcp"],
        title: "List items",
        annotations: { readOnlyHint: true, destructiveHint: false },
        params: S.Object({}),
        result: S.Object({ items: S.Array(S.String()) }),
        handler: async () => ["one"],
        mcpResult: (items: string[]) => ({ items })
      })]
    });
    const pair = await createSdkTestPair(
      createMCPServer(client.root, {
        name: "audit",
        version: "1.0.0",
        omitRootToolNamePrefix: true,
        services: client.services
      }),
      () => new McpClient({ clientInfo: { name: "test", version: "1.0.0" } })
    );

    try {
      expect((await pair.client.listTools()).tools).toContainEqual(expect.objectContaining({
        name: "list",
        title: "List items",
        annotations: { readOnlyHint: true, destructiveHint: false },
        outputSchema: expect.objectContaining({ properties: { items: { type: "array", items: { type: "string" } } } })
      }));
      expect(await pair.client.callTool({ name: "list", arguments: {} })).toMatchObject({
        structuredContent: { items: ["one"] }
      });
    } finally {
      await pair.cleanup();
    }
  });
});
