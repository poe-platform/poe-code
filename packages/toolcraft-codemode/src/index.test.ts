import { describe, expect, it } from "vitest";
import { defineCommand, defineGroup } from "toolcraft";
import { createSDK } from "toolcraft/sdk";
import { S } from "toolcraft-schema";

import { codeMode } from "./index.js";

type FixtureServices = {
  scaleFactor: number;
};

function fixtureRoot() {
  return defineGroup({
    name: "math_tools",
    children: [
      defineCommand({
        name: "add",
        description: "Add two numbers.",
        scope: ["sdk"],
        params: S.Object({
          left: S.Number({ description: "Left operand." }),
          right: S.Number({ description: "Right operand." })
        }),
        handler: async ({ params }) => params.left + params.right
      }),
      defineCommand({
        name: "multiply",
        description: "Multiply two numbers.",
        scope: ["sdk"],
        params: S.Object({
          left: S.Number({ description: "Left operand." }),
          right: S.Number({ description: "Right operand." })
        }),
        handler: async ({ params }) => params.left * params.right
      })
    ]
  });
}

describe("codeMode", () => {
  it("wraps a toolcraft root with searchable executable code-mode meta-tools", async () => {
    const sdk = createSDK(
      codeMode(fixtureRoot(), {
        search: {
          defaultDetail: "detailed",
          defaultLimit: 1
        }
      })
    ) as {
      search(params: { query: string }): Promise<Array<{ path: string; schema?: object }>>;
      getSchemas(params: { names: string[] }): Promise<Record<string, { params: object }>>;
      execute(params: { source: string }): Promise<{ ok: boolean; returnValue?: unknown }>;
    };

    await expect(sdk.search({ query: "add" })).resolves.toMatchObject([
      {
        path: "add",
        schema: expect.objectContaining({
          type: "object"
        })
      }
    ]);

    await expect(sdk.getSchemas({ names: ["multiply"] })).resolves.toMatchObject({
      multiply: {
        params: {
          type: "object",
          properties: {
            left: {
              description: "Left operand.",
              type: "number"
            },
            right: {
              description: "Right operand.",
              type: "number"
            }
          },
          required: ["left", "right"]
        }
      }
    });

    await expect(
      sdk.execute({
        source: [
          'import { add, multiply } from "math_tools";',
          "const sum = await add({ left: 2, right: 3 });",
          "return await multiply({ left: sum, right: 4 });"
        ].join("\n")
      })
    ).resolves.toMatchObject({
      ok: true,
      returnValue: 20
    });
  });

  it("defaults the group and meta-tools to mcp and sdk scope", () => {
    const group = codeMode(fixtureRoot());

    expect(group.scope).toEqual(["mcp", "sdk"]);
    expect(group.children.map((child) => [child.name, child.scope])).toEqual([
      ["search", ["mcp", "sdk"]],
      ["get_schemas", ["mcp", "sdk"]],
      ["execute", ["mcp", "sdk"]]
    ]);
  });

  it("allows callers to override each meta-tool scope", () => {
    const group = codeMode(fixtureRoot(), {
      search: {
        scope: ["sdk"]
      },
      getSchemas: {
        scope: ["mcp"]
      },
      execute: {
        scope: ["sdk"]
      }
    });

    expect(group.children.map((child) => [child.name, child.scope])).toEqual([
      ["search", ["sdk"]],
      ["get_schemas", ["mcp"]],
      ["execute", ["sdk"]]
    ]);
  });

  it("passes SDK options through to commands executed from SafeJS", async () => {
    const params = S.Object({
      value: S.Number()
    });
    const root = defineGroup<FixtureServices>({
      name: "service_tools",
      children: [
        defineCommand<FixtureServices, "scale", typeof params, undefined, number>({
          name: "scale",
          scope: ["sdk"],
          params,
          requires: {
            apiVersion: ">=1.2.3"
          },
          handler: async ({ params: commandParams, scaleFactor }) =>
            commandParams.value * scaleFactor
        })
      ]
    });
    const sdk = createSDK(
      codeMode(root, {
        apiVersion: "1.2.3",
        services: {
          scaleFactor: 3
        }
      })
    ) as {
      execute(params: { source: string }): Promise<{ ok: boolean; returnValue?: unknown }>;
    };

    await expect(
      sdk.execute({
        source: [
          'import { scale } from "service_tools";',
          "return await scale({ value: 7 });"
        ].join("\n")
      })
    ).resolves.toMatchObject({
      ok: true,
      returnValue: 21
    });
  });

  it("does not advertise MCP-only commands through executable codemode tools", async () => {
    const root = defineGroup({
      name: "ops",
      children: [
        defineCommand({
          name: "ping",
          scope: ["mcp"],
          params: S.Object({}),
          handler: async () => "pong"
        })
      ]
    });
    const sdk = createSDK(codeMode(root)) as {
      search(params: { query: string }): Promise<Array<{ path: string }>>;
      getSchemas(params: { names: string[] }): Promise<Record<string, unknown>>;
    };

    await expect(sdk.search({ query: "ping" })).resolves.toEqual([]);
    await expect(sdk.getSchemas({ names: ["ping"] })).rejects.toThrow(
      "Unknown command path(s): ping"
    );
  });
});
