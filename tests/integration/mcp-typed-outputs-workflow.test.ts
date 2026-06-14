import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { McpClient, StdioTransport } from "tiny-mcp-client";

const tempDirs: string[] = [];
const root = process.cwd();
const tinyStdioEntry = pathToFileURL(
  path.join(root, "packages/tiny-stdio-mcp-server/dist/index.js")
).href;
const toolcraftEntry = pathToFileURL(path.join(root, "packages/toolcraft/dist/index.js")).href;
const toolcraftMcpEntry = pathToFileURL(path.join(root, "packages/toolcraft/dist/mcp.js")).href;

async function createServerScript(source: string): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "mcp-typed-output-workflow-"));
  tempDirs.push(dir);
  const scriptPath = path.join(dir, "server.mjs");
  await writeFile(scriptPath, source);
  return scriptPath;
}

async function connectToServerScript(scriptPath: string): Promise<{
  client: McpClient;
  cleanup: () => Promise<void>;
}> {
  const transport = new StdioTransport({
    command: process.execPath,
    args: [scriptPath],
    cwd: root,
    env: { ...process.env },
  });
  const client = new McpClient({
    clientInfo: {
      name: "typed-output-workflow-test",
      version: "1.0.0",
    },
  });

  await client.connect(transport);
  return {
    client,
    cleanup: async () => {
      await client.close();
    },
  };
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { force: true, recursive: true })));
});

describe("MCP typed output real stdio workflows", () => {
  it("round-trips typed stdio tools and exposes non-happy paths over MCP", async () => {
    const scriptPath = await createServerScript(`
      import { createServer, defineSchema } from ${JSON.stringify(tinyStdioEntry)};

      const outputSchema = {
        type: "object",
        properties: {
          id: { type: "string" },
          displayName: { type: "string" }
        },
        required: ["id", "displayName"],
        additionalProperties: false
      };
      const server = createServer({ name: "typed-stdio-workflow", version: "1.0.0" });
      server.tool(
        "lookup",
        "Look up a user",
        defineSchema({ id: { type: "string" } }),
        ({ id }) => ({ id, displayName: "Alice" }),
        outputSchema
      );
      server.tool(
        "bad_output",
        "Return an invalid typed result",
        defineSchema({}),
        () => ({ id: 123, displayName: "Alice" }),
        outputSchema
      );
      server.tool(
        "bad_envelope",
        "Return a malformed result envelope",
        defineSchema({}),
        () => ({ content: [], structuredContent: "not an object" })
      );
      await server.listen();
    `);
    const { client, cleanup } = await connectToServerScript(scriptPath);

    try {
      const { tools } = await client.listTools();
      expect(tools.find((tool) => tool.name === "lookup")).toMatchObject({
        outputSchema: {
          type: "object",
          properties: {
            id: { type: "string" },
            displayName: { type: "string" },
          },
          required: ["id", "displayName"],
          additionalProperties: false,
        },
      });

      const result = await client.callTool({
        name: "lookup",
        arguments: { id: "u1" },
      });
      expect(result.structuredContent).toEqual({ id: "u1", displayName: "Alice" });
      expect(result.content).toEqual([
        { type: "text", text: JSON.stringify({ id: "u1", displayName: "Alice" }) },
      ]);

      await expect(client.callTool({ name: "bad_output", arguments: {} })).rejects.toMatchObject({
        code: -32603,
        message: "Invalid structured tool result",
      });
      await expect(client.callTool({ name: "bad_envelope", arguments: {} })).resolves.toMatchObject({
        isError: true,
        content: [{ type: "text", text: "Error: Invalid tool result" }],
      });
    } finally {
      await cleanup();
    }
  });

  it("round-trips toolcraft result schemas through a spawned MCP server, including invalid result failures", async () => {
    const scriptPath = await createServerScript(`
      import { defineCommand, defineGroup, S } from ${JSON.stringify(toolcraftEntry)};
      import { runMCP } from ${JSON.stringify(toolcraftMcpEntry)};

      const resultSchema = S.Object({
        delivery: S.OneOf({
          discriminator: "deliveryKind",
          branches: {
            pickup: S.Object({ pickupAt: S.String() }),
            ship: S.Object({ streetAddress: S.String() })
          }
        }),
        labels: S.Record(S.Object({ displayName: S.String() })),
        contact: S.Union([
          S.Object({ emailAddress: S.String() }),
          S.Object({ phoneNumber: S.String() })
        ])
      });

      await runMCP(
        defineGroup({
          name: "root",
          children: [
            defineCommand({
              name: "route",
              scope: ["mcp"],
              params: S.Object({}),
              result: resultSchema,
              handler: async () => ({
                delivery: { deliveryKind: "ship", streetAddress: "1 Main St" },
                labels: { primary: { displayName: "Primary" } },
                contact: { emailAddress: "ops@example.com" }
              })
            }),
            defineCommand({
              name: "broken_route",
              scope: ["mcp"],
              params: S.Object({}),
              result: resultSchema,
              handler: async () => ({
                delivery: { deliveryKind: "ship" },
                labels: { primary: { displayName: "Primary" } },
                contact: { emailAddress: "ops@example.com" }
              })
            })
          ]
        }),
        {
          name: "typed-toolcraft-workflow",
          version: "1.0.0",
          omitRootToolNamePrefix: true,
          casing: "snake"
        }
      );
    `);
    const { client, cleanup } = await connectToServerScript(scriptPath);

    try {
      const { tools } = await client.listTools();
      expect(tools.find((tool) => tool.name === "route")).toMatchObject({
        outputSchema: {
          properties: {
            delivery: {
              oneOf: expect.arrayContaining([
                expect.objectContaining({
                  properties: expect.objectContaining({
                    delivery_kind: { type: "string", enum: ["ship"] },
                    street_address: { type: "string" },
                  }),
                }),
              ]),
            },
            labels: {
              additionalProperties: {
                properties: {
                  display_name: { type: "string" },
                },
                required: ["display_name"],
                type: "object",
              },
              type: "object",
            },
          },
        },
      });

      const result = await client.callTool({ name: "route", arguments: {} });
      const expected = {
        delivery: { delivery_kind: "ship", street_address: "1 Main St" },
        labels: { primary: { display_name: "Primary" } },
        contact: { email_address: "ops@example.com" },
      };
      expect(result.structuredContent).toEqual(expected);
      expect(JSON.parse(result.content[0]?.type === "text" ? result.content[0].text : "")).toEqual(expected);

      await expect(client.callTool({ name: "broken_route", arguments: {} })).rejects.toMatchObject({
        code: -32603,
      });
    } finally {
      await cleanup();
    }
  });
});
