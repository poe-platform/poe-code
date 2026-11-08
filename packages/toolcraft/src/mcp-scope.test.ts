import { describe, expect, it } from "vitest";
import { compileJsonSchema, S, type AnySchema, type JsonSchema, type ObjectSchema } from "toolcraft-schema";
import { defineCommand, defineGroup, defineStreamCommand } from "./index.js";
import { createMCPServer } from "./mcp.js";

interface ScopeScenario {
  name: string;
  schema: ObjectSchema<Record<string, AnySchema>>;
  arguments: Record<string, unknown>;
  expected?: Record<string, unknown>;
  error?: string;
}

describe.each(["snake", "camel"] as const)("MCP %s scoped parameters", (casing) => {
  const visible = casing === "snake" ? "visible_name" : "visibleName";
  const hidden = casing === "snake" ? "cli_only" : "cliOnly";
  const required = casing === "snake" ? "required_mcp" : "requiredMcp";
  const scenarios: ScopeScenario[] = [
    {
      name: "omits hidden required parameters",
      schema: S.Object({ visibleName: S.String(), cliOnly: S.String({ scope: ["cli"] }) }),
      arguments: { [visible]: "sample" },
      expected: { visibleName: "sample" }
    },
    {
      name: "rejects supplied hidden optional parameters",
      schema: S.Object({ visibleName: S.String(), cliOnly: S.Optional(S.String({ scope: ["cli"] })) }),
      arguments: { [visible]: "sample", [hidden]: "hidden" },
      error: `Unexpected parameter "${hidden}"`
    },
    {
      name: "promotes required MCP parameters",
      schema: S.Object({ requiredMcp: S.Optional(S.String({ requiredScopes: ["mcp"] })) }),
      arguments: {},
      error: `Missing required parameter "${required}"`
    },
    {
      name: "omits nested hidden required parameters",
      schema: S.Object({ payload: S.Object({ visibleName: S.String(), cliOnly: S.String({ scope: ["cli"] }) }) }),
      arguments: { payload: { [visible]: "sample" } },
      expected: { payload: { visibleName: "sample" } }
    },
    {
      name: "rejects hidden fields inside array items",
      schema: S.Object({ items: S.Array(S.Object({ visibleName: S.String(), cliOnly: S.Optional(S.String({ scope: ["cli"] })) })) }),
      arguments: { items: [{ [visible]: "sample", [hidden]: "hidden" }] },
      error: `Unexpected parameter "items[0].${hidden}"`
    },
    {
      name: "promotes nested required MCP parameters",
      schema: S.Object({ payload: S.Object({ requiredMcp: S.Optional(S.String({ requiredScopes: ["mcp"] })) }) }),
      arguments: { payload: {} },
      error: `Missing required parameter "payload.${required}"`
    },
    {
      name: "does not inject hidden field defaults",
      schema: S.Object({ visibleName: S.String(), cliOnly: S.Optional(S.String({ scope: ["cli"], default: "hidden" })) }),
      arguments: { [visible]: "sample" },
      expected: { visibleName: "sample" }
    },
    {
      name: "retains visible MCP parameters",
      schema: S.Object({ visibleName: S.String({ scope: ["mcp"] }) }),
      arguments: { [visible]: "sample" },
      expected: { visibleName: "sample" }
    },
    {
      name: "does not promote requiredness for another surface",
      schema: S.Object({ requiredMcp: S.Optional(S.String({ requiredScopes: ["sdk"] })) }),
      arguments: {},
      expected: {}
    }
  ];

  describe.each([false, true])("stream=%s", (stream) => {
    it.each(scenarios)("$name", async (scenario) => {
      const received: Record<string, unknown>[] = [];
      const config = { name: "check", scope: ["mcp"] as const, params: scenario.schema };
      const command = stream
        ? defineStreamCommand({
            ...config,
            event: S.String(),
            async *handler({ params }) {
              received.push(params);
              yield "ok";
            }
          })
        : defineCommand({
            ...config,
            handler: ({ params }) => {
              received.push(params);
              return "ok";
            }
          });
      let resolveData: () => void;
      const data = new Promise<void>((resolve) => { resolveData = resolve; });
      const session = createMCPServer(defineGroup({ name: "audit", children: [command] }), {
        name: "audit", version: "1", casing, errorReports: false
      }).createMessageSession((notification) => {
        if (notification.params?.type === "data") resolveData();
      });

      try {
        await session.handleMessage("initialize", {
          protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "test", version: "1" }
        });
        await session.handleMessage("notifications/initialized");
        const listing = await session.handleMessage(stream ? "toolcraft/streams/list" : "tools/list");
        const definitions = listing.result as Record<string, Array<{ inputSchema: JsonSchema }>>;
        const schema = definitions[stream ? "streams" : "tools"]?.[0]?.inputSchema;
        if (schema === undefined) throw new Error("Expected a discovered input schema");
        expect(compileJsonSchema(schema).validate(scenario.arguments).ok).toBe(scenario.error === undefined);

        const result = await session.handleMessage(stream ? "toolcraft/streams/subscribe" : "tools/call", {
          name: "audit__check", arguments: scenario.arguments
        });
        if (scenario.error !== undefined) {
          expect(result).toMatchObject({ error: { message: expect.stringContaining(scenario.error) } });
          expect(received).toEqual([]);
        } else {
          expect(result).not.toHaveProperty("error");
          if (stream) await data;
          expect(received).toEqual([scenario.expected]);
        }
      } finally {
        session.close();
      }
    });
  });
});
